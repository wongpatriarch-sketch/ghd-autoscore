/* 页面渲染冒烟测试：node tests/render.test.cjs */
const assert = require('assert')
const path = require('path')
const fs = require('fs')
const esbuild = require('esbuild')

const bundlePath = path.join(__dirname, '.render-bundle.cjs')

esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'render-entry.jsx')],
  bundle: true,
  outfile: bundlePath,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  loader: { '.svg': 'dataurl', '.css': 'empty', '.png': 'dataurl' },
  logLevel: 'silent'
})

const { pages, parseNames, summaryNote, validateEventForm, computeEventScores, countCards, React } = require(bundlePath)
const { renderToString } = require('react-dom/server')

const noop = () => {}
// 从一段渲染结果里取出"包含指定文字的那个按钮"的起始标签（用来核对它是不是 disabled）
const buttonTagWith = (html, text) => {
  const i = html.indexOf(text)
  assert(i >= 0, `渲染结果里没有「${text}」`)
  const start = html.lastIndexOf('<button', i)
  return html.slice(start, html.indexOf('>', start) + 1)
}
// 分段切换按钮组在界面上是一个 <div class="card p-1.5 …">，里面只有几个按钮：取出含指定文字的那一组
const segmentedWith = (html, label) => {
  const i = html.indexOf(label)
  assert(i >= 0, `渲染结果里没有「${label}」`)
  const start = html.lastIndexOf('<div class="card p-1.5', i)
  return html.slice(start, html.indexOf('</div>', start))
}
// 历史页的一条记录在界面上是一行；表头行的类名不同，按数据行的起始类名切开正好只留下数据行（新在上）
const historyRows = html => html.split('<tr class="border-b border-white/[0.04]').slice(1).map(r => r.slice(0, r.indexOf('</tr>')))
// 相邻的两段文字在服务端渲染的结果里隔着一段 <!-- --> 注释；核对整句提示时先把它去掉
const plain = html => html.split('<!-- -->').join('')
// 数据形状与主进程 readWorkbook 的返回保持一致：前 6 列是固定列，第 7 列是空白分隔列，活动从第 8 列开始。
// 队员的活动分按"列号"存（m.extras 的键是列号），有哪些活动列记在 activityColumns 里
const members = [
  { row: 3, name: '张三', generation: 31, b: 1, c: 2, d: null, e: null, f: 6, extras: { 8: 3, 9: 2, 10: 1 } },
  { row: 4, name: '李四', generation: 31, b: null, c: null, d: null, e: null, f: -2, extras: {} },
  { row: 6, name: '王五', generation: 30, b: 2, c: 1, d: 1, e: 1, f: 5, extras: { 8: 1 } }
]
const activityColumns = [{ name: '国庆出旗', col: 8 }, { name: '元旦出旗', col: 9 }, { name: '九三阅兵\n出旗', col: 10 }]
const excel = {
  filePath: 'C:\\x.xlsx',
  headers: ['姓名', '夜训周训', '升降旗', '后勤', '综办', '汇总', '', '国庆出旗', '元旦出旗', '九三阅兵\n出旗'],
  members,
  activityColumns,
  duplicateNames: ['张三'],
  duplicateColumns: [],
  lastCol: 10,
  totalRows: 8
}
const cfg = {
  projectName: '2026秋季集训',
  excelPath: 'C:\\x.xlsx',
  configPath: 'C:\\x.json',
  settings: { dailyTrainingScore: 1 },
  locks: { is_logistics_imported: true, is_comprehensive_imported: false },
  history: [
    {
      batchId: 'B0', timestamp: '2026-10-01T08:00:00.000Z', type: 'event_edit',
      objectKey: 'event::国庆出旗', label: '国庆出旗',
      details: { 张三: 1 }, meta: { source: '修改自批次 Bx', memberCount: 1 }
    },
    {
      batchId: 'B1', timestamp: '2026-10-02T08:00:00.000Z', type: 'event_create',
      objectKey: 'event::国庆出旗', label: '国庆出旗',
      details: { 张三: 3, 王五: 2 }, meta: { source: '活动积分结算引擎', memberCount: 2, headCoaches: ['赵六'], trainingCount: 1, rehearsalCount: 1, formalHours: 2 }
    },
    {
      batchId: 'B2', timestamp: '2026-10-03T08:00:00.000Z', type: 'flag',
      objectKey: 'flag::B2', label: '升降旗考勤导入（日常升降旗）',
      details: { 张三: 1.5 }, meta: { source: '批量数据导入引擎', fileName: 'a.xlsx', rate: 0.5, targetCol: 3, memberCount: 1 },
      status: 'undone'
    }
  ]
}
const ctx = { cfg, excel, onClose: noop, reloadExcel: noop, recordAfterWrite: noop, notifyWritten: noop, showAlert: noop }

