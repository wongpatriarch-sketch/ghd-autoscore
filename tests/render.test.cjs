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

const { pages, parseNames, React } = require(bundlePath)
const { renderToString } = require('react-dom/server')

const noop = () => {}
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
      batchId: 'B1', timestamp: new Date().toISOString(), type: 'event_create',
      objectKey: 'event::国庆出旗', label: '国庆出旗',
      details: { 张三: 3, 王五: 2 }, meta: { source: '活动积分结算引擎', memberCount: 2, headCoaches: ['赵六'], trainingCount: 1, rehearsalCount: 1, formalHours: 2 }
    },
    {
      batchId: 'B2', timestamp: new Date().toISOString(), type: 'flag',
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
t('Dashboard 全局排序模式渲染', () => {
  const html = renderToString(React.createElement(pages.Dashboard, ctx))
  assert(html.includes('按总积分全局排名'))
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
})
t('BatchImport 三引擎入口与互斥锁渲染', () => {
  const html = renderToString(React.createElement(pages.BatchImport, ctx))
  assert(html.includes('日常训练考勤'))
  assert(html.includes('后勤部（D 列）'))
})
t('HistoryCenter 版本栈状态渲染（活跃/锁定/已撤销）', () => {
  const html = renderToString(React.createElement(pages.HistoryCenter, ctx))
  assert(html.includes('国庆出旗'))
  assert(html.includes('已撤销'))
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

console.log(`\n${passed} 项渲染测试通过${process.exitCode ? '（存在失败项）' : ''}`)
try { fs.unlinkSync(bundlePath) } catch (_) {}
