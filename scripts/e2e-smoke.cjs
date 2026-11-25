/*
 * 真实程序端到端冒烟测试（主流程）：像真人一样把程序从头到尾点一遍，再回到磁盘上核对结果。
 *
 *   node scripts/e2e-smoke.cjs dev        → 用 node_modules 里的 Electron 跑当前工程（需先 npm run build && npm run build:electron）
 *   node scripts/e2e-smoke.cjs packaged   → 跑打包出来的 release/win-unpacked/国护积分管理.exe（需先 npm run dist）
 *   第 3 个参数可以指定用作样本的主表（默认取上级目录里的正式积分表）
 *
 * 全程只在系统临时目录的副本上进行，不修改任何真实积分表，也不动用户真实的"最近项目"列表
 * （准备数据、启动程序、模拟操作的方法都在 e2e-lib.cjs 里）。
 *
 * 步骤：
 *   欢迎页 → 打开项目 → 刷新数据 → 活动积分结算（表单校验 → 未知名预警 → 预览 → 写入）
 *   → 榜单的分列 / 合并、分组 / 全局两种视图 → 历史流水（展开、修改、无变动提示、撤销修改、栈顶解锁）
 *   → 关闭项目 → 用服务层重新读表核对 → 与写入前的备份逐格对比
 *   → 重新打开 → 撤销"新建活动" → 表格应与最初一模一样
 */
const fs = require('fs')
const ExcelJS = require('exceljs')
const {
  svc, sleep, Reporter, prepare, readConfig, shutdown, launchApp, compareWorkbooks, backupFiles
} = require('./e2e-lib.cjs')

const mode = process.argv[2] || 'dev'
const sample = process.argv[3]
const ACTIVITY = '冒烟测试出旗'
const PROJECT = '冒烟测试项目'

const r = new Reporter()
const env = prepare({ mode, sample })
let app = null

const settled = () => sleep(400) // 等界面把刚触发的更新画完
const has = async (s) => (await app.text()).includes(s)
const fmt = v => String(Math.round(Number(v) * 100) / 100) // 和榜单的显示规则一致：最多 2 位小数

// ---------- 往页面里塞的几段脚本（读表格、找某一行、点某一行的按钮） ----------
const tableRows = () => app.run('[...document.querySelectorAll("tbody tr")].map(tr => [...tr.children].map(td => td.textContent.trim()))')
// 榜单里某个队员的那一行：名次、姓名、届别、四个明细、各活动列、汇总
const memberRow = name => app.run(`(() => {
  const tr = [...document.querySelectorAll('tbody tr')].find(tr => tr.children[1] && tr.children[1].textContent.trim() === ${JSON.stringify(name)})
  return tr ? [...tr.children].map(td => td.textContent.trim()) : null
})()`)
const headTexts = () => app.run('[...document.querySelectorAll("thead th")].map(th => th.textContent.trim())')
// 右上角提示条里的文字（写入成功、撤销成功的提示都显示在这里）
const toastText = () => app.run("(() => { const t = document.querySelector('.fixed.top-16.right-6.z-40'); return t ? t.innerText : '' })()")
const groupRowCount = () => app.run('[...document.querySelectorAll("tbody tr")].filter(tr => tr.children.length === 1 && tr.children[0].colSpan > 1).length')
// 历史流水里某种类型的记录（按"操作类型"一列找；同类型有多条时取排在前面的，也就是最新的那条）
const rowByType = type => `[...document.querySelectorAll('tbody tr')].find(tr => tr.children[2] && tr.children[2].textContent.trim() === ${JSON.stringify(type)})`
const rowInfo = type => app.run(`(() => {
  const tr = ${rowByType(type)}
  if (!tr) return null
  const cell = i => tr.children[i] ? tr.children[i].textContent.trim() : null
  return { label: cell(3), count: cell(4), status: cell(5), buttons: [...tr.querySelectorAll('button')].map(b => ({ text: b.textContent.trim(), disabled: b.disabled, title: b.title })) }
})()`)
const rowAction = (type, action) => app.run(`(() => {
  const tr = ${rowByType(type)}
  if (!tr) return 'no row'
  const b = [...tr.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(action)})
  if (!b) return 'no button'
  if (b.disabled) return 'disabled'
  b.click()
  return 'ok'
})()`)
// 结算页"名单校验预警"里，把某个未知名修正成名单里的队员（或选择忽略）
const resolveUnknown = (name, value) => app.run(`(() => {
  const row = [...document.querySelectorAll('select')].map(s => s.closest('.flex.items-center.gap-3')).find(x => x && x.querySelector('.text-amber-200') && x.querySelector('.text-amber-200').textContent === ${JSON.stringify(name)})
  if (!row) return 'no row'
  const el = row.querySelector('select')
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, ${JSON.stringify(value)})
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return 'ok'
})()`)
// "部分修改"弹窗里，改某个队员的新分数
const setScore = (name, value) => app.run(`(() => {
  const tr = [...document.querySelectorAll('tbody tr')].find(tr => tr.children[0] && tr.children[0].textContent.trim() === ${JSON.stringify(name)})
  if (!tr) return 'no row'
  const el = tr.querySelector('input[type=number]')
  if (!el) return 'no input'
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(String(value))})
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return 'ok'
})()`)
const openProjectCard = () => app.run(`(() => {
  const c = [...document.querySelectorAll('.rounded-xl.border')].find(x => x.textContent.includes(${JSON.stringify(PROJECT)}))
  if (!c) return 'no card'
  c.click()
  return 'ok'
})()`)