let passed = 0
const t = (name, fn) => {
  try { fn(); passed++; console.log(`  ✓ ${name}`) } catch (e) {
    console.error(`  ✗ ${name}\n    ${e.message.split('\n').slice(0, 4).join('\n    ')}`)
    process.exitCode = 1
  }
}

t('ProjectHub 渲染', () => {
  const html = renderToString(React.createElement(pages.ProjectHub, { onOpened: noop, showAlert: noop, loading: false }))
  assert(html.includes('欢迎回来'))
})
t('Workspace + Dashboard 渲染（含负分高亮/届别分组）', () => {
  const html = renderToString(React.createElement(pages.Workspace, ctx))
  assert(html.includes('2026秋季集训'))
  assert(html.includes('31 届'))
})
t('Dashboard 默认按届数分组排名：有届别分组标题，名次是"组内名次 + 全局名次"', () => {
  const html = renderToString(React.createElement(pages.Dashboard, ctx))
  assert(html.includes('—— 31 届 ——') && html.includes('—— 30 届 ——'), '应有届别分组标题')
  assert(html.includes('/ 全局第'), '分组模式下应同时显示全局名次')
  const modeSwitch = segmentedWith(html, '按届数分组排名')
  assert.strictEqual((modeSwitch.match(/bg-accent\/20/g) || []).length, 1, '排名方式的两个按钮里应恰好有一个处于选中状态')
  assert(/bg-accent\/20[^>]*>按届数分组排名<\/button>/.test(modeSwitch), '默认选中的是"按届数分组排名"')
})
t('Dashboard 全局排序模式：没有届别分组，名次就是全局名次', () => {
  const html = renderToString(React.createElement(pages.Dashboard, { ...ctx, initialMode: 'global' }))
  assert(!html.includes('届 ——'), '全局模式下不应有届别分组标题')
  assert(!html.includes('/ 全局第'), '全局模式下名次就是全局名次，不再另标')
  assert(/bg-accent\/20[^>]*>按总积分全局排名<\/button>/.test(segmentedWith(html, '按总积分全局排名')), '选中的应是"按总积分全局排名"')
  // 全局按汇总分从高到低：张三 6、王五 5、李四 -2
  const order = ['张三', '王五', '李四'].map(n => html.indexOf(`>${n}</span>`))
  assert(order[0] < order[1] && order[1] < order[2], `全局模式下的顺序不对：${order}`)
  // 未知 / 拼错的参数一律退回默认的分组模式
  const fallback = renderToString(React.createElement(pages.Dashboard, { ...ctx, initialMode: 'global ' }))
  assert(fallback.includes('—— 31 届 ——'), 'initialMode 不是 global 时应按届数分组')
})
t('Dashboard 活动列分列 / 合并切换与固定列渲染', () => {
  const html = renderToString(React.createElement(pages.Dashboard, ctx))
  assert(html.includes('活动分列') && html.includes('活动合并'), '缺少活动列视图切换按钮')
  // 默认是分列视图：每个活动各占一列；表头里为了排版加的换行在界面上照原样换行（<br/>）
  assert(html.includes('国庆出旗') && html.includes('元旦出旗') && html.includes('九三阅兵<br/>出旗'), '分列视图没有逐个显示活动列')
  assert(!html.includes('活动合计'), '默认分列视图下不应出现合并视图的"活动合计"列')
  // 名次列吸左、汇总列吸右
  assert(html.includes('left-0') && html.includes('sticky right-0'), '固定列的定位类名缺失')
  // 第 7 列是空白分隔列，界面上一列都不应该出现空表头
  assert(!/<th[^>]*><\/th>/.test(html), '出现了空表头')
  // 明细列表头照抄主表
  assert(html.includes('>夜训周训</th>') && html.includes('>升降旗</th>'), '明细列表头应与主表一致')
})
t('两列活动重名：榜单各列显示各自的分数并给出提醒', () => {
  const dup = {
    ...excel,
    headers: ['姓名', '周训', '升降旗', '后勤部', '综办部', '汇总', '', '出旗', '出旗'],
    activityColumns: [{ name: '出旗', col: 8 }, { name: '出旗', col: 9 }],
    duplicateColumns: ['出旗'],
    members: [{ row: 3, name: '张三', generation: 31, b: 0, c: null, d: null, e: null, f: 4, extras: { 8: 3, 9: 1 } }]
  }
  const html = renderToString(React.createElement(pages.Workspace, { ...ctx, excel: dup }))
  assert(html.includes('活动列里有重名的列'), '重名活动列没有给出提醒')
  assert(html.includes('>周训</th>') && html.includes('>后勤部</th>'), '主表把 B 列写成"周训"、D 列写成"后勤部"时，界面应原样显示')
  // 从姓名那一格开始截到行尾（不能只搜 ">张三<"：顶部"同名队员"提醒里的 <b>张三</b> 也会被搜到）
  const start = html.indexOf('>张三</span>')
  const row = html.slice(start, html.indexOf('</tr>', start))
  assert.strictEqual((row.match(/>3<\/td>/g) || []).length, 1, '第一列出旗应显示 3')
  assert.strictEqual((row.match(/>1<\/td>/g) || []).length, 1, '第二列出旗应显示 1（按活动名存的话会被覆盖成同一个值）')
  assert.strictEqual((row.match(/>4<\/td>/g) || []).length, 1, '汇总应显示 4')
})
t('EventScoring 动态表单渲染', () => {
  const html = renderToString(React.createElement(pages.EventScoring, ctx))
  assert(html.includes('全局表头信息'))
  assert(html.includes('正式出旗环节'))
  // 训练 / 彩排卡片：教官必填、参训可以留空。label 里的"参训"和括号是两段文字，中间隔着 React 的占位注释，所以只搜后半截
  assert(html.includes('教官 *（必填）') && html.includes('（可以留空）'), '训练 / 彩排卡片应标明"教官必填、参训可以留空"')
})
t('BatchImport 三引擎入口与互斥锁渲染', () => {
  const html = renderToString(React.createElement(pages.BatchImport, ctx))
  assert(html.includes('日常训练考勤'))
  assert(html.includes('后勤部（D 列）'))
})
t('HistoryCenter 版本栈状态渲染：同一活动的较早记录锁定、最新记录活跃、撤销过的标成已撤销', () => {
  const html = renderToString(React.createElement(pages.HistoryCenter, ctx))
  assert(html.includes('国庆出旗'))
  // 页面顶部的说明文字里也有"活跃""锁定"四个字，所以要认徽标本身（文字紧跟着 </svg> 或者被 <span> 包住）
  assert(html.includes('>活跃</span>'), '栈顶记录应有"活跃"徽标')
  assert(/<\/svg>锁定/.test(html), '栈顶下面的记录应有"锁定"徽标')
  assert(html.includes('>已撤销</span>'), '撤销过的记录应有"已撤销"徽标')
  assert(html.includes('仅栈顶（最新）记录可撤销'), '锁定记录的撤销按钮应带说明')
  // 列表新在上：B2（已撤销）、B1（活跃）、B0（锁定）
  const rows = historyRows(html)
  assert.strictEqual(rows.length, 3, `应有 3 行记录，实际 ${rows.length}`)
  const [undone, active, locked] = rows
  // 栈顶记录：徽标是"活跃"，"修改""撤销"两个按钮都能点
  assert(active.includes('>活跃</span>') && active.includes('>修改</button>'), '栈顶记录应有"活跃"徽标和"修改"按钮')
  assert(!/\sdisabled=""/.test(buttonTagWith(active, '撤销')), '栈顶记录的撤销按钮应可点')
  // 栈顶下面的记录：徽标是"锁定"，没有"修改"按钮，撤销按钮是灰的并说明原因
  assert(locked.includes('</svg>锁定'), '栈顶下面的记录应有"锁定"徽标')
  assert(!locked.includes('>修改</button>'), '锁定记录不应有"修改"按钮')
  const lockedBtn = buttonTagWith(locked, '撤销')
  assert(/\sdisabled=""/.test(lockedBtn) && lockedBtn.includes('仅栈顶（最新）记录可撤销'), `锁定记录的撤销按钮应变灰并带说明：${lockedBtn}`)
  // 已撤销的记录：整行变淡，不能再撤销
  assert(undone.startsWith(' hover:bg-white/[0.03] transition opacity-50"'), '已撤销的记录整行应变淡')
  assert(undone.includes('>已撤销</span>') && !undone.includes('>修改</button>'), '已撤销的记录应有"已撤销"徽标')
  // 「已撤销」徽标里也有"撤销"两个字，所以从按钮文字前面的尖括号开始找
  assert(/\sdisabled=""/.test(buttonTagWith(undone, '>撤销</button>')), '已撤销的记录不能再撤销')
  // 只有一处"活跃"徽标、一处"锁定"徽标
  assert.strictEqual(html.split('>活跃</span>').length - 1, 1)
  assert.strictEqual(html.split('</svg>锁定').length - 1, 1)
})

