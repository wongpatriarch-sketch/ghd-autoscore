/*
 * 端到端测试的公共工具，被 scripts/e2e-smoke.cjs（主流程）和 scripts/e2e-scenarios.cjs（异常恢复、新建项目、批量导入）共用。
 *
 * 做的事情：
 *   - prepare：在系统临时目录里准备一份样本积分表的副本和一个现成的测试项目，不碰任何真实积分表；
 *   - launchApp：把程序启动起来（可以带"开发模式 / 打包后的程序"两种），连上它的调试口，
 *       再提供"读页面文字、点按钮、填输入框、截图"这些模拟真人操作的方法；
 *   - compareWorkbooks：把两份表格逐格对比，用来确认"只有该改的格子被改了"。
 *
 * 原理：
 *   程序启动时带上了 --remote-debugging-port（界面进程的调试口）和 --inspect（主进程的调试口）。
 *   界面进程用 Chrome 调试协议连接：读页面文字、给输入框填值、点按钮、截图；
 *   主进程的调试口只用来做一件事——把"系统的文件选择 / 保存对话框"换成假的（见 stubDialogs），
 *   因为系统对话框没法用调试协议操作。除此之外程序走的全是和平时一样的代码。
 */
const { spawn, spawnSync } = require('child_process')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const ExcelJS = require('exceljs')
const JSZip = require('jszip')

const root = path.resolve(__dirname, '..')
const pkg = require(path.join(root, 'package.json'))
const svc = require(path.join(root, 'electron', 'services', 'excelService.js'))

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const shotsDir = path.join(os.tmpdir(), 'ghd-e2e-shots')

const httpGet = url => new Promise((resolve, reject) => {
  http.get(url, res => { let d = ''; res.on('data', c => { d += c }); res.on('end', () => resolve(d)) }).on('error', reject)
})

// ---------- 汇报结果 ----------
class Reporter {
  constructor () { this.passed = 0; this.problems = []; this.skipped = []; this.step = 0 }

  section (name) { this.step++; console.log(`\n[${this.step}] ${name}`) }

  check (ok, label) {
    console.log(`  ${ok ? '✓' : '✗'} ${label}`)
    if (ok) this.passed++
    else this.problems.push(label)
    return !!ok
  }

  skip (label) { this.skipped.push(label); console.log(`  － 跳过：${label}`) }

  log (msg) { console.log(`  ${msg}`) }

  // 全部跑完后的总结。ok 为真时才删除临时目录，失败时留着供排查
  summary (dir) {
    console.log(`\n[e2e] ${this.problems.length ? '存在失败项' : '全部通过'}：通过 ${this.passed} 项` +
      (this.skipped.length ? `，跳过 ${this.skipped.length} 项` : '') +
      (this.problems.length ? `，失败 ${this.problems.length} 项：\n  - ` + this.problems.join('\n  - ') : ''))
    console.log('截图目录:', shotsDir)
    if (this.problems.length) console.log('临时目录保留供排查：', dir)
    else {
      try { fs.rmSync(dir, { recursive: true, force: true }); console.log('临时目录已清理') } catch (_) { console.log('临时目录里有文件还被占用，没删掉，可以稍后手动删除：', dir) }
    }
    return this.problems.length ? 1 : 0
  }
}

// ---------- 准备临时数据 ----------
function defaultSample () {
  return path.resolve(root, '..', '考勤模板-2026秋季学期校学生国旗护卫队积分表.xlsx')
}

// mode：dev = 用 node_modules 里的 Electron 跑当前工程；packaged = 跑打包出来的 release/win-unpacked 里的程序
function resolveTarget (mode) {
  if (mode === 'dev') {
    const cmd = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
    return { cmd, args: ['.'], cwd: root }
  }
  if (mode === 'packaged') {
    const cmd = path.join(root, 'release', 'win-unpacked', `${pkg.productName}.exe`)
    return { cmd, args: [], cwd: path.dirname(cmd) }
  }
  console.error(`未知的运行模式「${mode}」，只能是 dev 或 packaged`)
  process.exit(2)
}

const lockFileOf = excelPath => path.join(path.dirname(excelPath), `.~${path.basename(excelPath)}.lock`)