// 表格的"排版"：各列列宽、表头行高、是否冻结。撤销新建活动后用来确认排版也恢复了
async function layoutOf (file) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const ws = wb.worksheets[0]
  return {
    widths: ws.columns.map(c => (c ? c.width : undefined)),
    headerHeight: ws.getRow(1).height,
    frozen: ws.views[0] ? ws.views[0].state : null
  }
}

async function main () {
  const before = await svc.readWorkbook(env.excelPath)
  if (!before.ok) throw new Error('读取测试副本失败：' + before.error)
  const d0 = before.data
  const names = d0.members.filter(m => !d0.duplicateNames.includes(m.name)).slice(0, 6).map(m => m.name)
  if (names.length < 6) throw new Error('样本表里不重名的队员不足 6 人，没法做这次测试')
  const f0 = new Map(d0.members.map(m => [m.row, m.f]))
  // 程序按姓名找行，同名时只认排在最前的那一行；这里照样算出"每个姓名对应哪一行"
  const rowOfName = new Map()
  d0.members.forEach(m => { if (!rowOfName.has(m.name)) rowOfName.set(m.name, m.row) })
  const sumExtras = m => d0.activityColumns.reduce((s, ac) => s + (m.extras[ac.col] || 0), 0)
  // 新建活动时每个人的得分：n0 = 主教官 2 + 正式 1；n1 = 彩排 1 + 正式 1；n2 = 正式 1；n3 = 场务 0.5；
  // n4 = 未知名"查无此人甲"修正过来之后，彩排 1
  const CREATE = { [names[0]]: 3, [names[1]]: 2, [names[2]]: 1, [names[3]]: 0.5, [names[4]]: 1 }
  // 之后"修改"这一笔：n1 从 2 改成 2.5，再补一个原先漏掉的 n5（+1.5）
  const EDIT = { [names[1]]: 0.5, [names[5]]: 1.5 }
  r.log(`模式=${mode}  临时目录=${env.dir}`)
  r.log(`副本：${d0.members.length} 人，活动列 ${d0.activityColumns.length} 个；参与打分：${names.join('、')}`)

  // ============ 1. 欢迎页 ============
  r.section('欢迎页')
  app = await launchApp(env)
  if (!r.check(await app.waitFor("document.body.innerText.includes('欢迎回来')", '欢迎页'), '程序启动后出现欢迎页')) throw new Error('程序没有正常启动')
  await sleep(500)
  r.check(await app.run('!!window.ghd'), '界面能用上主进程桥接 window.ghd')
  r.check(await app.run("document.body.innerText.includes('最近项目') && /最近项目\\s*1/.test(document.body.innerText.replace(/\\n/g, ' '))"), '"最近项目"里正好是那 1 个测试项目（说明用户数据目录已指到临时目录）')
  r.check(await app.run('(() => { const i = document.querySelector("header img"); return !!i && i.complete && i.naturalWidth === 256 })()'), '左上角显示的是新队徽图标（256×256）')
  r.check(app.dialogsReady, '已连上主进程调试口（后面的测试用它把系统文件对话框换成假的）')
  await app.shot('01-欢迎页.png')

  // ============ 2. 打开项目 ============
  r.section('打开项目')
  r.check((await openProjectCard()) === 'ok', '点击最近项目卡片')
  r.check(await app.waitFor("document.body.innerText.includes('在册有效队员')", '工作区'), '进入工作区（榜单加载出来）')
  await sleep(500)
  r.check(fs.existsSync(env.lockFile), '打开项目后表格旁生成占用锁文件')
  const statText = await app.run("[...document.querySelectorAll('main .grid.grid-cols-4 > div')].map(d => d.innerText.replace(/\\n/g, '=')).join(' | ')")
  r.log('统计卡片: ' + statText)
  const validCount = d0.members.filter(m => m.f !== null && m.f !== undefined).length
  r.check(Number((statText.match(/活动列数=(\d+)/) || [])[1]) === d0.activityColumns.length, '榜单的活动列数与表格一致')
  r.check(Number((statText.match(/在册有效队员=(\d+)/) || [])[1]) === validCount, '"在册有效队员"人数与表格一致')
  await app.shot('02-工作区.png')

  // ============ 3. 刷新数据 ============
  r.section('刷新数据')
  await app.click('刷新数据')
  await sleep(1200)
  r.check(!(await has('操作被阻断')) && !(await has('目标 Excel 文件不存在')), '点击"刷新数据"后没有弹出报错')
  r.check(await has('在册有效队员'), '刷新后榜单仍在')

  // ============ 4. 活动积分结算：表单校验 ============
  r.section('活动积分结算：表单校验')
  await app.nav('活动积分结算')
  await app.waitFor('!!document.querySelector(\'input[placeholder="如：国庆出旗"]\')', '结算页')
  const NAME_INPUT = 'input[placeholder="如：国庆出旗"]'
  const HEAD_INPUT = 'input[placeholder="如：张三，李四"]'
  await app.click('生成预览'); await settled()
  r.check(await has('请填写活动名称'), '什么都没填就点"生成预览"：提示先填活动名称')

  await app.setValue(NAME_INPUT, 0, ACTIVITY); await settled()
  await app.click('生成预览'); await settled()
  r.check(await has('主教官需填写 1~5 位人名'), '没填主教官：提示主教官需填写 1~5 位')

  await app.setValue(HEAD_INPUT, 0, names.slice(0, 6).join('、')); await settled()
  await app.click('生成预览'); await settled()
  r.check(await has('主教官需填写 1~5 位人名') && await has(`已识别 6 位：${names[0]}`), '主教官填了 6 位：提示超出 5 位（并显示"已识别 6 位"）')

  // 同一个名字重复写 3 遍、外加空的逗号：应当只算 1 位
  await app.setValue(HEAD_INPUT, 0, `${names[0]}，${names[0]}  ${names[0]}，,`); await settled()
  await app.click('生成预览'); await settled()
  r.check(await has(`已识别 1 位：${names[0]}`) && await has('存在完全空的彩排卡片'), '主教官重复写同一个名字只算 1 位；彩排卡片是空的：提示补充名单')

  await app.setValue('textarea.input', 1, `${names[1]}、查无此人甲`); await settled() // 第 1 张彩排卡片的"参训"
  await app.click('生成预览'); await settled()
  r.check(await has('正式活动「参加」名单不能为空'), '正式活动"参加"没填：提示不能为空')

  await app.setValue('textarea.input', 2, `${names[0]}，${names[1]}、${names[2]}、查无此人乙`); await settled() // 正式"参加"
  await app.setValue('textarea.input', 3, names[3]); await settled() // 正式"场务"
  // 活动名称和主表里已有的某一列重名：应当拦下来
  const dupColName = d0.activityColumns.map(c => c.name).find(n => n && !/[\r\n]/.test(n))
  if (dupColName) {
    await app.setValue(NAME_INPUT, 0, dupColName); await settled()
    await app.click('生成预览'); await settled()
    r.check(await has(`主表中已存在同名活动列「${dupColName}」`), `活动名称和已有的活动列重名（${dupColName}）：提示更换活动名称`)
  } else r.skip('活动名称重名检查（样本表没有单行的活动列表头）')
  await app.setValue(NAME_INPUT, 0, ACTIVITY); await settled()
  await app.click('生成预览'); await settled()

  // ============ 5. 未知名预警 → 预览 → 写入 ============
  r.section('活动积分结算：未知名预警 → 预览 → 写入')
  const warn = await app.run('[...document.querySelectorAll(".text-amber-200")].map(e => e.textContent.trim())')
  const wantWarn = ['查无此人甲', '查无此人乙']
  r.check(await has('名单校验预警') && await has('来源：彩排1参训') && await has('来源：正式参加'), '出现"名单校验预警"，并标出每个未知名来自哪一栏')
  r.check(JSON.stringify(warn) === JSON.stringify(wantWarn), '预警里列出的正是那 2 个查无此人的人名' + (JSON.stringify(warn) === JSON.stringify(wantWarn) ? '' : `（实际：${JSON.stringify(warn)}）`))
  await app.shot('03-未知名预警.png')
  r.check((await resolveUnknown('查无此人甲', names[4])) === 'ok', '把"查无此人甲"修正为名单里的队员（"查无此人乙"保持忽略）')
  await app.click('确认并继续')
  r.check(await app.waitFor(`document.body.innerText.includes(${JSON.stringify(`结算预览 · ${ACTIVITY}`)})`, '结算预览'), '进入结算预览')
  const previewRows = await tableRows()
  const wantRows = {
    [names[0]]: '2|—|—|1|—|+3',
    [names[1]]: '—|—|1|1|—|+2',
    [names[2]]: '—|—|—|1|—|+1',
    [names[4]]: '—|—|1|—|—|+1',
    [names[3]]: '—|—|—|—|0.5|+0.5'
  }
  const previewOk = previewRows.length === 5 && previewRows.every(row => wantRows[row[0]] === row.slice(1).join('|'))
  r.check(previewOk, '预览是 5 人（修正的人算进来、忽略的人不算），主教官 / 彩排 / 正式 / 场务各项分数正确' + (previewOk ? '' : `（实际：${previewRows.map(row => row.join(' ')).join('；')}）`))
  r.log('预览: ' + previewRows.map(row => row.join(' ')).join(' | '))
  await app.shot('04-结算预览.png')
  await app.click('确认写入 Excel')
  r.check(await app.waitFor("document.body.innerText.includes('已追加活动列')", '写入成功提示', 20000), '写入成功，右上角出现提示')
  r.log('提示: ' + ((await app.text()).match(/已追加活动列[^\n]*/) || ['(未读到提示)'])[0])
  r.check(await app.waitFor("!document.querySelector('input[placeholder=\"如：国庆出旗\"]').value", '表单清空'), '写入完成后表单被清空，可以接着录下一个活动')
  await app.shot('05-写入成功提示.png')

  // ============ 6. 榜单：分列 / 合并、分组 / 全局 ============
  r.section('榜单：分列 / 合并、分组 / 全局')
  await app.nav('仪表盘与排名')
  r.check(await app.waitFor(`[...document.querySelectorAll('thead th')].some(th => th.textContent.trim() === ${JSON.stringify(ACTIVITY)})`, '榜单新列'), '榜单出现新活动列')
  const splitHead = await headTexts()
  const actCount = d0.activityColumns.length + 1
  r.check(splitHead.length === 8 + actCount && splitHead[splitHead.length - 1] === '汇总总分', `分列视图：固定 8 列 + ${actCount} 个活动列，最后一列是"汇总总分"（实际 ${splitHead.length} 列）`)
  r.check(JSON.stringify(splitHead.slice(3, 7)) === JSON.stringify(d0.headers.slice(1, 5)), '四个明细列的表头照抄主表')
  const cellWant = { [names[0]]: '3', [names[1]]: '2', [names[2]]: '1', [names[3]]: '0.5', [names[4]]: '1' }
  const cellsBad = []
  for (const [name, want] of Object.entries(cellWant)) {
    const row = await memberRow(name)
    if (!row || row[row.length - 2] !== want) cellsBad.push(`${name}: ${row ? row[row.length - 2] : '没找到这一行'}（应为 ${want}）`)
  }
  r.check(cellsBad.length === 0, '5 个人在新活动列里的分数与写入的一致' + (cellsBad.length ? `：${cellsBad.join('；')}` : ''))
  const row0 = await memberRow(names[0])
  r.check(!!row0 && row0[row0.length - 1] === fmt((f0.get(rowOfName.get(names[0])) || 0) + 3), `${names[0]}：汇总分 ${f0.get(rowOfName.get(names[0]))} → ${row0 && row0[row0.length - 1]}（原汇总 + 3）`)
  // 表头里的换行来自 Excel 表头本身（活动名一行、括号说明一行）；样本表里有多少个多行表头，界面上就该分行显示多少个
  const multiLine = d0.activityColumns.filter(ac => /\r?\n/.test(ac.name)).length
  if (multiLine) r.check(await app.run(`[...document.querySelectorAll('thead th')].filter(th => th.innerHTML.includes('<br')).length >= ${multiLine}`), `${multiLine} 个多行表头都按 Excel 里的换行分行显示`)
  else r.skip('多行表头分行显示检查（样本表没有多行表头）')
  r.check(await app.run("getComputedStyle(document.querySelector('thead th')).position === 'sticky'"), '表头是吸顶的（滚动时列名一直看得见）')
  await app.run("(() => { const box = document.querySelector('main .card.overflow-auto'); box.scrollLeft = box.scrollWidth; return 'ok' })()")
  await app.shot('06-榜单-新活动列.png')

  await app.click('活动合并'); await settled()
  // 合并视图：名次 | 姓名 | 届别 | 四个明细列 | 活动合计 | 汇总总分 —— "活动合计"在下标 7
  const mergedHead = await headTexts()
  r.check(mergedHead.length === 9 && mergedHead[7] === '活动合计', '切到"活动合并"：所有活动并成 1 列"活动合计"' + (mergedHead.length === 9 ? '' : `（实际 ${mergedHead.length} 列：${mergedHead.join(' | ')}）`))
  const merged0 = await memberRow(names[0])
  r.check(!!merged0 && merged0[7] === fmt(sumExtras(d0.members.find(m => m.name === names[0])) + 3), `"活动合计" = 原有活动分 + 本次 3 = ${merged0 && merged0[7]}`)
  const plain = d0.members.find(m => sumExtras(m) === 0 && !(m.name in CREATE) && !d0.duplicateNames.includes(m.name))
  if (plain) {
    const mergedPlain = await memberRow(plain.name)
    r.check(!!mergedPlain && mergedPlain[7] === '—', '一项活动分都没有的人，"活动合计"显示为空（—），不是 0')
  } else r.skip('活动合计为空的检查（样本表里人人都有活动分）')
  await app.shot('07-榜单-活动合并.png')

  await app.click('按总积分全局排名'); await settled()
  const top = d0.members.slice().sort((a, b) => (b.f || 0) - (a.f || 0))[0]
  const globalFirst = await memberRow(top.name)
  r.check((await groupRowCount()) === 0, '切到"全局排名"：不再按届分组')
  r.check(!!globalFirst && globalFirst[0] === '1', '汇总分最高的人排第 1')
  const summaryCol = await app.run('[...document.querySelectorAll("tbody tr")].filter(tr => tr.children.length > 5).map(tr => Number(tr.lastElementChild.textContent.trim()))')
  r.check(summaryCol.every((v, i) => i === 0 || summaryCol[i - 1] >= v), '全局排名按汇总分从高到低排列')
  await app.shot('08-榜单-全局排名.png')

  await app.click('按届数分组排名'); await settled()
  const firstRank = await app.run("(() => { const tr = document.querySelectorAll('tbody tr')[1]; return tr ? tr.children[0].textContent.trim() : null })()")
  r.check((await groupRowCount()) >= 1 && /^1\s*\/ 全局第 \d+$/.test(firstRank || ''), `切回"按届数分组排名"：每组各自从第 1 名排起，并标注全局名次（实际：${firstRank}）`)
  await app.click('活动分列'); await settled()
  r.check((await headTexts()).length === splitHead.length, '切回"活动分列"：表头列数恢复')

  // ============ 7. 历史流水 ============
  r.section('历史流水：展开 / 修改 / 撤销修改 / 栈顶解锁')
  await app.nav('历史流水与撤销')
  r.check(await app.waitFor("document.body.innerText.includes('新建大型活动')", '历史流水'), '历史流水里出现这笔记录')
  const created = await rowInfo('新建大型活动')
  r.check(!!created && created.label === ACTIVITY && created.count === '5' && created.status === '活跃', '记录：新建大型活动 / 5 人 / 活跃' + (created ? '' : '（没找到这一行）'))
  r.check((await rowAction('新建大型活动', '▶')) === 'ok', '展开这一条记录')
  const detail = await app.run(`(() => { const tr = ${rowByType('新建大型活动')}; return tr && tr.nextElementSibling ? tr.nextElementSibling.innerText : '' })()`)
  r.check(detail.includes(`主教官：${names[0]}`) && detail.includes('训练 0 次 / 彩排 1 次 / 正式时长 1h') && detail.includes(`${names[0]} +3`), '展开后能看到主教官、卡片数量和每个人的得分')
  await app.shot('09-历史流水.png')

  // 修改：n1 从 2 改成 2.5；再把原先没打分的 n5 补进来
  r.check((await rowAction('新建大型活动', '修改')) === 'ok', '点"修改"打开部分修改弹窗')
  r.check(await app.waitFor(`document.body.innerText.includes(${JSON.stringify(`部分修改 · ${ACTIVITY}`)})`, '部分修改弹窗'), '出现"部分修改"弹窗')
  await app.shot('10-部分修改弹窗.png')
  r.check((await setScore(names[1], 2.5)) === 'ok', `把 ${names[1]} 的新分数改成 2.5`)
  r.check((await app.selectOption('select', 0, names[5])) === 'ok', '在"补充遗漏成员"里选中一个原先没打分的人')
  r.check((await app.setValue('.w-28 > input[type=number]', 0, 1.5)) === 'ok', '把他的分数填成 1.5')
  r.check(await app.buttonState('添加') && (await app.buttonState('添加')).disabled === false, '选了人之后"添加"按钮可以点')
  await app.click('添加'); await settled()
  r.check(await app.run(`[...document.querySelectorAll('tbody tr')].some(tr => tr.children[0] && tr.children[0].textContent.trim() === ${JSON.stringify(names[5])} && tr.lastElementChild.textContent.trim() === '+1.5')`), '"添加"之后表格里多出这个队员，差值 +1.5')
  await app.shot('10-部分修改弹窗-已填写.png')
  await app.click('提交差值修改')
  r.check(await app.waitFor(`document.body.innerText.includes(${JSON.stringify(`已修改「${ACTIVITY}」：2 人的分数有变动`)})`, '修改成功提示', 20000), '提交修改成功：提示 2 人的分数有变动')
  const afterEdit = await rowInfo('修改大型活动')
  const afterEditBase = await rowInfo('新建大型活动')
  r.check(!!afterEdit && afterEdit.status === '活跃' && afterEdit.count === '2', '新记录"修改大型活动"是栈顶（活跃），涉及 2 人')
  r.check(!!afterEditBase && afterEditBase.status === '锁定' && !afterEditBase.buttons.some(b => b.text === '修改') && afterEditBase.buttons.some(b => b.text === '撤销' && b.disabled), '原记录变成"锁定"：没有"修改"按钮，"撤销"是灰的')
  r.check(!!afterEditBase && afterEditBase.buttons.some(b => b.text === '撤销' && b.title === '仅栈顶（最新）记录可撤销'), '灰色"撤销"按钮上有说明文字：仅栈顶（最新）记录可撤销')
  await app.shot('11-修改后的历史流水.png')

  // 什么都不改直接提交
  r.check((await rowAction('修改大型活动', '修改')) === 'ok', '再次点"修改"')
  await app.waitFor(`document.body.innerText.includes(${JSON.stringify(`部分修改 · ${ACTIVITY}`)})`, '部分修改弹窗')
  await app.click('提交差值修改'); await settled()
  r.check(await has('没有检测到任何分数变动') && await has('无变动'), '什么都没改就提交：提示"没有检测到任何分数变动"')
  await app.closeAlert()
  r.check(await has(`部分修改 · ${ACTIVITY}`), '关掉提示后弹窗还在，可以继续改')
  await app.click('取消'); await settled()
  r.check(!(await has(`部分修改 · ${ACTIVITY}`)), '点"取消"关闭弹窗')

  // 撤销修改：先试"取消"，再真的撤销
  r.check((await rowAction('修改大型活动', '撤销')) === 'ok', '点"撤销"')
  const confirmText = await app.lastModalText()
  r.check(!!confirmText && confirmText.includes('确认撤销该批次？') && confirmText.includes(`在「${ACTIVITY}」活动列按相反差值写回，恢复到上一版本。`), '出现确认框，说明会按相反差值写回')
  await app.click('取消'); await settled()
  r.check((await rowInfo('修改大型活动')).status === '活跃', '确认框里点"取消"：什么都不发生')
  r.check((await rowAction('修改大型活动', '撤销')) === 'ok' && (await app.click('确认撤销')) === 'ok', '再点"撤销"并确认')
  // 等右上角的提示条里出现"已撤销「活动名」"：只等页面上出现"已撤销"四个字是不够的——
  // 页面上本来就可能已经有别的"已撤销"标签，会过早放行
  const undoToast = `已撤销「${ACTIVITY}」`
  r.check(await app.waitFor(`(document.querySelector('.fixed.top-16.right-6.z-40') || {innerText:''}).innerText.includes(${JSON.stringify(undoToast)})`, '撤销成功的提示', 20000), '撤销成功，右上角出现提示')
  r.check(!(await toastText()).includes('对不上'), '提示里没有"原汇总总与明细对不上"的误报（撤销带来的汇总变化是预期内的）' + `（提示：${(await toastText()).slice(0, 80)}）`)
  r.check((await rowInfo('修改大型活动')).status === '已撤销', '这条修改记录变成"已撤销"')
  const unlocked = await rowInfo('新建大型活动')
  r.check(!!unlocked && unlocked.status === '活跃' && unlocked.buttons.some(b => b.text === '修改' && !b.disabled), '上一级记录自动解锁，重新成为栈顶')
  await app.shot('12-撤销修改后.png')

  // 榜单应已恢复成"刚新建完"的样子
  await app.nav('仪表盘与排名')
  await app.waitFor(`[...document.querySelectorAll('thead th')].some(th => th.textContent.trim() === ${JSON.stringify(ACTIVITY)})`, '榜单')
  const row1 = await memberRow(names[1])
  const row5 = await memberRow(names[5])
  r.check(!!row1 && row1[row1.length - 2] === '2', `撤销修改后 ${names[1]} 的新活动列分数恢复为 2（实际：${row1 && row1[row1.length - 2]}）`)
  r.check(!!row5 && row5[row5.length - 2] === '—', `修改时补进来的 ${names[5]}，撤销后那一格恢复为空白而不是留下 0（实际：${row5 && row5[row5.length - 2]}）`)

  // ============ 8. 关闭项目 ============
  r.section('关闭项目')
  await app.click('关闭项目并释放锁定')
  r.check(await app.waitFor("document.body.innerText.includes('欢迎回来')", '回到欢迎页'), '回到欢迎页')
  await sleep(800)
  r.check(!fs.existsSync(env.lockFile), '关闭项目后占用锁文件已删除')

  // ============ 9. 用服务层重新读表核对 ============
  r.section('用服务层重新读表核对（此刻的状态：新建了活动、改过一次、又撤销了那次修改）')
  const after = await svc.readWorkbook(env.excelPath)
  if (!after.ok) throw new Error('写入后读表失败：' + after.error)
  const d1 = after.data
  const last = d1.activityColumns[d1.activityColumns.length - 1]
  r.check(!!last && last.name === ACTIVITY && d1.activityColumns.length === d0.activityColumns.length + 1, `新活动列「${ACTIVITY}」排在最后一个活动列（第 ${last && last.col} 列），活动列总数 +1`)
  r.check(d1.headers[6] === '', '第 7 列仍是空白分隔列')
  r.check(d1.members.length === d0.members.length, '队员行数不变')
  let fBad = 0; const deltaBad = []
  for (const m of d1.members) {
    const sum = (m.b || 0) + (m.c || 0) + (m.d || 0) + (m.e || 0) + d1.activityColumns.reduce((a, ac) => a + (m.extras[ac.col] || 0), 0)
    if (Math.abs(sum - m.f) > 1e-9) fBad++
    const want = +((f0.get(m.row) || 0) + (rowOfName.get(m.name) === m.row ? (CREATE[m.name] || 0) : 0)).toFixed(4)
    if (Math.abs(want - m.f) > 1e-9 && deltaBad.length < 5) deltaBad.push(`${m.name}: ${f0.get(m.row)} -> ${m.f}，应为 ${want}`)
  }
  r.check(fBad === 0, `全表 ${d1.members.length} 人的汇总分都等于明细之和（不一致 ${fBad} 行）`)
  r.check(deltaBad.length === 0, '每人汇总分的变化恰好等于"新建活动"这一次的得分（修改已撤销，不留痕迹）' + (deltaBad.length ? `：${deltaBad.join('；')}` : ''))
  const cellBad = []
  for (const [name, want] of Object.entries(CREATE)) {
    const m = d1.members.find(x => x.row === rowOfName.get(name))
    if (!m || m.extras[String(last.col)] !== want) cellBad.push(`${name}: ${m ? m.extras[String(last.col)] : '没找到'}（应为 ${want}）`)
  }
  const m5 = d1.members.find(x => x.row === rowOfName.get(names[5]))
  r.check(cellBad.length === 0, '5 个人在新列里的分数与写入的一致' + (cellBad.length ? `：${cellBad.join('；')}` : ''))
  r.check(!!m5 && m5.extras[String(last.col)] === null, '修改时补进来、后来又撤销的那个人，新列里的格子恢复为空白（而不是留下一个 0）' + (m5 ? `（实际：${m5.extras[String(last.col)]}）` : '（没找到这个队员）'))
  const saved = readConfig(env)
  const h = saved.history
  r.check(Array.isArray(h) && h.length === 2 && h[0].type === 'event_create' && h[0].label === ACTIVITY && !h[0].status, '项目配置里登记了"新建大型活动"这一笔（活跃）')
  r.check(Array.isArray(h) && h[1] && h[1].type === 'event_edit' && h[1].status === 'undone' && JSON.stringify(h[1].details) === JSON.stringify(EDIT), '登记了"修改大型活动"这一笔，状态是已撤销，差值记录正确')
  // 新列占用的那一列，新建前如果已经带着列宽、边框（真实主表就是这样），记录里应存下它的原样，供"撤销新建"时恢复
  const skeleton = Array.isArray(h) && h[0] && h[0].prevColumn
  r.log(skeleton ? `新建活动的记录里保存了该列新建前的样子：列宽 ${skeleton.width}，${skeleton.cells.length} 个带格式的空格子` : '新建活动的记录里没有 prevColumn：说明这一列新建前是完全空白的')
  const backups = backupFiles(env.excelPath)
  r.check(backups.length === 3, `3 次写入（新建 / 修改 / 撤销修改）各留了 1 份写入前备份（实际 ${backups.length} 份）`)

  // ============ 10. 与写入前的备份逐格对比 ============
  r.section('与写入前的备份逐格对比：只允许该改的格子被改')
  // 最初的排版（各列列宽、表头行高、冻结），本节和后面撤销新建之后各比一次
  const lay0 = backups.length ? await layoutOf(backups[0].file) : null
  if (last && backups.length && lay0) {
    const cmp = await compareWorkbooks(backups[0].file, env.excelPath)
    const allowed = new Set([`1,${last.col}`])
    for (const name of Object.keys(CREATE)) { allowed.add(`${rowOfName.get(name)},${last.col}`); allowed.add(`${rowOfName.get(name)},6`) }
    r.log(`原有 ${cmp.sizeA} 个格子；内容变化 ${cmp.valueChanged.length} 个；样式变化 ${cmp.styleChanged.length} 个；新增 ${cmp.added.length} 个；消失 ${cmp.removed.length} 个`)
    r.check(cmp.removed.length === 0, '没有格子消失' + (cmp.removed.length ? `：${cmp.removed.join(' ')}` : ''))
    r.check(cmp.added.every(k => allowed.has(k)) && cmp.valueChanged.every(k => allowed.has(k)), '被动过的格子只有：新列表头、5 个得分格、5 个汇总格' + (cmp.added.concat(cmp.valueChanged).some(k => !allowed.has(k)) ? `：${cmp.added.concat(cmp.valueChanged).filter(k => !allowed.has(k)).join(' ')}` : ''))
    r.check(cmp.added.length + cmp.valueChanged.length === allowed.size, `一共正好 ${allowed.size} 个格子有变化（实际 ${cmp.added.length + cmp.valueChanged.length} 个）`)
    // 新列表头照参照列加了"自动换行"，所以它的样式会变；其余格子的字体、对齐、边框、底色都不许变
    r.check(cmp.styleChanged.length === 1 && cmp.styleChanged[0] === `1,${last.col}`, '样式变化的只有新列表头' + (cmp.styleChanged.length ? `：${cmp.styleChanged.join(' ')}` : ''))
    // 除新列（列宽由程序按活动名设定）外，各列列宽应与写入前一致。
    // 真实主表的姓名、夜训周训两列列宽正好是 9，ExcelJS 默认会在写回时把这种列宽定义丢掉，这里专门盯住它
    const lay1 = await layoutOf(env.excelPath)
    const widthDiff1 = []
    for (let c = 0; c < Math.max(lay0.widths.length, lay1.widths.length); c++) {
      if (c + 1 === last.col) continue
      if ((lay0.widths[c] || null) !== (lay1.widths[c] || null)) widthDiff1.push(`第 ${c + 1} 列 ${lay0.widths[c]} → ${lay1.widths[c]}`)
    }
    r.check(widthDiff1.length === 0, '除新列外，各列列宽与写入前一致' + (widthDiff1.length ? `：${widthDiff1.join('；')}` : ''))
  } else {
    r.problems.push('没有备份文件或新列，无法做逐格对比')
    console.log('  ✗ 没有备份文件或新列，无法做逐格对比')
  }

  // ============ 11. 重新打开 → 撤销"新建活动" ============
  r.section('重新打开项目 → 撤销"新建活动"：整列删除，表格回到最初的样子')
  r.check((await openProjectCard()) === 'ok', '从最近项目重新打开')
  r.check(await app.waitFor("document.body.innerText.includes('在册有效队员')", '工作区'), '进入工作区')
  await app.nav('历史流水与撤销')
  await app.waitFor("document.body.innerText.includes('新建大型活动')", '历史流水')
  r.check((await rowInfo('新建大型活动')).status === '活跃', '重新打开后，历史记录还在，"新建大型活动"仍是栈顶')
  r.check((await rowAction('新建大型活动', '撤销')) === 'ok', '点"撤销"')
  const confirmCreate = await app.lastModalText()
  r.check(!!confirmCreate && confirmCreate.includes(`在 Excel 中物理删除「${ACTIVITY}」整列（右侧各列自动左移）。`), '确认框说明：整列删除，右侧各列左移')
  r.check((await app.click('确认撤销')) === 'ok', '确认撤销')
  r.check(await app.waitFor(`(document.querySelector('.fixed.top-16.right-6.z-40') || {innerText:''}).innerText.includes(${JSON.stringify(`已撤销「${ACTIVITY}」`)})`, '撤销成功的提示', 20000), '撤销成功，右上角出现提示')
  r.check(!(await toastText()).includes('对不上'), '提示里没有"原汇总总与明细对不上"的误报' + `（提示：${(await toastText()).slice(0, 80)}）`)
  r.check((await rowInfo('新建大型活动')).status === '已撤销', '记录变成"已撤销"，"撤销"按钮变灰')
  await app.shot('13-撤销新建后.png')
  await app.nav('仪表盘与排名')
  await app.waitFor("document.body.innerText.includes('在册有效队员')", '榜单')
  const finalHead = await headTexts()
  r.check(!finalHead.some(t => t.includes(ACTIVITY)) && finalHead.length === 8 + d0.activityColumns.length, '榜单里已经没有这个活动列')
  await app.click('关闭项目并释放锁定')
  await app.waitFor("document.body.innerText.includes('欢迎回来')", '回到欢迎页')
  await sleep(800)
  r.check(!fs.existsSync(env.lockFile), '关闭项目后占用锁文件已删除')

  const final = await svc.readWorkbook(env.excelPath)
  if (!final.ok) throw new Error('撤销后读表失败：' + final.error)
  const d2 = final.data
  r.check(d2.activityColumns.length === d0.activityColumns.length && !d2.activityColumns.some(c => c.name === ACTIVITY), '活动列数恢复到最初，新加的那一列已删除')
  const fDiff = d2.members.filter(m => Math.abs((f0.get(m.row) || 0) - (m.f || 0)) > 1e-9)
  r.check(d2.members.length === d0.members.length && fDiff.length === 0, `全表 ${d2.members.length} 人的汇总分都回到最初的数值` + (fDiff.length ? `（不一致 ${fDiff.length} 行）` : ''))
  const cmp2 = await compareWorkbooks(backups[0].file, env.excelPath)
  r.log(`与最初的表格对比：内容变化 ${cmp2.valueChanged.length} 个；样式变化 ${cmp2.styleChanged.length} 个；新增 ${cmp2.added.length} 个；消失 ${cmp2.removed.length} 个` + (cmp2.valueChanged.length ? `：${cmp2.valueChanged.slice(0, 10).join(' ')}` : ''))
  r.check(cmp2.valueChanged.length === 0 && cmp2.added.length === 0 && cmp2.removed.length === 0, '每个格子的内容都与最初的表格一模一样')
  r.check(cmp2.styleChanged.length === 0, '每个格子的样式（字体、对齐、边框、底色）都与最初的表格一模一样' + (cmp2.styleChanged.length ? `：${cmp2.styleChanged.slice(0, 10).join(' ')}` : ''))
  if (lay0) {
    const lay2 = await layoutOf(env.excelPath)
    const widthDiff = []
    const n = Math.max(lay0.widths.length, lay2.widths.length)
    for (let c = 0; c < n; c++) if ((lay0.widths[c] || null) !== (lay2.widths[c] || null)) widthDiff.push(`第 ${c + 1} 列 ${lay0.widths[c]} → ${lay2.widths[c]}`)
    r.check(widthDiff.length === 0, '各列列宽恢复到最初' + (widthDiff.length ? `：${widthDiff.join('；')}` : ''))
    r.check(lay0.headerHeight === lay2.headerHeight && lay0.frozen === lay2.frozen, `表头行高、冻结窗格与最初一致（${lay0.headerHeight} / ${lay0.frozen}）`)
  }

  // ============ 12. 界面异常 ============
  r.section('界面异常')
  r.check(app.rendererErrors.length === 0, '整个过程中界面没有抛出异常或打印错误' + (app.rendererErrors.length ? `：${app.rendererErrors.slice(0, 3).join(' | ')}` : ''))
}

;(async () => {
  try {
    await main()
  } catch (e) {
    console.error('\n[e2e] 流程中断：', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e)
    r.problems.push('流程中断：' + (e && e.message ? e.message : e))
  } finally {
    await shutdown(env)
  }
  process.exit(r.summary(env.dir))
})()