// ---------- 名单分词（活动结算页各个名单框共用） ----------
const names = s => JSON.stringify(parseNames(s))
t('parseNames：逗号、顿号、分号、空格、换行、制表符都能当分隔符，自动去重去空', () => {
  assert.strictEqual(names('张三，李四、王五;赵六；钱七 孙八\r\n周九\t吴十'), JSON.stringify(['张三', '李四', '王五', '赵六', '钱七', '孙八', '周九', '吴十']))
  assert.strictEqual(names('张三, 张三,李四 张三'), JSON.stringify(['张三', '李四']), '重复的名字只留第一个')
  assert.strictEqual(names(''), '[]')
  assert.strictEqual(names('   \n\t '), '[]')
  assert.strictEqual(names(null), '[]')
})
t('parseNames：两字名中间的排版空格（「张 三」）合并成一个名字', () => {
  assert.strictEqual(names('张 三'), JSON.stringify(['张三']), '单独一个「张 三」')
  assert.strictEqual(names('张　三'), JSON.stringify(['张三']), '全角空格')
  assert.strictEqual(names('张 三、李 四\n王 五，赵 六'), JSON.stringify(['张三', '李四', '王五', '赵六']), '用顿号、换行、逗号隔开的「张 三」们各自合并')
  assert.strictEqual(names('张 三\t李 四\n王五'), JSON.stringify(['张三', '李四', '王五']), '从 Excel 复制过来的一块：同一行用制表符隔开、行与行用换行隔开')
  assert.strictEqual(names('欧 阳 锋'), JSON.stringify(['欧阳锋']), '三字名每个字之间都加了空格')
})
t('parseNames：只靠空格隔开的多个带空格名字没法确定断法，按单字拆开，交给用户逐个指定', () => {
  assert.strictEqual(names('张 三 李 四'), JSON.stringify(['张', '三', '李', '四']))
  assert.strictEqual(names('张 三 李四'), JSON.stringify(['张', '三', '李四']), '「李四」和前面的单字之间没有明确的分隔符，不合并')
  assert.strictEqual(names('张\t三'), JSON.stringify(['张', '三']), '制表符两侧是两格内容，不算同一个名字')
  assert.strictEqual(names('艾克拜尔·司马义'), JSON.stringify(['艾克拜尔·司马义']), '带间隔号的姓名原样保留')
  assert.strictEqual(names('张三 李四'), JSON.stringify(['张三', '李四']), '普通的空格分隔不受影响')
})