// subdir 不为空时，临时目录不直接放在系统临时目录下，而是放进这个子目录里（用来测"表格放在带中文、空格的文件夹里"的情况）
function prepare ({ mode = 'dev', sample, withRecent = true, projectName = '冒烟测试项目', subdir = '' } = {}) {
  const target = resolveTarget(mode)
  const samplePath = path.resolve(sample || defaultSample())
  // 程序还没启动就发现没法继续测：直接报错退出，不留下任何临时文件
  if (!fs.existsSync(samplePath)) { console.error('找不到样本主表：', samplePath); process.exit(2) }
  if (!fs.existsSync(target.cmd)) { console.error('找不到可执行文件（先构建再测）：', target.cmd); process.exit(2) }

  const baseDir = subdir ? path.join(os.tmpdir(), subdir) : os.tmpdir()
  if (subdir) fs.mkdirSync(baseDir, { recursive: true })
  const dir = fs.mkdtempSync(path.join(baseDir, 'ghd-e2e-'))
  const excelPath = path.join(dir, '总积分表-副本.xlsx')
  const configPath = path.join(dir, `${projectName}.json`)
  fs.copyFileSync(samplePath, excelPath)
  const now = new Date().toISOString()
  const cfg = {
    version: 1, projectName, createdAt: now, updatedAt: now, configPath, excelPath,
    settings: { dailyTrainingScore: 1.0 },
    locks: { is_logistics_imported: false, is_comprehensive_imported: false },
    history: []
  }
  const env = {
    mode, target, dir, baseDir, excelPath, configPath, cfg, samplePath,
    userData: path.join(dir, 'userData'),
    lockFile: lockFileOf(excelPath),
    apps: []
  }
  fs.mkdirSync(env.userData, { recursive: true })
  if (withRecent) {
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8')
    writeRecent(env, [recentEntry(cfg)])
  }

  // 万一程序不认 --user-data-dir 开关，它会去写默认目录里的 recent.json：先备份，结束后原样放回
  const defaultRecent = path.join(process.env.APPDATA, pkg.productName, 'recent.json')
  env.defaultRecent = defaultRecent
  env.defaultRecentBackup = fs.existsSync(defaultRecent) ? fs.readFileSync(defaultRecent) : null
  return env
}

const recentEntry = cfg => ({ projectName: cfg.projectName, configPath: cfg.configPath, excelPath: cfg.excelPath, lastOpened: new Date().toISOString(), valid: true })

// 往临时"用户数据目录"里写"最近项目"列表
function writeRecent (env, list) {
  fs.writeFileSync(path.join(env.userData, 'recent.json'), JSON.stringify(list, null, 2), 'utf-8')
}

function readConfig (env) {
  return JSON.parse(fs.readFileSync(env.configPath, 'utf-8'))
}

// 还原默认目录里的"最近项目"列表。
// 原来没有这个文件、程序却新建了一个：只有里面记的是本次测试的临时项目才删掉，别的项目不动
function restoreDefaultRecent (env) {
  const file = env.defaultRecent
  try {
    if (env.defaultRecentBackup) fs.writeFileSync(file, env.defaultRecentBackup)
    else if (fs.existsSync(file) && fs.readFileSync(file, 'utf-8').includes(path.basename(env.dir))) fs.unlinkSync(file)
  } catch (e) { console.error('还原最近项目列表失败：', e.message) }
}

// 收尾：关掉测试期间启动的所有程序进程（等它们真的退出，否则临时目录里的文件还被占用、删不掉），还原"最近项目"列表
async function shutdown (env) {
  const apps = env.apps.slice()
  for (const app of apps) { try { app.kill() } catch (_) {} }
  for (const app of apps) { try { await app.waitExit() } catch (_) {} }
  restoreDefaultRecent(env)
}

// ---------- 启动程序并连上调试口 ----------
function killTree (child) {
  if (!child || child.exitCode !== null) return
  try { spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' }) } catch (_) { try { child.kill() } catch (_) {} }
}

// 连上一个调试口（界面进程或主进程），返回 { send, onEvent, close }
async function connectWs (url) {
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error(`调试连接失败：${url}`)) })
  let nextId = 0
  const pending = new Map()
  const listeners = []
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { timer, resolve } = pending.get(m.id)
      clearTimeout(timer)
      pending.delete(m.id)
      resolve(m)
    } else if (m.method) {
      listeners.forEach(fn => fn(m))
    }
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`调试命令超时：${method}`)) }, 20000)
    pending.set(id, { timer, resolve })
    ws.send(JSON.stringify({ id, method, params }))
  })
  return { send, onEvent: fn => listeners.push(fn), close: () => { try { ws.close() } catch (_) {} } }
}

