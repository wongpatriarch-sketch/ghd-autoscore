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

const { pages, React } = require(bundlePath)
const { renderToString } = require('react-dom/server')

const noop = () => {}
const excel = {
  filePath: 'C:\\x.xlsx',
  headers: ['姓名', '夜训周训', '升降旗', '后勤部', '综办部', '汇总', '国庆出旗'],
  members: [
    { row: 3, name: '张三', generation: 31, b: 1, c: 2, d: null, e: null, f: 3, extras: { 国庆出旗: 3 } },
    { row: 4, name: '李四', generation: 31, b: null, c: null, d: null, e: null, f: -2, extras: {} },
    { row: 6, name: '王五', generation: 30, b: 2, c: 1, d: 1, e: 1, f: 5, extras: {} }
  ],
  activityColumns: [{ name: '国庆出旗', col: 7 }],
  duplicateNames: ['张三'],
  lastCol: 7,
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
const ctx = { cfg, excel, onClose: noop, reloadExcel: noop, updateConfig: noop, showAlert: noop }

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

console.log(`\n${passed} 项渲染测试通过${process.exitCode ? '（存在失败项）' : ''}`)
try { fs.unlinkSync(bundlePath) } catch (_) {}