t('Workspace：主表里有合计 / 备注这类不是队员的行时，顶部给出提示', () => {
  assert(!plain(renderToString(React.createElement(pages.Workspace, ctx))).includes('行不是队员'), '没有这类行时不显示提示')
  const two = plain(renderToString(React.createElement(pages.Workspace, { ...ctx, excel: { ...excel, labelRows: [{ row: 9, name: '合计' }, { row: 14, name: '备注：10 月起按新标准' }] } })))
  assert(two.includes('主表里有 2 行不是队员，程序已跳过（不显示、不读取、也不改动）'), '提示里应说明跳过了几行、是怎么处理的')
  assert(two.includes('<b>第 9 行「合计」、第 14 行「备注：10 月起按新标准」</b>'), '提示里应列出是哪几行')
  // 超过 5 行时只列前 5 行，后面用"等"带过
  const many = Array.from({ length: 7 }, (_, i) => ({ row: i + 2, name: `合计${i + 1}` }))
  const seven = plain(renderToString(React.createElement(pages.Workspace, { ...ctx, excel: { ...excel, labelRows: many } })))
  assert(seven.includes('主表里有 7 行不是队员') && seven.includes('第 6 行「合计5」</b> 等。'), '超过 5 行时应只列前 5 行')
  assert(!seven.includes('合计6') && !seven.includes('合计7'), '第 6、7 行的名称不应出现在提示里')
})
t('Workspace：写入进行中时"关闭项目"按钮变灰', () => {
  const html = renderToString(React.createElement(pages.Workspace, { ...ctx, writing: true }))
  const tag = buttonTagWith(html, '写入中，请稍候…')
  assert(/\sdisabled=""/.test(tag), `写入期间按钮应是 disabled：${tag}`)
  assert(html.includes('等右上角出现写入结果提示后即可关闭'), '悬停提示应说明什么时候可以关闭')
  assert(!html.includes('关闭项目并释放锁定'), '写入期间不应再显示平时的按钮文字')
  const idle = renderToString(React.createElement(pages.Workspace, ctx))
  // 按钮的类名里带着 disabled:opacity-50 这类样式，所以不能直接搜 "disabled"，要看有没有 disabled="" 这个属性
  assert(!/\sdisabled=""/.test(buttonTagWith(idle, '关闭项目并释放锁定')), '不在写入时按钮应可点')
  assert(!idle.includes('写入中，请稍候…'))
})