// 轮询调试口的 /json，直到出现指定类型的调试目标（界面进程是 page，主进程是 node）
async function waitForTarget (port, type, child, attempts = 80) {
  for (let i = 0; i < attempts; i++) {
    if (child && child.exitCode !== null) break
    try {
      const list = JSON.parse(await httpGet(`http://127.0.0.1:${port}/json`))
      const found = list.find(t => t.type === type) || null
      if (found) return found
    } catch (_) { /* 调试口还没开 */ }
    await sleep(500)
  }
  return null
}

// 让主进程里的"文件选择 / 保存对话框"变成可以由测试指定结果的假对话框。
// 之后只要改 globalThis.__e2eDialogs.open / .save 的值，下一次弹框就会"选中"那个路径；值是 null 时相当于用户点了取消。
const DIALOG_STUB = `(() => {
  const d = require('electron').dialog
  globalThis.__e2eDialogs = { open: null, save: null }
  d.showOpenDialog = async () => globalThis.__e2eDialogs.open ? { canceled: false, filePaths: [globalThis.__e2eDialogs.open] } : { canceled: true, filePaths: [] }
  d.showSaveDialog = async () => globalThis.__e2eDialogs.save ? { canceled: false, filePath: globalThis.__e2eDialogs.save } : { canceled: true, filePath: undefined }
  return 'ok'
})()`

