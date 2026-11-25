/*
 * 场景测试（端到端，操作的是真实运行的程序）。
 * 与 e2e-smoke.cjs（主流程）互补，专门检查「出了状况时会怎样」和「第一次使用会怎样」：
 *
 *   A. 第一次使用：没有最近项目 → 新建项目（每一步必填项的校验、文件对话框点取消、重名、保存位置不存在时的收尾、
 *      按模板生成新表并核对版式）→ 在新表上录入第一个活动 → 「打开项目」对话框 → 各种打不开的项目文件 → 失效条目
 *   B. 表格正被别的程序开着（模拟在 Excel / WPS 里打开了这张表）：打开项目、写入被拦下并说明原因，
 *      期间「刷新数据」照常可用，解除占用后重试成功
 *   C. 项目配置文件被别的程序开着：Excel 写进去了、配置却存不下来 → 自动回滚，提示「本次操作未生效」
 *   D. 活动名里带引号、&、< > 等特殊符号
 *   E. 批量导入：取消选择文件、分值填 0、未知名映射（映射之后还能再改）、升降旗倍率、部门互斥锁、三种坏文件；
 *      表头里的排版空格、名字里的排版空格、封面页排在前面的多工作表文件都能正常导入
 *   F. 把上面的导入和活动逐个撤销 → 表格和做这些操作之前逐格一致
 *   G. 同时开第二个程序窗口
 *   H. 表格被别的项目占用（另一个活着的进程留下的锁）、占用方已经不在、程序被强制结束后残留的锁、点 × 关窗口
 *   I. 有人在 Excel 里手工改过主表：多了个同名队员、多出两列重名的活动列、活动列被手工删掉、项目开着时表格文件被删掉
 *      （这一轮的表格放在带中文和空格的文件夹里）
 *   J. 窗口缩到最小、常见笔记本分辨率、150% 缩放时的排版（内容有没有被挤出屏幕或被裁掉，顶栏标题不折行）
 *
 * 用法：node scripts/e2e-scenarios.cjs [dev|packaged] [样本主表路径]
 * 公共工具（启动程序、连接调试口、逐格对比）在 e2e-lib.cjs 里，那里的注释说明了原理。
 */
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawn } = require('child_process')
require('../electron/services/exceljsColumnWidth') // 测试脚本自己写表格时，同样别让 ExcelJS 把「列宽 = 9」的列弄丢
const ExcelJS = require('exceljs')
const {
  root, svc, sleep, shotsDir, Reporter, prepare, writeRecent, readConfig, shutdown, launchApp,
  lockFileOf, killTree, compareWorkbooks, backupFiles
} = require('./e2e-lib.cjs')

const mode = process.argv[2] || 'dev'
const sample = process.argv[3]
const r = new Reporter()
const envs = []
const apps = []
let app = null // 当前正在操作的那个程序窗口

// ---------- 文件小工具 ----------
const settled = () => sleep(400)
const round4 = n => Math.round(n * 10000) / 10000
const sha1 = file => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex')
const readLock = file => { try { return JSON.parse(fs.readFileSync(file, 'utf-8')) } catch (_) { return null } }
// 目录里有没有「写了一半」的临时文件（程序写文件都是先写 .tmp-xxx 再改名，正常情况下不会留下来）
const tmpLeftovers = dir => fs.readdirSync(dir).filter(f => f.includes('.tmp-'))

async function openSheet (file) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  return wb.worksheets[0]
}

// 用 ExcelJS 直接改表格，模拟「用户自己在 Excel 里改了改」
async function editSheet (file, edit) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  await edit(wb.worksheets[0])
  await wb.xlsx.writeFile(file)
}

// 造一张导入用的小表
async function makeSheet (file, build) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('导入')
  build(ws)
  await wb.xlsx.writeFile(file)
}

// ---------- 操作界面的通用小工具 ----------
const NAME_INPUT = 'input[placeholder="如：国庆出旗"]'
const HEAD_INPUT = 'input[placeholder="如：张三，李四"]'
const TA = 'textarea.input' // 结算页的 4 个多行文本框依次是：彩排教官、彩排参训、正式参加、正式场务
const CARD = '.rounded-xl.border' // 欢迎页「最近项目」里的一张卡片
const MODAL = '.fixed.inset-0.z-50'
const ALERT_PICK = "[...document.querySelectorAll('.fixed.inset-0.z-50')].reverse().find(x => [...x.querySelectorAll('button')].some(b => b.textContent.trim() === '我知道了'))"

const has = s => app.run(`document.body.innerText.includes(${JSON.stringify(s)})`)
const waitText = (s, timeout = 15000) => app.waitFor(`document.body.innerText.includes(${JSON.stringify(s)})`, `页面上出现「${s}」`, timeout)
const waitWorkspace = () => waitText('在册有效队员', 30000)
const waitWelcome = () => waitText('欢迎回来')
const waitToast = s => app.waitFor(
  `(() => { const t = document.querySelector('.fixed.top-16.right-6.z-40'); return t ? t.innerText.includes(${JSON.stringify(s)}) : false })()`,
  `右上角提示「${s}」`, 20000
)
const alertNow = () => app.run(`(() => { const m = ${ALERT_PICK}; return m ? m.innerText : '' })()`)
// 等阻断式提示框出现，返回里面的全部文字（没等到时是空串）
const waitAlert = async (s, timeout = 20000) => {
  await app.waitFor(`(() => { const m = ${ALERT_PICK}; return m ? m.innerText.includes(${JSON.stringify(s)}) : false })()`, `提示「${s}」`, timeout)
  return alertNow()
}
// 等提示框出现、核对文字、再点「我知道了」关掉
const expectAlert = async (s, label) => {
  const text = await waitAlert(s)
  const ok = text.includes(s)
  r.check(ok, label + (ok ? '' : `（实际提示：${text.replace(/\s+/g, ' ') || '没有出现提示'}）`))
  await app.closeAlert()
  await settled()
  return ok
}
const modalText = async () => (await app.lastModalText()) || ''
const modalInputValue = i => app.run(`(() => { const el = document.querySelectorAll(${JSON.stringify(MODAL + ' input')})[${i}]; return el ? el.value : null })()`)
const setModalInput = (i, v) => app.setValue(MODAL + ' input', i, v)
const recentBadge = () => app.run("(() => { const h = [...document.querySelectorAll('h2')].find(x => x.textContent.trim() === '最近项目'); return h && h.nextElementSibling ? h.nextElementSibling.textContent.trim() : null })()")
const recentNames = () => app.run(`[...document.querySelectorAll(${JSON.stringify(CARD)})].filter(x => x.textContent.includes('表格：') && x.querySelector('.text-sm.font-medium')).map(x => x.querySelector('.text-sm.font-medium').textContent.trim())`)
const clickRecent = name => app.run(`(() => {
  const c = [...document.querySelectorAll(${JSON.stringify(CARD)})].find(x => x.textContent.includes('表格：') && x.querySelector('.text-sm.font-medium') && x.querySelector('.text-sm.font-medium').textContent.includes(${JSON.stringify(name)}))
  if (!c) return 'no card'
  c.click()
  return 'ok'
})()`)
const recentCardText = name => app.run(`(() => {
  const c = [...document.querySelectorAll(${JSON.stringify(CARD)})].find(x => x.textContent.includes(${JSON.stringify(name)}) && x.textContent.includes('表格：'))
  return c ? c.innerText.replace(/\\s+/g, ' ') : null
})()`)
// 「批量数据导入」页上某个部门入口的状态文字
const lockState = name => app.run(`(() => {
  const el = [...document.querySelectorAll('span')].find(s => s.textContent.trim() === ${JSON.stringify(name)})
  return el && el.parentElement ? el.parentElement.innerText.replace(/\\s+/g, ' ').trim() : null
})()`)
const HISTORY_ROW = type => `[...document.querySelectorAll('.card.overflow-hidden table tbody tr')].find(tr => tr.children.length >= 7 && tr.children[2].querySelector('span') && tr.children[2].querySelector('span').textContent.trim() === ${JSON.stringify(type)})`
// 历史流水里某种类型排在最前面的那一行（新的排在前面，所以就是这一类里最新的一笔）
const rowInfo = type => app.run(`(() => {
  const tr = ${HISTORY_ROW(type)}
  if (!tr) return null
  const btns = [...tr.querySelectorAll('button')]
  const undoBtn = btns.find(b => b.textContent.trim() === '撤销')
  return {
    label: tr.children[3].textContent.trim(),
    count: tr.children[4].textContent.trim(),
    status: tr.children[5].textContent.trim(),
    undoDisabled: undoBtn ? undoBtn.disabled : null,
    hasEdit: btns.some(b => b.textContent.trim() === '修改')
  }
})()`)
const rowAction = (type, action) => app.run(`(() => {
  const tr = ${HISTORY_ROW(type)}
  if (!tr) return 'no row'
  const b = [...tr.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(action)})
  if (!b) return 'no button'
  if (b.disabled) return 'disabled'
  b.click()
  return 'ok'
})()`)
// 「部分修改」弹窗里，改某个队员的新分数（姓名后面可能跟着「同名待核对」徽标，所以按开头匹配这一行）
const setScore = (name, value) => app.run(`(() => {
  const tr = [...document.querySelectorAll(${JSON.stringify(MODAL + ' tbody tr')})].find(tr => tr.children[0] && tr.children[0].textContent.trim().startsWith(${JSON.stringify(name)}))
  if (!tr) return 'no row'
  const el = tr.querySelector('input[type=number]')
  if (!el) return 'no input'
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(String(value))})
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return 'ok'
})()`)
// 顶部黄色提醒条里的文字（提醒条以这段话开头）；没有这条提醒时返回 null
const bannerOf = text => app.run(`(() => {
  const el = [...document.querySelectorAll('main div')].find(x => x.children.length <= 2 && x.textContent.trim().startsWith(${JSON.stringify(text)}))
  return el ? el.textContent.replace(/\\s+/g, ' ').trim() : null
})()`)