// ---------- 活动结算表单的校验与计分（src/lib/eventForm.js） ----------
const card = (coaches = '', participants = '', hours = 1) => ({ id: Math.random(), hours, coaches, participants })
const rosterSet = new Set(['张三', '李四', '王五', '赵六'])
const dupSet = new Set(['张三'])
// 一张"没填教官也没填参训"的多余卡片：校验提示的后半句
const blank = '的教官和参训都是空的，不需要的话请点 － 删掉这张卡片'
// 主表测试数据的活动列是「国庆出旗」「元旦出旗」「九三阅兵出旗」，这里的活动名特意都不重名
const baseForm = () => ({
  activityName: '五四出旗',
  headCoaches: '赵六',
  trainings: [card('赵六', '', 2)],
  rehearsals: [card('王五', '张 三', 1.5)],
  formal: { hours: 2.5, participants: '李四', stageCrew: '王五' }
})
t('validateEventForm：教官必填、参训可以留空（对外带训）', () => {
  assert.strictEqual(validateEventForm({ ...baseForm(), excel }), '', '基准表单应通过')
  assert.strictEqual(validateEventForm({ ...baseForm(), trainings: [card('赵六'), card('李四', '王五')] }), '', '训练卡片：只有教官 / 教官参训都有，都合格')
  assert.strictEqual(validateEventForm({ ...baseForm(), rehearsals: [card('王五')] }), '', '彩排卡片：只有教官也合格')
  assert.strictEqual(validateEventForm({ ...baseForm(), trainings: [card(' 赵六 ', '   ')] }), '', '名字两头的空白不算内容')
  assert.strictEqual(validateEventForm({ ...baseForm(), trainings: [] }), '', '没有训练时把卡片全部删掉是允许的')
  // 只填了参训、没填教官：不合格，提示里说明教官不能为空、参训可以留空
  assert.strictEqual(validateEventForm({ ...baseForm(), trainings: [card('', '张三')] }), '第 1 次训练填了参训队员，却没有填教官。教官不能为空，参训可以留空')
  assert.strictEqual(validateEventForm({ ...baseForm(), rehearsals: [card('', '张三')] }), '第 1 次彩排填了参训队员，却没有填教官。教官不能为空，参训可以留空')
})
t('validateEventForm：空卡片的处理——训练卡片不能空；彩排仅剩的一张留空表示"没有彩排"', () => {
  assert.strictEqual(validateEventForm({ ...baseForm(), rehearsals: [card()] }), '', '删不掉的那张彩排卡片留空 = 没有彩排')
  assert.strictEqual(validateEventForm({ ...baseForm(), rehearsals: [card(' ', null, 1)] }), '', '没填过的卡片（内容是 null）同样算留空')
  assert.strictEqual(validateEventForm({ ...baseForm(), rehearsals: [{ id: 1, hours: 1, coaches: undefined, participants: undefined }] }), '', '新建卡片的输入框内容是 undefined')
  assert.strictEqual(validateEventForm({ ...baseForm(), trainings: [card('赵六', '', 2), card()] }), `第 2 次训练${blank}`)
  assert.strictEqual(validateEventForm({ ...baseForm(), rehearsals: [card('王五'), card()] }), `第 2 次彩排${blank}`, '有两张彩排卡片时，空的那张要删掉')
  assert.strictEqual(validateEventForm({ ...baseForm(), rehearsals: [card(), card('王五')] }), `第 1 次彩排${blank}`, '提示里的序号是卡片在表单里的位置')
  assert.strictEqual(validateEventForm({ ...baseForm(), rehearsals: [card(' ', ' ', 1), card('王五')] }), `第 1 次彩排${blank}`)
})
t('validateEventForm：活动名称、主教官人数、正式名单、和主表里的列重名', () => {
  assert.strictEqual(validateEventForm({ ...baseForm(), excel }), '', '和主表里哪一列都不同名，通过')
  assert.strictEqual(validateEventForm({ ...baseForm(), activityName: '  ' }), '请填写活动名称（它会成为主表里新加那一列的表头）')
  assert.strictEqual(validateEventForm({ ...baseForm(), headCoaches: '' }), '主教官需填写 1~5 位人名，不能为空')
  assert.strictEqual(validateEventForm({ ...baseForm(), headCoaches: '赵六,李四,王五,张三,钱七,孙八' }), '主教官需填写 1~5 位人名，不能为空')
  assert.strictEqual(validateEventForm({ ...baseForm(), headCoaches: '赵六,李四,王五,张三,钱七' }), '', '5 位主教官是上限')
  assert.strictEqual(validateEventForm({ ...baseForm(), headCoaches: '赵六,赵六 李四' }), '', '重复的名字只算一位')
  assert.strictEqual(validateEventForm({ ...baseForm(), formal: { hours: 1, participants: ' \n ', stageCrew: '' } }), '正式活动「参加」名单不能为空')
  assert.strictEqual(validateEventForm({ ...baseForm(), formal: { hours: 1, participants: '李四', stageCrew: '' } }), '', '场务可以留空')
  assert.strictEqual(validateEventForm({ ...baseForm(), activityName: '国庆出旗', excel }), '主表中已存在同名活动列「国庆出旗」，请更换活动名称')
  assert.strictEqual(validateEventForm({ ...baseForm(), activityName: ' 元旦出旗 ', excel }), '主表中已存在同名活动列「元旦出旗」，请更换活动名称', '名称两头的空白不算')
  assert.strictEqual(validateEventForm({ ...baseForm(), activityName: ' 汇总 ', excel }), '主表里已经有一列叫「汇总」，活动名称不能和它相同，请换一个', '不能和固定列（姓名、汇总……）重名')
  assert.strictEqual(validateEventForm({ ...baseForm(), activityName: '姓名', excel }), '主表里已经有一列叫「姓名」，活动名称不能和它相同，请换一个')
  assert.strictEqual(validateEventForm({ ...baseForm(), activityName: '出旗' }), '', '不是完全相同的名字不算重名')
  assert.strictEqual(validateEventForm({ ...baseForm(), activityName: '五四出旗' }), '', '不传 excel 时不查重名（界面总是传）')
  // 校验按表单从上到下的顺序，报第一条不合格的原因
  assert.strictEqual(validateEventForm({ ...baseForm(), activityName: '', headCoaches: '' }), '请填写活动名称（它会成为主表里新加那一列的表头）')
  assert.strictEqual(validateEventForm({ ...baseForm(), headCoaches: '', trainings: [card()] }), '主教官需填写 1~5 位人名，不能为空')
  assert.strictEqual(validateEventForm({ ...baseForm(), trainings: [card()], formal: { hours: 1, participants: '', stageCrew: '' } }), `第 1 次训练${blank}`)
})
t('computeEventScores：只有教官、没有参训的卡片照样给教官记分', () => {
  const form = { ...baseForm(), trainings: [card('赵六', '', 2), card()] } // 第二张是空卡片，不计分
  const { rows, scores } = computeEventScores({ ...form, rosterSet, dupSet })
  // 赵六：主教官 2 + 带训 2；李四：正式 2.5；王五：彩排 1.5 + 场务 0.5；张三：彩排 1.5
  assert.deepStrictEqual(scores, { 赵六: 4, 李四: 2.5, 王五: 2, 张三: 1.5 })
  assert.deepStrictEqual(rows.map(r => r.name), ['赵六', '李四', '王五', '张三'], '预览按合计从高到低排')
  const zs = rows.find(r => r.name === '张三')
  assert.deepStrictEqual([zs.head, zs.training, zs.rehearsal, zs.formal, zs.stage, zs.total, zs.duplicate], [0, 0, 1.5, 0, 0, 1.5, true], '「张 三」合并成一个名字；同名队员带标记')
  const ww = rows.find(r => r.name === '王五')
  assert.deepStrictEqual([ww.rehearsal, ww.stage, ww.total, ww.duplicate], [1.5, 0.5, 2, false])
  assert.deepStrictEqual(rows.find(r => r.name === '赵六'), { name: '赵六', head: 2, training: 2, rehearsal: 0, formal: 0, stage: 0, total: 4, duplicate: false })
  assert.strictEqual(countCards(form.trainings), 1, '空卡片不算一张')
  assert.strictEqual(countCards(form.rehearsals), 1)
  assert.strictEqual(countCards([]), 0)
})
t('computeEventScores：多张卡片累加；名单里不在名册的名字按"忽略 / 修正"处理', () => {
  const form = {
    ...baseForm(),
    headCoaches: '赵六,钱七',
    trainings: [card('赵六', '李四', 1), card('李四', '赵六', 2.5), card('王五')],
    rehearsals: [card()],
    formal: { hours: 3, participants: '钱七', stageCrew: '外人' }
  }
  // 未处理的名字一律忽略（和界面上选"忽略该人员"一样），不会悄悄记到别人头上
  // 赵六：主教官 2 + 带训 1 + 参训 2.5；李四：参训 1 + 带训 2.5；王五：带训 1
  const ignored = computeEventScores({ ...form, rosterSet, dupSet })
  assert.deepStrictEqual(ignored.scores, { 赵六: 5.5, 李四: 3.5, 王五: 1 })
  assert.deepStrictEqual(ignored.rows.find(r => r.name === '赵六'), { name: '赵六', head: 2, training: 3.5, rehearsal: 0, formal: 0, stage: 0, total: 5.5, duplicate: false })
  // 「钱七」修正为张三（主教官 2 + 正式 3）；「外人」忽略
  const fixed = computeEventScores({ ...form, rosterSet, dupSet }, { 钱七: '张三', 外人: null })
  assert.deepStrictEqual(fixed.scores, { 赵六: 5.5, 张三: 5, 李四: 3.5, 王五: 1 })
  assert.deepStrictEqual(fixed.rows.map(r => r.name), ['赵六', '张三', '李四', '王五'], '按合计从高到低排')
  assert.deepStrictEqual(fixed.rows.find(r => r.name === '张三'), { name: '张三', head: 2, training: 0, rehearsal: 0, formal: 3, stage: 0, total: 5, duplicate: true })
  // 名单整个是空的：没有人得分
  const empty = computeEventScores({ activityName: 'x', headCoaches: '', trainings: [], rehearsals: [card()], formal: { hours: 1, participants: '', stageCrew: '' }, rosterSet, dupSet })
  assert.deepStrictEqual(empty, { rows: [], scores: {} })
  // 所有人都被忽略：同样是 0 人
  const allIgnored = computeEventScores({ ...baseForm(), rosterSet: new Set(), dupSet }, { 赵六: null, 李四: null, 王五: null, 张三: null })
  assert.deepStrictEqual(allIgnored, { rows: [], scores: {} })
})