async function launchApp (env, { tag = '' } = {}) {
  const cdpPort = 9800 + Math.floor(Math.random() * 150) // 随机端口，避免和已经打开的实例冲突
  const inspectPort = 9350 + Math.floor(Math.random() * 150)
  const child = spawn(env.target.cmd, [
    ...env.target.args,
    `--remote-debugging-port=${cdpPort}`, '--remote-allow-origins=*', `--inspect=${inspectPort}`, `--user-data-dir=${env.userData}`,
    // 窗口被别的窗口挡住时也继续出画面，否则截图会一直等（自动化测试工具 Playwright 也是这么做的）
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'
  ], { cwd: env.target.cwd, stdio: 'ignore' })

  const page = await waitForTarget(cdpPort, 'page', child)
  if (!page) { killTree(child); throw new Error('窗口没有创建出来（主进程没有活到创建窗口那一步）') }
  const conn = await connectWs(page.webSocketDebuggerUrl)
  await conn.send('Runtime.enable')
  await conn.send('Page.bringToFront').catch(() => {})

  // 界面进程里的异常和 console.error 都记下来，最后统一检查
  const rendererErrors = []
  conn.onEvent(m => {
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails
      rendererErrors.push((d.exception && d.exception.description) || d.text)
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      rendererErrors.push(m.params.args.map(a => a.value || a.description || '').join(' '))
    }
  })

  const run = async (expression) => {
    const r = await conn.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.result && r.result.exceptionDetails) console.error('  脚本异常:', (r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) || r.result.exceptionDetails.text)
    return r.result && r.result.result ? r.result.result.value : undefined
  }
  const waitFor = async (expression, label, timeout = 15000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if (await run(expression)) return true
      await sleep(300)
    }
    console.error(`  等待超时：${label}`)
    return false
  }
  const text = () => run('document.body.innerText')
  // 按文字找按钮并点击。返回 ok / no button / disabled
  const click = (label, { exact = true } = {}) => run(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => ${exact ? `x.textContent.trim() === ${JSON.stringify(label)}` : `x.textContent.includes(${JSON.stringify(label)})`})
    if (!b) return 'no button'
    if (b.disabled) return 'disabled'
    b.click()
    return 'ok'
  })()`)
  // 某个按钮当前的状态：找不到时返回 null
  const buttonState = label => run(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(label)})
    return b ? { disabled: b.disabled } : null
  })()`)
  const nav = label => run(`(() => { const b = [...document.querySelectorAll('aside nav button')].find(x => x.textContent.includes(${JSON.stringify(label)})); if (!b) return 'no button'; b.click(); return 'ok' })()`)
  // React 管理的输入框不能直接改 el.value（界面不会知道），要用原生 setter 改值再派发 input 事件
  const setValue = (selector, index, value) => run(`(() => {
    const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]
    if (!el) return 'no element'
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return 'ok'
  })()`)
  // 下拉框：改值后派发 change 事件（React 的 select 监听的是 change）
  const selectOption = (selector, index, value) => run(`(() => {
    const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]
    if (!el) return 'no element'
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, ${JSON.stringify(value)})
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return 'ok'
  })()`)
  const closeAlert = () => click('我知道了')
  // 最上面一层弹窗里的全部文字（预览、确认框、各种提示框都算）；没有弹窗时返回 null
  const lastModalText = () => run(`(() => {
    const all = document.querySelectorAll('.fixed.inset-0.z-50')
    return all.length ? all[all.length - 1].innerText : null
  })()`)
  // 阻断式提示框（带"我知道了"按钮的那种）里的全部文字；没有提示框时返回 null。
  // 它是整个界面里最后一个弹层，所以从后往前找，找到第一个带"我知道了"按钮的弹层就是它
  const alertText = () => run(`(() => {
    const m = [...document.querySelectorAll('.fixed.inset-0.z-50')].reverse().find(x => [...x.querySelectorAll('button')].some(b => b.textContent.trim() === '我知道了'))
    return m ? m.innerText : null
  })()`)

  let shotOk = true
  const shot = async (name) => {
    if (!shotOk) return
    try {
      await sleep(500)
      const r = await conn.send('Page.captureScreenshot', { format: 'png' })
      fs.mkdirSync(shotsDir, { recursive: true })
      fs.writeFileSync(path.join(shotsDir, `${env.mode}-${tag}${name}`), Buffer.from(r.result.data, 'base64'))
      console.log('  截图:', `${env.mode}-${tag}${name}`)
    } catch (e) {
      shotOk = false // 窗口在后台时不出帧，截图会一直等；跳过截图，后面的检查只靠读取页面文字
      console.log('  截图不可用（窗口在后台）：', e.message)
    }
  }

  // 在主进程里执行一段代码（用来设置假对话框要返回的路径）；没连上主进程时返回 false
  let mainEval = null
  const app = {
    child, conn, rendererErrors, run, waitFor, text, click, clickContaining: label => click(label, { exact: false }), buttonState, nav, setValue, selectOption, closeAlert, alertText, lastModalText, shot,
    dialogsReady: false,
    pid: child.pid,
    // 指定下一次"文件选择框 / 保存框"返回的路径；传 null 表示让对话框表现成"用户点了取消"
    setDialogs: async ({ open = null, save = null } = {}) => {
      if (!mainEval) return false
      await mainEval(`(() => { globalThis.__e2eDialogs = { open: ${JSON.stringify(open)}, save: ${JSON.stringify(save)} }; return 'ok' })()`)
      return true
    },
    kill: () => killTree(child),
    waitExit: async (timeout = 10000) => {
      const t0 = Date.now()
      while (child.exitCode === null && Date.now() - t0 < timeout) await sleep(200)
      return child.exitCode
    },
    // 像用户点右上角的 × 一样关掉窗口：Page.close 会先跑页面里的 beforeunload，再关窗口。返回进程退出码
    closeWindow: async () => {
      conn.send('Page.close').catch(() => {})
      const code = await app.waitExit()
      if (code === null) { conn.send('Runtime.evaluate', { expression: 'window.close()' }).catch(() => {}); return app.waitExit() }
      return code
    }
  }
  env.apps.push(app)

  // 连主进程的调试口，把系统对话框换成假的。连不上也不影响后面的测试，只是用到对话框的步骤会被跳过
  let mainConn = null
  const mainTarget = await waitForTarget(inspectPort, 'node', child, 20)
  if (mainTarget) {
    try {
      mainConn = await connectWs(mainTarget.webSocketDebuggerUrl)
      const main = mainConn
      mainEval = async (expression) => {
        const r = await main.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, includeCommandLineAPI: true })
        if (r.error) throw new Error(r.error.message)
        const res = r.result || {}
        if (res.exceptionDetails) throw new Error((res.exceptionDetails.exception && res.exceptionDetails.exception.description) || res.exceptionDetails.text)
        return res.result ? res.result.value : undefined
      }
      await mainEval(DIALOG_STUB)
      app.dialogsReady = true
    } catch (e) {
      mainConn.close()
      mainConn = null
      mainEval = null
      console.log('  （主进程调试口连不上，涉及系统对话框的步骤将跳过：' + e.message + '）')
    }
  }
  // 断开和主进程调试口的连接。之后不能再设置假对话框（setDialogs 会返回 false）。
  // 要测"关掉窗口后程序会不会自己退出"之前必须先调用它：
  // Node 规定"有调试器连着的时候，进程退出前要等调试器断开"，不断开的话程序会一直等着，看起来像没退出
  app.detachDebugger = () => {
    if (mainConn) { try { mainConn.close() } catch (_) {} }
    mainConn = null
    mainEval = null
  }
  return app
}