// 结算页：填一张活动表单（主教官 + 一张彩排卡片的教官 + 正式参加），其余留空。
// 彩排的名单填在"教官"里、"参训"留空：教官和参训的分值一样，这样填顺便覆盖了"对外带训、只有教官没有参训"的情况
async function fillEvent (name, head, rehearsal, formal) {
  await app.setValue(NAME_INPUT, 0, name)
  await app.setValue(HEAD_INPUT, 0, head)
  await app.setValue(TA, 0, rehearsal)
  await app.setValue(TA, 1, '')
  await app.setValue(TA, 2, formal)
  await app.setValue(TA, 3, '')
  await settled()
}
const previewShown = name => waitText(`结算预览 · ${name}`)
const toEventPage = async () => {
  await app.nav('活动积分结算')
  await app.waitFor(`!!document.querySelector(${JSON.stringify(NAME_INPUT)})`, '活动积分结算页')
}
async function commitEventAndExpect (name, toastPart) {
  await app.click('生成预览')
  r.check(await previewShown(name), `生成预览「${name}」`)
  await app.click('确认写入 Excel')
  r.check(await waitToast(toastPart), `写入成功：${toastPart}`)
}
async function closeToWelcome () {
  await app.click('关闭项目并释放锁定')
  await waitWelcome()
  await settled()
  await settled()
}

// ---------- 让「别的程序」占住文件 ----------
// 生成一个 PowerShell 小脚本：把某个文件像 Excel 打开它时那样占住，直到测试脚本让它放手。
//   ReadWrite + Read  —— 和 Excel 一样：别的程序还能读，但不能写（模拟「这张表正在 Excel 里开着」）
//   Read + ReadWrite  —— 别的程序还能读写内容，但不能替换 / 删除这个文件（模拟「配置文件正被别的软件开着」）
function writeHolderScript (file, access, share) {
  fs.writeFileSync(file, [
    'param([string]$Path)',
    'try {',
    `  $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::${access}, [System.IO.FileShare]::${share})`,
    '} catch {',
    "  [Console]::Out.WriteLine('error ' + $_.Exception.Message)",
    '  exit 1',
    '}',
    "[Console]::Out.WriteLine('held')",
    '[Console]::In.ReadLine() | Out-Null',
    '$fs.Close()',
    "[Console]::Out.WriteLine('bye')"
  ].join('\r\n') + '\r\n', 'ascii')
}

async function holdWithPowerShell (script, file) {
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, file], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let out = ''
  let err = ''
  child.stdout.on('data', d => { out += d })
  child.stderr.on('data', d => { err += d })
  const exited = new Promise(resolve => child.on('exit', code => resolve(code)))
  const t0 = Date.now()
  while (!/held|error/.test(out) && Date.now() - t0 < 30000) await sleep(200)
  if (!/held/.test(out)) {
    try { child.kill() } catch (_) {}
    throw new Error(`占住文件的辅助进程没有启动：${out || err}`)
  }
  return {
    pid: child.pid,
    exited,
    // 让它放手：往它的标准输入写一行，脚本读到这一行就关掉文件并退出
    release: async () => {
      try { child.stdin.end('\n') } catch (_) {}
      return Promise.race([exited, sleep(10000).then(() => 'timeout')])
    }
  }
}

// 让另一个活着的 node 进程用本软件的 lockService 给表格上锁（模拟「另一个项目窗口正开着这张表」）
async function holdLockElsewhere (excelPath) {
  const lockService = path.join(root, 'electron', 'services', 'lockService.js')
  const code = "const s = require(process.argv[1]); const res = s.acquire(process.argv[2], '别的项目', 'C:/其他目录/其他项目.json'); console.log(res.ok ? 'held' : 'fail'); setInterval(() => {}, 1000)"
  const child = spawn(process.execPath, ['-e', code, '--', lockService, excelPath], { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true })
  let out = ''
  child.stdout.on('data', d => { out += d })
  const exited = new Promise(resolve => child.on('exit', code => resolve(code)))
  const t0 = Date.now()
  while (!/held|fail/.test(out) && Date.now() - t0 < 15000) await sleep(200)
  if (!/held/.test(out)) { try { child.kill() } catch (_) {} throw new Error('辅助进程没能给表格上锁：' + out) }
  return { pid: child.pid, exited, kill: async () => { try { child.kill() } catch (_) {} await exited } }
}

// 像用户又双击了一次程序图标那样，再启动一个（不带调试口参数）。返回它的退出码；15 秒内没退出就强行结束并返回 'still-running'
async function secondInstance (env) {
  const child = spawn(env.target.cmd, [...env.target.args, `--user-data-dir=${env.userData}`], { cwd: env.target.cwd, stdio: 'ignore' })
  const exited = new Promise(resolve => child.on('exit', code => resolve(code)))
  const code = await Promise.race([exited, sleep(15000).then(() => 'still-running')])
  if (code === 'still-running') killTree(child)
  return code
}

const needDialogs = () => { if (!app.dialogsReady) throw new Error('没连上主进程的调试口，无法模拟系统的文件对话框') }