t('summaryNote：汇总被纠正 / 公式没有保存结果 / 没有改动的公式行，分别说明', () => {
  assert.strictEqual(summaryNote(undefined), '')
  assert.strictEqual(summaryNote({}), '')
  assert.strictEqual(summaryNote({ summaryFixed: [], uncalculatedFormulas: 0, untouchedRows: [] }), '')
  const fixedText = '有 4 行的原汇总与明细对不上，已按明细重算：张三（空 → 3）、李四（9 → 1）、王五（4 → 2） 等'
  const untouchedText = '有 1 行的明细里没有任何分数、汇总格里却是算出了数值的公式（多半是合计行），程序没有改动：第 30 行「全体」'
  assert.strictEqual(summaryNote({
    summaryFixed: [{ name: '张三', from: null, to: 3 }, { name: '李四', from: 9, to: 1 }, { name: '王五', from: 4, to: 2 }, { name: '赵六', from: 1, to: 1 }]
  }), fixedText)
  assert.strictEqual(summaryNote({ untouchedRows: [{ name: '全体', row: 30, summary: 12 }] }), untouchedText)
  // 几种情况同时出现时按"公式没有保存结果 → 汇总被纠正 → 没有改动的公式行"的顺序用分号连起来
  const note = summaryNote({
    uncalculatedFormulas: 2,
    summaryFixed: [{ name: '张三', from: null, to: 3 }, { name: '李四', from: 9, to: 1 }, { name: '王五', from: 4, to: 2 }, { name: '赵六', from: 1, to: 1 }],
    untouchedRows: [{ name: '全体', row: 30, summary: 12 }]
  })
  assert(note.startsWith('主表有 2 个公式单元格没有保存计算结果，本次按 0 计入汇总；用 Excel 或 WPS 打开主表保存一次后，再做任意一次写入就会自动纠正；'), note)
  assert(note.endsWith(`${fixedText}；${untouchedText}`), note)
  // 超过 3 行只列前 3 行
  const many = summaryNote({ untouchedRows: [{ name: '甲', row: 2 }, { name: '乙', row: 3 }, { name: '丙', row: 4 }, { name: '丁', row: 5 }] })
  assert.strictEqual(many, '有 4 行的明细里没有任何分数、汇总格里却是算出了数值的公式（多半是合计行），程序没有改动：第 2 行「甲」、第 3 行「乙」、第 4 行「丙」 等')
})

console.log(`\n${passed} 项渲染测试通过${process.exitCode ? '（存在失败项）' : ''}`)
try { fs.unlinkSync(bundlePath) } catch (_) {}