// ---------- 读表、逐格对比 ----------
const colNumber = letters => [...letters].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0)

// 文件里真实存在的格子地址（按原始 XML 里 <c r="…">），格式 "行,列"。
// 不用 ExcelJS 读出来的行列数，是因为读表时会顺手创建一些空格子，按它们算会把没内容的格子也算进来
async function cellAddresses (file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file))
  const xml = await zip.file('xl/worksheets/sheet1.xml').async('string')
  const body = xml.slice(xml.indexOf('<sheetData>'), xml.indexOf('</sheetData>'))
  const set = new Set()
  for (const m of body.matchAll(/<c r="([A-Z]+)(\d+)"/g)) set.add(`${m[2]},${colNumber(m[1])}`)
  return set
}

async function firstSheet (file) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  return wb.worksheets[0]
}

// 把内容整理成"不区分属性顺序"的文字再比较。同一种样式，WPS 和本程序写出来的属性顺序不一样
// （比如字体是先写字号还是先写字体名），直接转成文字会把没变的样式误判成"变了"
function stable (value) {
  if (value === undefined || value === null) return 'null'
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const valueOf = cell => stable(cell.value)
// 外观 = 字体、对齐、边框、底色、数字格式
const styleOf = cell => {
  const s = cell.style || {}
  return stable([s.font, s.alignment, s.border, s.fill, s.numFmt])
}

// 逐格比较 A、B 两个文件的第一个工作表，返回内容变化的、样式变化的、新增的、消失的格子地址
async function compareWorkbooks (fileA, fileB) {
  const addrA = await cellAddresses(fileA)
  const addrB = await cellAddresses(fileB)
  const wsA = await firstSheet(fileA)
  const wsB = await firstSheet(fileB)
  const valueChanged = []; const styleChanged = []
  for (const key of addrA) {
    const [r, c] = key.split(',').map(Number)
    const a = wsA.getRow(r).getCell(c); const b = wsB.getRow(r).getCell(c)
    if (valueOf(a) !== valueOf(b) || a.type !== b.type) valueChanged.push(key)
    if (styleOf(a) !== styleOf(b)) styleChanged.push(key)
  }
  return {
    sizeA: addrA.size,
    sizeB: addrB.size,
    valueChanged,
    styleChanged,
    // 新增 / 消失的格子只算"有内容"的。撤销修改后某些格子会被清空，文件里会留下一个只有地址的空标记，那不算多出或少了数据
    added: [...addrB].filter(k => !addrA.has(k) && valueOf(wsB.getRow(+k.split(',')[0]).getCell(+k.split(',')[1])) !== 'null'),
    removed: [...addrA].filter(k => !addrB.has(k) && valueOf(wsA.getRow(+k.split(',')[0]).getCell(+k.split(',')[1])) !== 'null')
  }
}

// 某张表旁边的全部备份，按创建时间从早到晚排列。
// 第 0 个就是"第一次写入之前"的表格。不能按文件名排序：同一秒内的第二份备份文件名里带序号，按名字排会排到第一份前面
function backupFiles (excelPath) {
  const dir = path.join(path.dirname(excelPath), '.backups')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(f => f.endsWith('.xlsx'))
    .map(name => {
      const file = path.join(dir, name)
      return { name, file, created: fs.statSync(file).birthtimeMs }
    })
    .sort((a, b) => a.created - b.created)
}

module.exports = {
  root, pkg, svc, sleep, shotsDir, Reporter, prepare, writeRecent, readConfig, shutdown, launchApp,
  lockFileOf, killTree, compareWorkbooks, backupFiles, defaultSample
}