// =====================================================================================================
// A. 第一次使用
// =====================================================================================================
async function partFirstUse () {
  r.section('第一次使用：没有任何历史项目')
  const env = prepare({ mode, sample, withRecent: false, projectName: '新队员测试项目' })
  envs.push(env)
  writeHolderScript(path.join(env.dir, 'hold-excel.ps1'), 'ReadWrite', 'Read')
  writeHolderScript(path.join(env.dir, 'hold-config.ps1'), 'Read', 'ReadWrite')
  app = await launchApp(env, { tag: 'a-' })
  apps.push(app)
  needDialogs()
  if (!r.check(await waitWelcome(), '程序启动，显示欢迎页')) throw new Error('程序没有正常启动到欢迎页')
  await sleep(600)
  r.check(await has('暂无最近项目') && (await recentBadge()) === '0', '「最近项目」是空的，角标是 0')

  r.section('新建项目：每一项必填信息没填时会拦住')
  await app.clickContaining('新建项目')
  await settled()
  r.check((await modalText()).includes('项目名称'), '点「新建项目」：弹出新建窗口')
  await app.click('创建并进入项目')
  await expectAlert('请输入项目名称', '什么都不填就点创建：提示「请输入项目名称」')
  await setModalInput(0, '新队员测试项目')
  await app.click('创建并进入项目')
  await expectAlert('请选择要关联的 Excel 表格', '只填了名称：提示先选择表格')
  await app.setDialogs({ open: null })
  await app.click('选择文件')
  await settled()
  r.check((await modalInputValue(1)) === '' && (await modalText()).includes('项目名称'), '「选择文件」对话框里点了取消：什么都没选上，还停在新建窗口')
  await app.setDialogs({ open: env.excelPath })
  await app.click('选择文件')
  await settled()
  r.check((await modalInputValue(1)) === env.excelPath, '选中表格后，输入框里显示表格的完整路径')
  await app.click('创建并进入项目')
  await expectAlert('请选择项目工程配置文件（.json）的保存位置', '没选配置文件存哪儿：提示选择保存位置')
  await app.setDialogs({ save: null })
  await app.click('浏览…')
  await settled()
  r.check((await modalInputValue(2)) === '' && (await modalText()).includes('项目名称'), '「保存位置」对话框里点了取消：还停在新建窗口')

  r.section('新建项目：按模板初始化新表')
  await app.clickContaining('按模板初始化新建')
  await settled()
  await app.setDialogs({ open: null })
  await app.click('选择文件夹')
  await settled()
  r.check((await modalInputValue(1)) === '', '「选择文件夹」对话框里点了取消：什么都没选上')
  await app.setDialogs({ open: env.dir })
  await app.click('选择文件夹')
  await settled()
  r.check(await has('将在所选文件夹中创建：新队员测试项目.xlsx'), '不单独填表格文件名时：默认和项目同名（新队员测试项目.xlsx）')
  await setModalInput(0, '按模板新建的项目')
  r.check(await has('将在所选文件夹中创建：按模板新建的项目.xlsx'), '改了项目名：默认的表格文件名跟着变')
  await makeSheet(path.join(env.dir, '已存在表.xlsx'), ws => ws.addRow(['占位']))
  await setModalInput(2, '已存在表')
  await app.setDialogs({ save: path.join(env.dir, '重名检查.json') })
  await app.click('浏览…')
  await settled()
  r.check((await modalInputValue(3)) === path.join(env.dir, '重名检查.json'), '选好了配置文件的保存位置')
  await app.click('创建并进入项目')
  await expectAlert('该位置已存在同名 Excel 文件，请换一个文件名', '新表格和文件夹里已有的文件重名：拒绝创建，说明原因')
  r.check(!fs.existsSync(path.join(env.dir, '重名检查.json')) && !(await has('在册有效队员')), '没有覆盖别人的文件，没有生成项目文件，还停在新建窗口')
  await setModalInput(2, '存不下的项目')
  await app.setDialogs({ save: path.join(env.dir, '已经不存在的子文件夹', '存不下的项目.json') })
  await app.click('浏览…')
  await settled()
  await app.click('创建并进入项目')
  await expectAlert('项目配置写入失败', '配置文件的保存位置其实已经不存在（比如 U 盘被拔了）：如实报告')
  r.check(!fs.existsSync(path.join(env.dir, '存不下的项目.xlsx')) && !fs.existsSync(lockFileOf(path.join(env.dir, '存不下的项目.xlsx'))), '这种情况会把刚生成的表格和锁文件一并清掉，不留半成品')
  await setModalInput(2, '新队员积分表')
  await app.setDialogs({ save: path.join(env.dir, '按模板新建的项目.json') })
  await app.click('浏览…')
  await settled()
  await app.click('创建并进入项目')
  r.check(await waitWorkspace(), '信息填全后创建：生成新表格，直接进入工作区')
  await app.shot('01-按模板新建.png')

  const generated = path.join(env.dir, '新队员积分表.xlsx')
  const generatedConfig = path.join(env.dir, '按模板新建的项目.json')
  r.check(fs.existsSync(generated) && fs.existsSync(generatedConfig), '新表格和项目配置文件都生成在选定的位置')
  const wsNew = await openSheet(generated)
  const wsReal = await openSheet(env.samplePath)
  const heads = ws => [1, 2, 3, 4, 5, 6].map(c => String(ws.getRow(1).getCell(c).value || '').trim())
  const cohorts = ws => {
    const found = []
    for (let row = 2; row <= ws.rowCount; row++) {
      const v = ws.getRow(row).getCell(1).value
      if (typeof v === 'string' && /届/.test(v)) found.push(v.trim())
    }
    return found
  }
  const widths = ws => [1, 2, 3, 4, 5, 6, 7].map(c => Math.round((ws.getColumn(c).width || 0) * 100) / 100)
  r.check(JSON.stringify(heads(wsNew)) === JSON.stringify(heads(wsReal)) && JSON.stringify(heads(wsNew)) === JSON.stringify(['姓名', '夜训周训', '升降旗', '后勤', '综办', '汇总']), `表头 A~F 与正式积分表一致（${heads(wsNew).join(' | ')}）`)
  r.check(JSON.stringify(widths(wsNew)) === JSON.stringify(widths(wsReal)), `A~G 列宽与正式积分表一致（${widths(wsNew).join('，')}）`)
  r.check(JSON.stringify(cohorts(wsNew)) === JSON.stringify(['--30届--', '--29届--', '--28届--', '--27届--', '--26届--']) && JSON.stringify(cohorts(wsNew)) === JSON.stringify(cohorts(wsReal)),
    `届别行与正式表里的 5 个届别一致、按届数从高到低排（${cohorts(wsNew).join(' ')}；正式表里是 ${cohorts(wsReal).join(' ')}）`)
  r.check([1, 2, 3, 4, 5, 6, 7, 8].every(row => wsNew.getRow(row).getCell(7).value === null) && [7, 8, 9, 10].every(row => [1, 2, 3, 4, 5, 6].every(c => wsNew.getRow(row).getCell(c).value === null)), '第 7 列是空白分隔列；第 7 行起是空的队员区')
  const pane = ws => JSON.stringify({ views: (ws.views || []).map(v => [v.state, v.xSplit, v.ySplit]), h1: ws.getRow(1).height })
  r.check(pane(wsNew) === JSON.stringify({ views: [['frozen', 1, 1]], h1: 40 }), `冻结首行首列、表头行高 40（实际：${pane(wsNew)}）`)

  r.section('在新生成的表上录入第一个活动')
  const lockA = readLock(lockFileOf(generated))
  r.check(!!lockA && lockA.pid === app.pid && lockA.projectName === '按模板新建的项目', '新表格旁生成占用锁文件，记录的是本程序的进程号和项目名')
  const cfgA = JSON.parse(fs.readFileSync(generatedConfig, 'utf-8'))
  r.check(cfgA.excelPath === generated && cfgA.projectName === '按模板新建的项目' && Array.isArray(cfgA.history) && cfgA.history.length === 0 && cfgA.settings.dailyTrainingScore === 1, '项目配置文件内容正确（绑定的表格路径、项目名、空历史、默认单次训练分值 1）')
  await closeToWelcome()
  r.check(!fs.existsSync(lockFileOf(generated)), '关闭项目后，新表格旁的锁文件被删除')
  r.check((await recentNames()).some(n => n.includes('按模板新建的项目')) && (await recentBadge()) === '1', '「最近项目」里出现了刚新建的项目')
  await editSheet(generated, ws => { ws.getRow(7).getCell(1).value = '甲'; ws.getRow(8).getCell(1).value = '乙' })
  r.check((await clickRecent('按模板新建的项目')) === 'ok' && await waitWorkspace(), '像平时一样往新表里填了两个队员，再从「最近项目」重新打开')
  await toEventPage()
  await fillEvent('开训第一旗', '甲', '乙', '甲、乙')
  await commitEventAndExpect('开训第一旗', '已追加活动列「开训第一旗」（主表第 8 列）')
  const wsA = await openSheet(generated)
  r.check(wsA.getCell('G7').value === null && wsA.getCell('H1').value === '开训第一旗' && wsA.getCell('H7').value === 3 && wsA.getCell('H8').value === 2 && wsA.getCell('F7').value === 3 && wsA.getCell('F8').value === 2,
    '表格里：甲 +3（主教官 2 + 正式参加 1）、乙 +2（彩排 1 + 正式参加 1），第 7 列仍然空着，汇总分跟着更新')

  r.section('「打开项目」对话框，以及各种打不开的项目文件')
  await closeToWelcome()
  fs.writeFileSync(env.configPath, JSON.stringify(env.cfg, null, 2), 'utf-8')
  await app.setDialogs({ open: null })
  await app.clickContaining('打开项目')
  await settled()
  r.check(await has('欢迎回来') && !(await modalText()) && !fs.existsSync(env.lockFile), '对话框里点了取消：什么都不发生')
  await app.setDialogs({ open: env.configPath })
  await app.clickContaining('打开项目')
  r.check(await waitWorkspace(), '选中一个项目文件：进入工作区')
  r.check(fs.existsSync(env.lockFile), '打开后，表格旁生成锁文件')

  // 最近项目里塞一条「表格和配置都已经被移走」的条目；程序只有在打开失败后才会重新读这个列表，所以放在下面最后一步之前写入
  const recentFile = path.join(env.userData, 'recent.json')
  const list = JSON.parse(fs.readFileSync(recentFile, 'utf-8'))
  const moved = { projectName: '已经被移走的项目', configPath: 'C:\\已经不存在\\已经被移走的项目.json', excelPath: 'C:\\已经不存在\\总积分表.xlsx', lastOpened: new Date().toISOString(), valid: true }
  const badConfigs = [
    ['坏的-不是JSON.json', '{ 这不是 JSON', '这个文件不是有效的项目文件（JSON 解析失败'],
    ['坏的-不是项目文件.json', JSON.stringify({ hello: 1 }), '这不是本软件的项目文件'],
    ['坏的-表格不存在.json', JSON.stringify({ ...env.cfg, excelPath: path.join(env.dir, '不存在的表格.xlsx') }), '绑定的 Excel 文件不存在'],
    ['坏的-签名不符.json', JSON.stringify({ ...env.cfg, excelSignature: 'deadbeef:1' }), 'Excel 文件特征签名不匹配']
  ]
  for (const [name, content, part] of badConfigs) {
    if (name === badConfigs[badConfigs.length - 1][0]) writeRecent(env, [...list, moved])
    const file = path.join(env.dir, name)
    fs.writeFileSync(file, content, 'utf-8')
    await closeToWelcome()
    await app.setDialogs({ open: file })
    await app.clickContaining('打开项目')
    const text = await waitAlert(part)
    r.check(text.includes(part), `打开「${name}」：拦下并说明原因（${part}…）` + (text.includes(part) ? '' : `（实际提示：${text.replace(/\s+/g, ' ') || '没有出现提示'}）`))
    r.check(await has('欢迎回来') && !fs.existsSync(env.lockFile), '仍停在欢迎页，没有留下锁文件')
    await app.closeAlert()
    await settled()
  }

  r.section('「最近项目」里的失效条目')
  const movedCard = await recentCardText('已经被移走的项目')
  r.check(!!movedCard && movedCard.includes('失效'), '表格和配置文件都不存在的项目：卡片上标着「失效」')
  r.check((await recentBadge()) === String(list.length + 1), `最近项目的角标是 ${list.length + 1}`)
  r.check((await clickRecent('已经被移走的项目')) === 'ok' && (await sleep(900), await has('欢迎回来')) && !(await alertNow()), '点失效的项目：没有反应（也进入不了工作区）')
  await app.run(`(() => { const c = [...document.querySelectorAll(${JSON.stringify(CARD)})].find(x => x.textContent.includes('已经被移走的项目')); const b = c && c.querySelector('button[title="从列表清除"]'); if (!b) throw new Error('找不到清除按钮'); b.click() })()`)
  await settled()
  r.check(!(await recentCardText('已经被移走的项目')) && (await recentBadge()) === String(list.length), '点 ✕：从列表里清除')
  await app.shot('02-最近项目.png')
  r.check(app.rendererErrors.length === 0, `界面进程没有未捕获的异常（${app.rendererErrors.length} 条）`)
  await shutdown(env)
}

// =====================================================================================================
// B ~ H
// =====================================================================================================
async function partTroubles () {
  const env = prepare({ mode, sample, projectName: '场景测试项目' })
  envs.push(env)
  const excelHolder = path.join(env.dir, 'hold-excel.ps1')
  const configHolder = path.join(env.dir, 'hold-config.ps1')
  writeHolderScript(excelHolder, 'ReadWrite', 'Read')
  writeHolderScript(configHolder, 'Read', 'ReadWrite')
  const d0 = (await svc.readWorkbook(env.excelPath)).data
  const [n0, n1, n2, n3, n4, n5, n6, n7] = d0.members.filter(m => !d0.duplicateNames.includes(m.name)).slice(0, 8).map(m => m.name)
  const read = async () => (await svc.readWorkbook(env.excelPath)).data
  const num = (d, name, key) => { const m = d.members.find(x => x.name === name); return m ? m[key] : `没找到 ${name}` }
  const extra = (d, name, col) => { const m = d.members.find(x => x.name === name); return m ? m.extras[col] : `没找到 ${name}` }

  app = await launchApp(env, { tag: 'b-' })
  apps.push(app)
  needDialogs()
  if (!r.check(await waitWelcome(), '程序启动，显示欢迎页')) throw new Error('程序没有正常启动到欢迎页')
  await sleep(500)
  r.check((await clickRecent('场景测试项目')) === 'ok' && await waitWorkspace(), '从最近项目打开：进入工作区')

  // ---------- B ----------
  r.section('表格正在 Excel / WPS 里开着（用另一个进程把文件占住来模拟）')
  await closeToWelcome()
  const holderOpen = await holdWithPowerShell(excelHolder, env.excelPath)
  await clickRecent('场景测试项目')
  await expectAlert('这张表格正被其他程序占用（多半是在 Excel / WPS 里开着），请先关闭该表格再试', '这种情况下打开项目：拦下并说明原因')
  r.check(await has('欢迎回来') && !fs.existsSync(env.lockFile), '没有进入工作区，也没有生成锁文件')
  r.check((await holderOpen.release()) !== 'timeout', '（辅助进程放开了表格）')
  r.check((await clickRecent('场景测试项目')) === 'ok' && await waitWorkspace(), '关掉那个程序后：可以正常打开')

  const hashB = sha1(env.excelPath)
  const backupsB = backupFiles(env.excelPath).length
  const holderWrite = await holdWithPowerShell(excelHolder, env.excelPath)
  await app.nav('仪表盘与排名')
  await waitText('在册有效队员')
  await app.click('刷新数据')
  await sleep(1500)
  r.check(!(await alertNow()) && (await has('在册有效队员')), '表格被占着的时候，「刷新数据」照常可用（只是读，不受影响）')
  await toEventPage()
  await fillEvent('占用时写入', n0, n1, n2)
  await app.click('生成预览')
  r.check(await previewShown('占用时写入'), '预览照常生成（预览只在内存里算，不碰表格）')
  await app.click('确认写入 Excel')
  await expectAlert('写入失败：Excel 文件正被其他程序占用，请关闭该表格后重试', '写入被拦下：提示先关闭表格')
  r.check(sha1(env.excelPath) === hashB, '表格文件一个字节都没变')
  r.check(backupFiles(env.excelPath).length === backupsB && tmpLeftovers(env.dir).length === 0, '被拦下的写入不留备份、不留临时文件')
  r.check(await previewShown('占用时写入'), '预览窗口还开着，解除占用后可以直接重试')
  await app.shot('03-表格被占用.png')
  await holderWrite.release()
  await app.click('确认写入 Excel')
  r.check(await waitToast('已追加活动列「占用时写入」'), '关掉那个程序后，在同一个预览窗口再点一次：写入成功')

  // ---------- C ----------
  r.section('项目配置文件正被别的软件开着')
  const hashC = sha1(env.excelPath)
  const histC = readConfig(env).history.length
  const holderCfg = await holdWithPowerShell(configHolder, env.configPath)
  await fillEvent('配置被占用时写入', n3, n4, n5)
  await app.click('生成预览')
  await app.click('确认写入 Excel')
  const textC = await waitAlert('本次操作未生效')
  r.check(textC.includes('项目配置保存失败') && textC.includes('配置文件正被其他程序占用') && textC.includes('已经自动回滚'), 'Excel 写进去了、配置却存不下来：提示「本次操作未生效」，说明已自动回滚' + (textC.includes('已经自动回滚') ? '' : `（实际提示：${textC.replace(/\s+/g, ' ')}）`))
  r.check(sha1(env.excelPath) === hashC, 'Excel 已经回滚：和这次写入之前一字节不差')
  r.check(readConfig(env).history.length === histC && tmpLeftovers(env.dir).length === 0, '历史记录没有多出这一笔，也没留下写了一半的临时文件')
  await app.shot('04-配置被占用-已回滚.png')
  await app.closeAlert()
  await settled()
  await holderCfg.release()
  await app.click('确认写入 Excel')
  r.check(await waitToast('已追加活动列「配置被占用时写入」') && readConfig(env).history.length === histC + 1, '关掉那个软件后再点一次：写入成功，历史里记上这一笔')

  // ---------- D ----------
  r.section('活动名里带引号、&、< > 等特殊符号')
  const SPECIAL = '季度"表彰"&<特别>活动'
  const specialCol = d0.lastCol + 3
  // 存一份"做后面的操作之前"的表格，最后全部撤销后要和它逐格一致
  const baseline = path.join(env.dir, '基准.xlsx')
  fs.copyFileSync(env.excelPath, baseline)
  await fillEvent(SPECIAL, n6, n7, n2)
  await commitEventAndExpect(SPECIAL, `已追加活动列「${SPECIAL}」（主表第 ${specialCol} 列）`)
  const dD = await read()
  r.check(dD.activityColumns.some(c => c.name === SPECIAL && c.col === specialCol) && num(dD, n6, 'f') === round4(num(d0, n6, 'f') + 2) && extra(dD, n2, specialCol) === 1, '表格里的表头原样保存（特殊符号没有被吃掉或转义），分数正确')
  const recD = readConfig(env).history[readConfig(env).history.length - 1]
  r.check(recD.label === SPECIAL, '历史记录里的活动名也是原样')
  await app.nav('仪表盘与排名')
  await waitText('在册有效队员')
  r.check(await has(SPECIAL), '榜单的表头照常显示这个活动名')
  await app.shot('05-特殊符号活动名.png')

  // ---------- E ----------
  r.section('批量数据导入')
  const dailyFile = path.join(env.dir, '日常考勤.xlsx')
  const flagFile = path.join(env.dir, '升降旗考勤.xlsx')
  const deptFile = path.join(env.dir, '后勤统计.xlsx')
  const badHeaderFile = path.join(env.dir, '坏表头.xlsx')
  const formulaFile = path.join(env.dir, '公式没结果.xlsx')
  const emptyFile = path.join(env.dir, '空数据.xlsx')
  // 日常考勤表故意做得很"不规整"：表头里加了排版空格；n5 的名字每个字之间都加了空格（名单里常见的对齐写法）
  await makeSheet(dailyFile, ws => { ws.addRow(['姓 名', '总次数']); ws.addRow([n0, 3]); ws.addRow([n1, 2]); ws.addRow(['查无此人乙', 4]); ws.addRow(['', 9]); ws.addRow([n5.split('').join(' '), 2]) })
  await makeSheet(flagFile, ws => { ws.addRow(['姓名', '总次数']); ws.addRow([n2, 2]); ws.addRow([n3, 1]) })
  // 部门统计表有两个工作表：第一个是封面（没有表头），要导入的数据在第二个工作表里
  const deptWb = new ExcelJS.Workbook()
  deptWb.addWorksheet('封面').addRow(['后勤部 2026 年秋季学期工作统计'])
  const deptWs = deptWb.addWorksheet('统计')
  deptWs.addRow(['姓名', '序号', '备注', '总积分']); deptWs.addRow([n0, 7, '十月的后勤', 1.5]); deptWs.addRow(['', 2, '这一行没有名字', 9]); deptWs.addRow([n4, 1, '九月的后勤', 2])
  await deptWb.xlsx.writeFile(deptFile)
  await makeSheet(badHeaderFile, ws => { ws.addRow(['名字', '次数']); ws.addRow([n0, 3]) })
  await makeSheet(formulaFile, ws => { ws.addRow(['姓名', '总次数']); ws.addRow([n0]); ws.getCell('B2').value = { formula: '1+1' } })
  await makeSheet(emptyFile, ws => { ws.addRow(['姓名', '总次数']) })

  await app.nav('批量数据导入')
  await waitText('部门积分互斥锁状态')
  r.check((await lockState('后勤部（D 列）')).endsWith('开放') && (await lockState('综办部（E 列）')).endsWith('开放'), '两个部门入口都是「开放」')
  await app.setDialogs({ open: null })
  await app.clickContaining('日常训练考勤')
  await sleep(1200)
  r.check(!(await modalText()), '文件选择框里点了取消：不弹配置窗口')

  // 日常训练考勤
  const dE0 = await read() // 导入之前的表格（已经包含上面三个活动）
  await app.setDialogs({ open: dailyFile })
  await app.clickContaining('日常训练考勤')
  r.check(await waitText(`日常训练考勤导入 · 已解析 日常考勤.xlsx`), '选中文件后出现配置窗口，标题带着文件名')
  r.check(await has('成功解析 4 行有效数据'), '解析出 4 行有效数据（没有名字的那一行被跳过；表头里的排版空格不影响识别）')
  await app.setValue(MODAL + ' input[type="number"]', 0, '0')
  await settled()
  r.check(await has('单次训练分值必须是大于 0 的数字') && ((await app.buttonState('下一步：生成预览')) || {}).disabled === true, '单次分值填 0：提示必须是大于 0 的数字，「下一步」是灰的')
  await app.setValue(MODAL + ' input[type="number"]', 0, '0.5')
  await settled()
  r.check(!(await has('单次训练分值必须是大于 0 的数字')) && ((await app.buttonState('下一步：生成预览')) || {}).disabled === false, '改成 0.5：可以继续')
  await app.click('下一步：生成预览')
  r.check(await waitText('日常训练考勤导入 · 预览确认') && await has('⚠ 检测到 1 个姓名未在主表花名册中'), '进入预览：提醒有 1 个姓名不在花名册里（名字里加了排版空格的那一位被认出来了，不算异常）')
  r.check((await app.selectOption(MODAL + ' select', 0, n7)) === 'ok', '把「查无此人乙」映射到名单里的一位队员')
  await settled()
  // 「查无此人乙」这一行现在是什么样子：下拉框还在不在、选的是谁
  const mappedRow = () => app.run(`(() => {
    const tr = [...document.querySelectorAll(${JSON.stringify(MODAL + ' tbody tr')})].find(tr => tr.innerText.includes('查无此人乙'))
    if (!tr) return null
    const sel = tr.querySelector('select')
    return { text: tr.innerText.replace(/\\s+/g, ' ').trim(), hasSelect: !!sel, value: sel ? sel.value : null }
  })()`)
  // 映射之后这一行的下拉框必须还在。以前映射完，这一行会并进被映射队员的那一行，下拉框跟着消失，选错了没法改
  const mapped1 = await mappedRow()
  const ok1 = !!mapped1 && mapped1.hasSelect === true && mapped1.value === n7 && mapped1.text.includes(`改记为 ${n7}`)
  r.check(ok1, `映射之后这一行仍然单独存在：写明「查无此人乙 改记为 ${n7}」，下拉框还在` + (ok1 ? '' : `（实际：${mapped1 ? mapped1.text.slice(0, 80) : '没找到这一行'}）`))
  r.check(await has('实际写入 4 人，合计 +5.5 分'), '合计：4 人、+5.5 分')
  r.check((await app.selectOption(MODAL + ' select', 0, 'ignore')) === 'ok', '把这一行改选成「忽略该人员」')
  await settled()
  const ignoredRow = await mappedRow()
  const ok2 = !!ignoredRow && ignoredRow.hasSelect === true && ignoredRow.value === 'ignore' && ignoredRow.text.includes('跳过') && await has('实际写入 3 人，合计 +3.5 分')
  r.check(ok2, '映射可以反悔：改成忽略后这一行显示「跳过」，合计变成 3 人、+3.5 分' + (ok2 ? '' : `（实际：${ignoredRow ? ignoredRow.text.slice(0, 80) : '没找到这一行'}）`))
  r.check((await app.selectOption(MODAL + ' select', 0, n7)) === 'ok', '再改回映射到那位队员')
  await settled()
  r.check(await has('实际写入 4 人，合计 +5.5 分'), '合计：又变回 4 人、+5.5 分')
  await app.shot('06-日常训练导入预览.png')
  await app.click('确认导入并落盘')
  r.check(await waitToast('日常训练考勤导入（0.5 分/次）成功 · 4 人，全表汇总分已重新计算'), '写入成功的提示里带着分值和人数')
  const dE1 = await read()
  r.check(num(dE1, n0, 'b') === round4(num(dE0, n0, 'b') + 1.5) && num(dE1, n1, 'b') === round4(num(dE0, n1, 'b') + 1) && num(dE1, n7, 'b') === round4(num(dE0, n7, 'b') + 2) &&
    num(dE1, n5, 'b') === round4(num(dE0, n5, 'b') + 1),
    '表格里：+1.5、+1、+2，名字里加了空格的那位 +1（0.5 分 × 次数）')
  // 汇总分 = 夜训周训 + 升降旗 + 后勤 + 综办 + 各活动列
  const sumOf = (d, name) => round4(['b', 'c', 'd', 'e'].reduce((s, k) => s + (num(d, name, k) || 0), 0) + Object.values((d.members.find(x => x.name === name) || {}).extras || {}).reduce((s, v) => s + (v || 0), 0))
  const added = { [n0]: 1.5, [n1]: 1, [n5]: 1, [n7]: 2 }
  r.check([n0, n1, n5, n7].every(name => num(dE1, name, 'f') === sumOf(dE1, name) && num(dE1, name, 'f') === round4(num(dE0, name, 'f') + added[name])),
    `这四人的汇总分都重新算过（${[n0, n1, n5, n7].map(name => `${name}：${num(dE0, name, 'f')} → ${num(dE1, name, 'f')}，各项之和 ${sumOf(dE1, name)}`).join('；')}）`)
  r.check(readConfig(env).settings.dailyTrainingScore === 0.5 && (await has('当前单次训练分值：0.5 分')), '单次训练分值 0.5 存进了项目配置，导入页上显示的是 0.5')

  // 升降旗考勤
  const c2 = num(dE0, n2, 'c'); const c3 = num(dE0, n3, 'c')
  await app.setDialogs({ open: flagFile })
  await app.clickContaining('升降旗考勤')
  await waitText('升降旗考勤导入 · 已解析 升降旗考勤.xlsx')
  await app.clickContaining('选项 B：节假日升降旗')
  await settled()
  r.check(await has('核算公式：本次新增得分 = 总次数 × 1'), '选「节假日升降旗」：倍率 1.0')
  await app.click('下一步：生成预览')
  r.check(await waitText('升降旗考勤导入 · 预览确认') && await has('目标：C 列（升降旗）'), '预览里写明写到 C 列')
  await app.click('确认导入并落盘')
  r.check(await waitToast('升降旗考勤导入（节假日升降旗）成功 · 2 人'), '写入成功')
  const dE2 = await read()
  r.check(num(dE2, n2, 'c') === round4(c2 + 2) && num(dE2, n3, 'c') === round4(c3 + 1), '表格里：+2、+1')

  // 部门积分
  const dd0 = num(dE0, n0, 'd'); const dd4 = num(dE0, n4, 'd')
  await app.setDialogs({ open: deptFile })
  await app.clickContaining('部门专职积分')
  await waitText('部门积分导入 · 已解析 后勤统计.xlsx')
  r.check(await has('成功解析 2 行有效数据，取自工作表「统计」'), '这个文件第一个工作表是封面：程序自动跳过它，从第二个工作表读出 2 行有效数据，并在窗口里写明读的是哪个工作表')
  await app.clickContaining('后勤部')
  await app.click('下一步：生成预览')
  r.check(await waitText('部门积分导入 · 预览确认') && await has('目标：D 列（后勤部）') && await has('实际写入 2 人，合计 +3.5 分'), '预览：写到 D 列，2 人、+3.5 分')
  await app.click('确认导入并落盘')
  r.check(await waitToast('后勤部积分导入成功 · 2 人'), '写入成功')
  const dE3 = await read()
  r.check(num(dE3, n0, 'd') === round4(dd0 + 1.5) && num(dE3, n4, 'd') === round4(dd4 + 2), '表格里：+1.5、+2')
  const cfgE3 = readConfig(env)
  r.check(cfgE3.locks.is_logistics_imported === true && cfgE3.locks.is_comprehensive_imported === false, '项目配置里：后勤标记为「已导入」，综办没有')
  r.check((await has('后勤已导入')) && (await lockState('后勤部（D 列）')).endsWith('已导入锁定') && (await lockState('综办部（E 列）')).endsWith('开放'), '顶栏出现「后勤已导入」；后勤入口变成「已导入锁定」，综办仍然开放')
  await app.setDialogs({ open: deptFile })
  await app.clickContaining('部门专职积分')
  await waitText('部门积分导入 · 已解析 后勤统计.xlsx')
  const optState = await app.run(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(MODAL + ' button')})].find(x => x.textContent.includes('该部门积分已导入')); return b ? { disabled: b.disabled } : null })()`)
  r.check(!!optState && optState.disabled === true, '再导入一次时：「后勤部」选项是灰的，并说明要先去历史里撤销')
  await app.click('取消')
  await settled()

  // 三种坏文件（每试一个，主表都不该有任何变化）
  const hashGood = sha1(env.excelPath)
  for (const [file, part, label] of [
    [badHeaderFile, '没有在导入文件里找到「姓名 / 总次数」表头', '表头不对（写的是「名字 / 次数」）的文件'],
    [formulaFile, '没有保存计算结果', '数值是个没算出结果的公式的文件'],
    [emptyFile, '导入文件中没有解析到任何有效数据行（姓名列为空）', '只有表头、没有数据的文件']
  ]) {
    await app.setDialogs({ open: file })
    await app.clickContaining('日常训练考勤')
    const text = await waitAlert(part)
    r.check(text.includes(part), `${label}：拒绝导入并说明原因` + (text.includes(part) ? '' : `（实际提示：${text.replace(/\s+/g, ' ') || '没有出现提示'}）`))
    await app.closeAlert()
    await settled()
  }
  r.check(sha1(env.excelPath) === hashGood, '三个坏文件都没有动到主表')

  // ---------- F ----------
  r.section('把上面的导入和活动逐个撤销')
  await app.nav('历史流水与撤销')
  await waitText('操作类型')
  const undo = async (type, label, explain, toastPart) => {
    const info = await rowInfo(type)
    r.check(!!info && info.label.startsWith(label) && info.status === '活跃' && info.undoDisabled === false, `历史流水里「${label}」是活跃的，可以撤销（实际：${info ? `${info.status}，撤销按钮${info.undoDisabled ? '灰' : '可点'}` : '没找到这一行'}）`)
    r.check((await rowAction(type, '撤销')) === 'ok', `点「${label}」的撤销`)
    const confirm = await modalText()
    r.check(confirm.includes('确认撤销该批次？') && confirm.includes(explain), `确认框里说明会怎么撤销：${explain}`)
    await app.click('确认撤销')
    r.check(await waitToast(toastPart), `撤销成功：${toastPart}`)
    const after = await rowInfo(type)
    r.check(!!after && after.status === '已撤销' && after.undoDisabled === true, '这一笔变成「已撤销」，不能再撤一次')
  }
  await undo('部门积分', '后勤部积分导入', '在原来写入的那一列反向扣除本批次全部分值。同时释放对应部门的互斥锁，入口将重新开放。', '已撤销「后勤部积分导入」')
  r.check(readConfig(env).locks.is_logistics_imported === false && !(await has('后勤已导入')), '后勤的互斥锁解开了：顶栏的「后勤已导入」消失')
  await undo('升降旗', '升降旗考勤导入（节假日升降旗）', '在原来写入的那一列反向扣除本批次全部分值。撤销后全表 F 列汇总会重新计算', '已撤销「升降旗考勤导入（节假日升降旗）」')
  await undo('日常训练', '日常训练考勤导入（0.5 分/次）', '在原来写入的那一列反向扣除本批次全部分值。撤销后全表 F 列汇总会重新计算', '已撤销「日常训练考勤导入（0.5 分/次）」')
  await undo('新建大型活动', SPECIAL, `在 Excel 中物理删除「${SPECIAL}」整列（右侧各列自动左移）。`, `已撤销「${SPECIAL}」`)
  await app.shot('07-撤销之后.png')

  r.section('撤销之后和做这些操作之前逐格对比')
  const diff = await compareWorkbooks(baseline, env.excelPath)
  r.check(diff.valueChanged.length === 0 && diff.styleChanged.length === 0 && diff.added.length === 0 && diff.removed.length === 0,
    `内容变化 ${diff.valueChanged.length} 格 / 样式变化 ${diff.styleChanged.length} 格 / 新增 ${diff.added.length} / 消失 ${diff.removed.length}`)
  await app.nav('批量数据导入')
  await waitText('部门积分互斥锁状态')
  r.check((await lockState('后勤部（D 列）')).endsWith('开放'), '导入页上后勤入口重新变成「开放」')

  // ---------- G ----------
  r.section('程序已经开着的时候，又双击了一次图标')
  const second = await secondInstance(env)
  r.check(second !== 'still-running', `第二个窗口自己退出了（退出码 ${second}）`)
  r.check(app.child.exitCode === null, '原来那个窗口还在运行')
  await app.nav('仪表盘与排名')
  await waitText('在册有效队员')
  await app.click('刷新数据')
  await sleep(1200)
  r.check(!(await alertNow()) && (await has('在册有效队员')), '原来那个窗口仍然可以正常操作')

  // ---------- H ----------
  r.section('表格被别的项目占着（另一个活着的进程留下的锁）')
  await closeToWelcome()
  const helper = await holdLockElsewhere(env.excelPath)
  const lockH = readLock(env.lockFile)
  r.check(!!lockH && lockH.pid === helper.pid && lockH.projectName === '别的项目', '另一个进程在表格旁留下了占用锁（占用项目：别的项目）')
  await clickRecent('场景测试项目')
  const textH = await waitAlert('这张表格已被其他项目占用（占用项目：别的项目）')
  r.check(textH.includes('这张表格已被其他项目占用（占用项目：别的项目）') && (await has('欢迎回来')), '打开项目：拦下，并说明是哪个项目占着' + (textH.includes('别的项目') ? '' : `（实际提示：${textH.replace(/\s+/g, ' ')}）`))
  await app.closeAlert()
  await settled()
  await helper.kill()
  r.check((await clickRecent('场景测试项目')) === 'ok' && await waitWorkspace(), '占着的那个进程已经退出了：锁被当成过期的，照常打开')
  r.check((readLock(env.lockFile) || {}).pid === app.pid, '锁文件改记为本程序')

  r.section('程序被强制结束（比如断电、任务管理器结束进程）后残留的锁')
  const oldApp = app
  r.check(oldApp.rendererErrors.length === 0, `被结束前，界面进程没有未捕获的异常（${oldApp.rendererErrors.length} 条）`)
  killTree(oldApp.child)
  await oldApp.waitExit()
  const stale = readLock(env.lockFile)
  r.check(!!stale && stale.pid === oldApp.pid, '锁文件来不及删，留在原地（记录的是已经不存在的进程号）')
  app = await launchApp(env, { tag: 'h-' })
  apps.push(app)
  if (!r.check(await waitWelcome(), '重新启动：显示欢迎页')) throw new Error('程序没有正常启动到欢迎页')
  await sleep(500)
  r.check((await clickRecent('场景测试项目')) === 'ok' && await waitWorkspace(), '残留的锁属于已经不存在的进程：不拦，照常打开')
  r.check((readLock(env.lockFile) || {}).pid === app.pid, '锁文件改记为新启动的程序')
  // 先断开测试脚本和主进程调试口的连接，否则程序退出时会一直等调试器断开（见 e2e-lib.cjs 里的说明）
  app.detachDebugger()
  const exitCode = await app.closeWindow()
  r.check(exitCode !== null && exitCode !== undefined, `点右上角 × 关窗口：程序退出（退出码 ${exitCode}）`)
  r.check(!fs.existsSync(env.lockFile), '关闭窗口时，锁文件被释放')
  r.check(app.rendererErrors.length === 0, `界面进程没有未捕获的异常（${app.rendererErrors.length} 条）`)
  r.check(tmpLeftovers(env.dir).length === 0, '整个过程没有留下写了一半的临时文件')
}

// =====================================================================================================
// I. 有人在 Excel 里手工改过主表 / J. 各种窗口大小下的排版
// =====================================================================================================
// 排版检查用的小脚本（在页面里执行）：列出某个区域里"内容比自己的可见宽度宽、却不带滚动条（直接被裁掉）"的元素。
// 单行省略号（truncate）是有意为之，不算
const clippedInJs = sel => `(() => {
  const root = document.querySelector(${JSON.stringify(sel)})
  return root
    ? [...root.querySelectorAll('*')]
      .filter(el => el.scrollWidth > el.clientWidth + 1 && /hidden|clip/.test(getComputedStyle(el).overflowX) && !/\\btruncate\\b/.test(el.className))
      .map(el => el.tagName.toLowerCase() + '.' + String(el.className).split(' ').slice(0, 3).join('.')).slice(0, 5)
    : ['（找不到这个区域）']
})()`

async function partHandEdited () {
  const env = prepare({ mode, sample, projectName: '手工改过的项目', subdir: '国护队 测试（中文 路径）' })
  envs.push(env)
  // 这一轮的表格放在带中文、全角括号和空格的文件夹里（真实的积分表多半就在这种路径下）：读写、锁文件、备份都得照常
  r.check(env.dir.includes('国护队 测试（中文 路径）'), '这一轮的测试表格放在带中文和空格的文件夹里')
  // 两个部门都标成"已导入"：顶栏同时挂两个徽标，是顶栏最挤的情况
  env.cfg.locks = { is_logistics_imported: true, is_comprehensive_imported: true }
  fs.writeFileSync(env.configPath, JSON.stringify(env.cfg, null, 2), 'utf-8')
  const d0 = (await svc.readWorkbook(env.excelPath)).data
  const [n0, n1, n2, n3] = d0.members.filter(m => !d0.duplicateNames.includes(m.name)).slice(0, 4).map(m => m.name)
  // 程序按姓名找行，同名时只认排在最前的那一行
  const rowOf = {}
  d0.members.forEach(m => { if (!(m.name in rowOf)) rowOf[m.name] = m.row })
  const read = async () => (await svc.readWorkbook(env.excelPath)).data
  const DUP = '重名活动' // 两列表头一样的活动列
  const EV = '同名队员的活动'
  const GONE = '会被手工删掉的活动'
  const c1 = d0.lastCol + 1
  const c2 = d0.lastCol + 2
  const evCol = c2 + 1
  const fmt = v => (v === null || v === undefined ? '—' : String(Math.round(Number(v) * 100) / 100))
  // 一个队员的汇总分应该等于的各项之和（四项明细 + 全部活动列）
  const sumOf = m => round4(['b', 'c', 'd', 'e'].reduce((s, k) => s + (m[k] || 0), 0) + Object.values(m.extras).reduce((s, v) => s + (v || 0), 0))
  const cellsOf = m => ['b', 'c', 'd', 'e'].map(k => fmt(m[k]))

  // 相当于有人在 Excel 里手工改了这张表：最后一个队员的下面多写了一行同名的（第二个 n0），最右边加了两列表头一样的活动列
  const dupRow = (await openSheet(env.excelPath)).rowCount + 1
  await editSheet(env.excelPath, ws => {
    ws.getRow(dupRow).getCell(1).value = n0
    ws.getRow(dupRow).getCell(2).value = 3
    ws.getRow(dupRow).getCell(6).value = 3
    ws.getRow(1).getCell(c1).value = DUP
    ws.getRow(1).getCell(c2).value = DUP
    ws.getRow(rowOf[n1]).getCell(c1).value = 1
    ws.getRow(rowOf[n1]).getCell(c2).value = 2
    const f = ws.getRow(rowOf[n1]).getCell(6)
    f.value = round4((typeof f.value === 'number' ? f.value : 0) + 3)
  })

  app = await launchApp(env, { tag: 'i-' })
  apps.push(app)
  if (!r.check(await waitWelcome(), '程序启动，显示欢迎页')) throw new Error('程序没有正常启动到欢迎页')
  await sleep(500)
  r.check((await clickRecent('手工改过的项目')) === 'ok' && await waitWorkspace(), '从最近项目打开：进入工作区')

  // ---------- I ----------
  r.section('主表里多了一个同名队员、两列重名的活动列')
  const lockI = readLock(env.lockFile)
  r.check(!!lockI && lockI.pid === app.pid, '表格在中文路径下：占用锁文件照常生成在它旁边，记录的是本程序的进程号')
  const bannerDupName = await bannerOf('检测到主表存在同名队员')
  r.check(bannerDupName === `检测到主表存在同名队员：${n0}。涉及修改与预览的环节会标注出来，请务必人工核对。`, `顶部提醒：主表存在同名队员 ${n0}` + (bannerDupName ? '' : '（没有出现提醒）'))
  const bannerDupCol = await bannerOf('活动列里有重名的列')
  r.check(!!bannerDupCol && bannerDupCol.startsWith(`活动列里有重名的列：${DUP}。`), `顶部提醒：活动列里有重名的列 ${DUP}` + (bannerDupCol ? '' : '（没有出现提醒）'))
  await app.nav('仪表盘与排名')
  await waitText('在册有效队员')
  const dash = await app.run(`(() => {
    const heads = [...document.querySelectorAll('thead th')].map(th => th.textContent.trim())
    const rows = [...document.querySelectorAll('tbody tr')].filter(tr => tr.children.length > 6)
    const stat = label => {
      const el = [...document.querySelectorAll('div')].find(x => x.children.length === 2 && x.firstElementChild && x.firstElementChild.textContent.trim() === label)
      return el ? el.lastElementChild.textContent.trim() : null
    }
    const sameName = rows.filter(tr => tr.children[1].textContent.trim().startsWith(${JSON.stringify(n0)}))
    return {
      dupHeads: heads.filter(h => h === ${JSON.stringify(DUP)}).length,
      total: stat('在册有效队员'),
      activities: stat('活动列数'),
      // 每行从 B 列起各格的文字：明细 4 格 + 活动列 + 汇总
      sameName: sameName.map(tr => ({ badge: tr.children[1].textContent.includes('同名待核对'), cells: [...tr.children].slice(3).map(td => td.textContent.trim()) }))
    }
  })()`)
  const first = d0.members.find(m => m.name === n0)
  const expectFirst = [...cellsOf(first), ...d0.activityColumns.map(ac => fmt(first.extras[ac.col])), '—', '—', fmt(first.f)]
  // 多出来的那一行：只有 B 列 3 分、汇总 3 分（两列重名活动的分数记在 n1 那一行，不在这行）
  const expectSecond = ['3', ...Array(3 + d0.activityColumns.length + 2).fill('—'), '3']
  const same = JSON.stringify
  r.check(dash.sameName.length === 2 && dash.sameName.every(x => x.badge) &&
    dash.sameName.some(x => same(x.cells) === same(expectFirst)) && dash.sameName.some(x => same(x.cells) === same(expectSecond)),
    '榜单上两行同名队员都列出来了，都标着「同名待核对」，显示的是各自那一行的分数' +
    (dash.sameName.length === 2 && dash.sameName.some(x => same(x.cells) === same(expectFirst)) && dash.sameName.some(x => same(x.cells) === same(expectSecond))
      ? ''
      : `（实际：${dash.sameName.map(x => x.cells.join(' ')).join(' ｜ ')}；应该是：${expectFirst.join(' ')} 和 ${expectSecond.join(' ')}）`))
  r.check(dash.dupHeads === 2 && dash.activities === String(d0.activityColumns.length + 2), `两列重名的活动列各占一列（表头出现 ${dash.dupHeads} 次），「活动列数」是 ${dash.activities}`)
  r.check(dash.total === String(d0.members.length + 1), `「在册有效队员」按行数统计，多出来的那行同名队员也算了一个（${dash.total}）`)
  await app.click('活动合并')
  await settled()
  const mergedCells = await app.run(`(() => {
    const tr = [...document.querySelectorAll('tbody tr')].find(tr => tr.children.length > 6 && tr.children[1].textContent.trim() === ${JSON.stringify(n1)})
    return tr ? [...tr.children].slice(3).map(td => td.textContent.trim()) : null
  })()`)
  const m1 = d0.members.find(m => m.name === n1)
  const m1Extras = Object.values(m1.extras).reduce((s, v) => s + (v || 0), 0)
  r.check(same(mergedCells) === same([...cellsOf(m1), fmt(round4(m1Extras + 3)), fmt(round4((m1.f || 0) + 3))]), '切到「活动合并」：活动合计把两列重名活动的分数都算进去了' +
    (same(mergedCells) === same([...cellsOf(m1), fmt(round4(m1Extras + 3)), fmt(round4((m1.f || 0) + 3))]) ? '' : `（实际：${mergedCells && mergedCells.join(' ')}）`))
  await app.click('活动分列')
  await settled()
  await app.shot('08-同名队员与重名活动列.png')

  // ---------- J ----------
  r.section('窗口缩到最小、常见笔记本分辨率、150% 缩放时的排版')
  // 用调试协议把"程序以为的窗口大小"改成指定尺寸（不动系统的缩放设置，测完恢复）。
  // 页面排版只认这个尺寸，所以量出来的结果和真的在那种屏幕上一样
  const setWindowSize = (w, h, scale) => app.conn.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: scale, mobile: false })
  const layout = () => app.run(`(() => {
    const main = document.querySelector('main')
    const scroller = main.querySelector('.overflow-y-auto')
    const header = main.querySelector('header')
    // 一段文字占了几个"行框"：1 表示没折行；标题或按钮文字被挤成两行会把顶栏撑高
    const lines = el => {
      if (!el) return 0
      const node = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent.trim())
      if (!node) return 0
      const range = document.createRange()
      range.selectNodeContents(node)
      return range.getClientRects().length
    }
    const refresh = [...header.querySelectorAll('button')].find(b => b.textContent.includes('刷新数据'))
    return {
      vw: window.innerWidth, vh: window.innerHeight,
      pageX: document.documentElement.scrollWidth - window.innerWidth,
      pageY: document.documentElement.scrollHeight - window.innerHeight,
      headerX: header.scrollWidth - header.clientWidth,
      mainX: scroller.scrollWidth - scroller.clientWidth,
      titleLines: lines(header.querySelector('h1')),
      refreshLines: lines(refresh),
      clipped: ${clippedInJs('main .overflow-y-auto')}
    }
  })()`)
  const SIZES = [
    ['最小窗口', 'min', 1024, 680, 1],
    ['1366×768 的笔记本', 'laptop', 1360, 685, 1],
    ['150% 缩放的笔记本', 'scale150', 1280, 680, 1.5]
  ]
  const PAGES = ['仪表盘与排名', '活动积分结算', '批量数据导入', '历史流水与撤销']
  for (const [label, slug, w, h, scale] of SIZES) {
    await setWindowSize(w, h, scale)
    await sleep(400)
    for (const [i, page] of PAGES.entries()) {
      await app.nav(page)
      await sleep(450)
      const m = await layout()
      // 窗口高度允许差 1~2 像素：模拟出来的视口有时会把这个数取整
      const ok = m.vw === w && Math.abs(m.vh - h) <= 2 && m.pageX <= 0 && m.pageY <= 0 && m.headerX <= 0 && m.mainX <= 0 && m.clipped.length === 0 && m.titleLines === 1 && m.refreshLines === 1
      r.check(ok, `${label}（${w}×${h}）：「${page}」没有被挤出屏幕，也没有被裁掉的内容，顶栏标题和按钮不折行` + (ok ? '' : `（实际窗口 ${m.vw}×${m.vh}；整页横向溢出 ${m.pageX}、纵向溢出 ${m.pageY}；顶栏溢出 ${m.headerX}；主区域横向溢出 ${m.mainX}；顶栏标题 ${m.titleLines} 行、刷新按钮 ${m.refreshLines} 行；被裁掉的元素：${m.clipped.join(' ') || '无'}）`))
      await app.shot(`08-排版-${slug}-${i + 1}.png`)
      if (page === '活动积分结算') {
        // 多加几张卡片把页面拉长，再滚到最底下看最后一行输入框
        // （切到别的页面时结算页会被卸载，回来是刚进来的样子，所以每次都在这里加）
        await app.run("(() => { const add = document.querySelectorAll('button[title=\\\"新增卡片\\\"]'); add[0].click(); add[0].click(); add[1].click(); return 'ok' })()")
        await settled()
        const covered = await app.run(`(() => {
          const scroller = document.querySelector('main .overflow-y-auto')
          scroller.scrollTop = scroller.scrollHeight
          const bar = document.querySelector('.fixed.bottom-0')
          const barTop = bar.getBoundingClientRect().top
          return [...scroller.querySelectorAll('textarea, input, button, select')]
            .filter(el => !bar.contains(el)) // 操作条自己的按钮不算
            .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > barTop + 1 && r.top < window.innerHeight })
            .map(el => el.tagName.toLowerCase() + '「' + (el.placeholder || el.textContent.trim() || '').slice(0, 12) + '」')
        })()`)
        r.check(covered.length === 0, `${label}：「活动积分结算」滚到最底下，最后一行输入框没有被底部的操作条挡住` + (covered.length ? `（被挡住：${covered.join('、')}）` : ''))
      }
    }
  }
  // 最小窗口下打开「结算预览」：底部的按钮要完整地留在屏幕里
  await setWindowSize(1024, 680, 1)
  await sleep(400)
  await toEventPage()
  // 彩排卡片填上教官 n1（参训留空），正式参加也填 n1
  await fillEvent(EV, n0, n1, n1)
  await app.click('生成预览')
  r.check(await previewShown(EV) && (await modalText()).includes('同名待核对'), '结算预览里，同名的队员旁边标着「同名待核对」')
  const buttons = await app.run(`(() => [...document.querySelectorAll(${JSON.stringify(MODAL + ' button')})].map(b => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight } }))()`)
  const confirmBtn = buttons.find(b => b.t === '确认写入 Excel')
  r.check(!!confirmBtn && confirmBtn.top >= 0 && confirmBtn.bottom <= confirmBtn.vh, '最小窗口下，预览窗口底部的按钮没有被挤出屏幕' + (confirmBtn ? `（按钮在 ${confirmBtn.top}~${confirmBtn.bottom} 像素处，窗口高 ${confirmBtn.vh}）` : ''))
  await app.shot('08-排版-min-结算预览.png')
  await app.conn.send('Emulation.clearDeviceMetricsOverride')
  await sleep(400)
  r.check((await layout()).vw > 1200, '恢复成真实的窗口大小')

  // ---------- I（续）----------
  r.section('同名队员：录入活动')
  await app.click('确认写入 Excel')
  r.check(await waitToast(`已追加活动列「${EV}」（主表第 ${evCol} 列）`), '写入成功')
  const both = (await read()).members.filter(m => m.name === n0)
  r.check(both.length === 2 && both[0].row === rowOf[n0] && both[0].extras[evCol] === 2 && both[1].row === dupRow && both[1].extras[evCol] === null,
    `分数只记在同名的两行里排在前面的那一行（第 ${rowOf[n0]} 行 +2），后面那一行（第 ${dupRow} 行）没动` +
    (both.length === 2 ? `（实际：第 ${both[0].row} 行 ${both[0].extras[evCol]}，第 ${both[1].row} 行 ${both[1].extras[evCol]}）` : `（只找到 ${both.length} 行）`))
  r.check(both.length === 2 && both.every(m => m.f === sumOf(m)), `两行的汇总分都等于各自各项之和（${both.map(m => m.f).join('、')}）`)
  r.check(backupFiles(env.excelPath).length === 1 && tmpLeftovers(env.dir).length === 0, '表格在中文路径下：写入前的备份照常生成，没有留下写了一半的临时文件' + `（备份 ${backupFiles(env.excelPath).length} 个，临时文件 ${tmpLeftovers(env.dir).join('、') || '无'}）`)

  r.section('活动名称和固定列重名 / 名单里的人全被忽略')
  await fillEvent('后勤', n2, n3, n3)
  await app.click('生成预览')
  r.check(await has('主表里已经有一列叫「后勤」，活动名称不能和它相同，请换一个') && !(await modalText()), '活动名起成「后勤」（和固定的一列同名）：生成预览时就拦下并说明原因')
  await fillEvent('全是生面孔的活动', '查无此人丙', '查无此人丁', '查无此人戊')
  await app.click('生成预览')
  await waitText('名单校验预警')
  await app.click('确认并继续')
  r.check(await previewShown('全是生面孔的活动') && (await modalText()).includes('共 0 人') && (await modalText()).includes('没有任何队员得分'), '名单里的人都选了「忽略」：预览里说明没有任何队员得分')
  r.check(((await app.buttonState('确认写入 Excel')) || {}).disabled === true, '这种情况下「确认写入 Excel」是灰的，点不了')
  await app.click('返回修改')
  await settled()

  r.section('活动列在 Excel 里被手工复制了一份（两列重名）之后，再用软件里的「修改」')
  await closeToWelcome()
  // 相当于有人在 Excel 里把刚建的活动列整列复制了一份：下一列表头相同，给 n0 记 5 分
  await editSheet(env.excelPath, ws => {
    ws.getRow(1).getCell(evCol + 1).value = EV
    ws.getRow(rowOf[n0]).getCell(evCol + 1).value = 5
    const f = ws.getRow(rowOf[n0]).getCell(6)
    f.value = round4((typeof f.value === 'number' ? f.value : 0) + 5)
  })
  r.check((await clickRecent('手工改过的项目')) === 'ok' && await waitWorkspace(), '关掉项目、在程序外面改完表格，再重新打开')
  const bannerNow = await bannerOf('活动列里有重名的列')
  r.check(!!bannerNow && bannerNow.includes(DUP) && bannerNow.includes(EV), '顶部提醒把两列重名的活动都列了出来' + (bannerNow ? '' : '（没有出现提醒）'))
  await app.nav('历史流水与撤销')
  await waitText('操作类型')
  r.check((await rowAction('新建大型活动', '修改')) === 'ok' && await waitText(`部分修改 · ${EV}`), `打开「${EV}」的修改窗口`)
  r.check((await modalText()).includes('同名待核对'), '修改窗口里，同名的队员旁边也标着「同名待核对」')
  r.check((await setScore(n0, 4)) === 'ok', `把 ${n0} 的分数从 2 改成 4`)
  await app.click('提交差值修改')
  r.check(await waitToast(`已修改「${EV}」：1 人的分数有变动`), '提交成功')
  const wsE = await openSheet(env.excelPath)
  r.check(wsE.getCell(rowOf[n0], evCol).value === 4 && wsE.getCell(rowOf[n0], evCol + 1).value === 5,
    '修改只落到排在前面的那一列，后面那列重名的没动（和顶部提醒里说的一致）' + `（实际：两列分别是 ${wsE.getCell(rowOf[n0], evCol).value}、${wsE.getCell(rowOf[n0], evCol + 1).value}）`)
  const n0Now = (await read()).members.find(m => m.name === n0)
  r.check(n0Now.f === sumOf(n0Now), `汇总分重新算过，等于各项之和（${n0Now.f}）`)

  r.section('活动列已经在 Excel 里被手工删掉，这时在软件里撤销它')
  await toEventPage()
  await fillEvent(GONE, n3, n2, n2)
  await commitEventAndExpect(GONE, `已追加活动列「${GONE}」`)
  await closeToWelcome()
  const colGone = (await read()).activityColumns.find(c => c.name === GONE).col
  await editSheet(env.excelPath, ws => { ws.spliceColumns(colGone, 1) })
  r.check((await clickRecent('手工改过的项目')) === 'ok' && await waitWorkspace(), '在程序外面把这一列整列删掉，再重新打开')
  const hashG = sha1(env.excelPath)
  const histG = readConfig(env).history.length
  await app.nav('历史流水与撤销')
  await waitText('操作类型')
  r.check((await rowAction('新建大型活动', '撤销')) === 'ok' && (await modalText()).includes('确认撤销该批次？'), '在历史里撤销这个活动')
  await app.click('确认撤销')
  await expectAlert(`未找到活动列「${GONE}」`, '这一列在表里已经没有了：如实说明，不乱动表格')
  const goneRow = await rowInfo('新建大型活动')
  r.check(sha1(env.excelPath) === hashG && !!goneRow && goneRow.label === GONE && goneRow.status === '活跃', '表格一个字节都没变；这一笔记录仍然是「活跃」，以后可以在表里补回这一列再撤')

  r.section('项目开着的时候，表格文件被删掉（或者在资源管理器里被移走、改名）')
  fs.unlinkSync(env.excelPath)
  const backupsG = backupFiles(env.excelPath).length
  await app.nav('仪表盘与排名')
  await app.click('刷新数据')
  await expectAlert('目标 Excel 文件不存在', '点「刷新数据」：说明表格文件不存在了')
  await toEventPage()
  await fillEvent('表格已经没了', n2, n3, n3)
  await app.click('生成预览')
  await app.click('确认写入 Excel')
  await expectAlert('目标 Excel 文件不存在', '这时候写入：被拦下')
  r.check(!fs.existsSync(env.excelPath) && backupFiles(env.excelPath).length === backupsG && readConfig(env).history.length === histG, '没有凭空生成一个新表格，没有多出备份和历史记录')
  await closeToWelcome()
  r.check(!fs.existsSync(env.lockFile) && ((await recentCardText('手工改过的项目')) || '').includes('失效'), '关闭项目：锁文件被清掉；「最近项目」里这个项目标成「失效」')
  await setWindowSize(1024, 680, 1)
  await sleep(400)
  const welcome = await app.run(`(() => {
    const scroller = document.querySelector('#root .overflow-y-auto')
    return { vw: window.innerWidth, pageX: document.documentElement.scrollWidth - window.innerWidth, mainX: scroller.scrollWidth - scroller.clientWidth, clipped: ${clippedInJs('#root .overflow-y-auto')} }
  })()`)
  const okW = welcome.vw === 1024 && welcome.pageX <= 0 && welcome.mainX <= 0 && welcome.clipped.length === 0
  r.check(okW, '最小窗口下，欢迎页（含「最近项目」卡片）没有被挤出屏幕，也没有被裁掉的内容' + (okW ? '' : `（整页横向溢出 ${welcome.pageX}；主区域横向溢出 ${welcome.mainX}；被裁掉的元素：${welcome.clipped.join(' ') || '无'}）`))
  await app.shot('08-排版-min-欢迎页.png')
  await app.conn.send('Emulation.clearDeviceMetricsOverride')
  r.check(app.rendererErrors.length === 0, `界面进程没有未捕获的异常（${app.rendererErrors.length} 条）`)
  await shutdown(env)
}

async function main () {
  r.log(`运行模式：${mode}`)
  await partFirstUse()
  await partTroubles()
  await partHandEdited()
  for (const a of apps) a.conn.close()
  const failed = r.problems.length > 0
  console.log(`\n[e2e] ${failed ? '存在失败项' : '全部通过'}：通过 ${r.passed} 项` +
    (r.skipped.length ? `，跳过 ${r.skipped.length} 项` : '') +
    (failed ? `，失败 ${r.problems.length} 项：\n  - ${r.problems.join('\n  - ')}` : ''))
  console.log('截图目录:', shotsDir)
  for (const env of envs) await shutdown(env)
  if (failed) { console.log('临时目录保留供排查：', envs.map(e => e.dir).join('；')); return 1 }
  for (const env of envs) {
    try { fs.rmSync(env.dir, { recursive: true, force: true }) } catch (e) { console.log('临时目录里有文件还被占用，没删掉，可以稍后手动删除：', env.dir, e.message) }
    // 临时目录是放在一个子目录里的话（中文路径那一轮），把这个已经空了的子目录也删掉
    if (env.baseDir && env.baseDir !== os.tmpdir()) { try { fs.rmdirSync(env.baseDir) } catch (_) { /* 里面还有东西就留着，不硬删 */ } }
  }
  console.log('临时目录已清理')
  return 0
}

main().catch(async e => {
  console.error('\n[e2e] 流程中断：', e && e.stack ? e.stack : e)
  for (const a of apps) a.conn.close()
  for (const env of envs) { try { await shutdown(env) } catch (_) {} }
  console.log('临时目录保留供排查：', envs.map(e => e.dir).join('；'))
  process.exit(1)
}).then(code => { process.exit(code) })
