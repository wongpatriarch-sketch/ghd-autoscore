/*
 * 启动验证：程序"能装上"不等于"能打开"。这个脚本会真的把程序启动起来，
 * 通过 Chromium 调试端口读取窗口里实际渲染出的文字，确认：
 *   1. 主窗口确实创建出来了（主进程崩溃时 Electron 只会弹一个标题为 Error 的原生对话框）；
 *   2. 渲染层能用上 preload 暴露的 window.ghd 桥接；
 *   3. 首页（欢迎页）真的渲染出来了；
 *   4. 窗口标题设置过了（没有 <title> 时标题栏会显示成文件名 index.html）。
 * 若失败，会把 Error 对话框里的报错文字原样打印出来，方便定位。
 *
 * 用法：node scripts/verify-packaged.cjs        验证安装包目录 release/win-unpacked 里的 exe（需先 npm run dist）
 *       node scripts/verify-packaged.cjs dev    验证开发入口 electron .（需先 npm run build && npm run build:electron）
 *
 * 需要 Node 22+（用到内置的 WebSocket）。
 */
const { spawn, spawnSync } = require('child_process')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')

const root = path.join(__dirname, '..')
const pkg = require(path.join(root, 'package.json'))
const mode = process.argv[2] || 'packaged'
const PORT = 9333 + Math.floor(Math.random() * 500) // 随机端口，避免和已打开的实例冲突

function launchTarget () {
  if (mode === 'dev') {
    return {
      cmd: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
      args: ['.'],
      cwd: root
    }
  }
  const name = (pkg.build && pkg.build.productName) || pkg.productName
  const exe = path.join(root, 'release', 'win-unpacked', `${name}.exe`)
  if (!fs.existsSync(exe)) {
    console.error(`[verify] 找不到 ${exe}，请先执行 npm run dist`)
    process.exit(2)
  }
  return { cmd: exe, args: [], cwd: path.dirname(exe) }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function httpGet (url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => resolve(data))
    }).on('error', reject)
  })
}

/* 主进程启动失败时 Electron 会弹出标题为 "Error" 的原生对话框，用 Windows UIAutomation 读取其中的文字 */
function readErrorDialog () {
  const ps = [
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8;",
    "Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes;",
    "$root=[System.Windows.Automation.AutomationElement]::RootElement;",
    "$cond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'Error');",
    "$win=$root.FindFirst([System.Windows.Automation.TreeScope]::Children,$cond);",
    "if($win){ $all=$win.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition);",
    "  foreach($e in $all){ '[' + $e.Current.ControlType.ProgrammaticName + '] ' + $e.Current.Name } }"
  ].join(' ')
  try {
    return spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).stdout
  } catch (_) {
    return ''
  }
}

function killTree (child) {
  if (!child || child.exitCode !== null) return
  try {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
  } catch (_) {
    try { child.kill() } catch (_) {}
  }
}

async function evaluate (send, expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true })
  return r && r.result && r.result.result ? r.result.result.value : null
}

;(async () => {
  const target = launchTarget()
  console.log(`[verify] 启动: ${target.cmd} ${target.args.join(' ')}`)

  // 程序的"用户数据目录"指到临时目录：测试不往用户真实的资料目录里写任何东西，结束后整个目录删掉
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ghd-verify-'))

  const child = spawn(
    target.cmd,
    [...target.args, `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*', `--user-data-dir=${userData}`],
    { cwd: target.cwd, stdio: 'ignore' }
  )

  // 最多等 30 秒：窗口没创建出来就说明主进程没活到那一步
  let page = null
  for (let i = 0; i < 60; i++) {
    try {
      const list = JSON.parse(await httpGet(`http://127.0.0.1:${PORT}/json`))
      page = list.find(t => t.type === 'page') || list[0] || null
      if (page) break
    } catch (_) { /* 端口还没开，继续等 */ }
    if (child.exitCode !== null) break
    await sleep(500)
  }

  let ok = false
  if (page) {
    console.log(`[verify] 窗口已创建: 标题="${page.title}" 地址=${page.url}`)
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })

    let nextId = 0
    const pending = new Map()
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    }
    const send = (method, params) => new Promise(resolve => {
      const id = ++nextId
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })

    // 首页要等 React 挂载，最多再等 10 秒
    // css / logo：样式表和图片是不是真的加载了（内容安全策略配错时，这两样会被浏览器悄悄拦掉，页面不会报错但会变成一片白）
    // title：窗口标题。页面没写 <title> 时，窗口标题会退化成文件名 "index.html"
    const expression = [
      '({',
      '  bridge: !!window.ghd,',
      '  title: document.title,',
      "  text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 300),",
      "  css: getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)',",
      "  logo: !!(document.querySelector('header img') && document.querySelector('header img').naturalWidth > 0),",
      "  csp: (document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]') || {}).content || ''",
      '})'
    ].join('')
    let state = null
    for (let i = 0; i < 20; i++) {
      await sleep(500)
      state = await evaluate(send, expression)
      if (state && state.text && state.text.includes('欢迎回来')) break
    }
    await sleep(600) // 图片比文字晚一点加载完，等一下再读最终状态
    state = await evaluate(send, expression)
    console.log('[verify] 页面内容:', JSON.stringify(state))
    console.log('[verify] 内容安全策略:', state && state.csp ? state.csp : '(未设置)')
    if (state && state.text && state.text.includes('欢迎回来') && !(state.css && state.logo)) {
      console.error('[verify] 页面文字已渲染，但样式表或图片没有加载（多半是内容安全策略拦掉了）')
    }
    if (state && state.text && state.text.includes('欢迎回来') && (!state.title || state.title === 'index.html')) {
      console.error('[verify] 窗口标题没有设置（页面缺少 <title>），标题栏会显示成文件名')
    }
    ok = !!(state && state.bridge && state.text && state.text.includes('欢迎回来') && state.css && state.logo && state.title && state.title !== 'index.html')
    ws.close()
  } else {
    console.error('[verify] 失败：30 秒内没有出现窗口（主进程没有活到创建窗口那一步）')
    const dialog = readErrorDialog()
    console.error('[verify] Error 对话框内容:\n' + (dialog || '(未找到 Error 对话框)'))
  }

  killTree(child)
  await sleep(800)
  try { fs.rmSync(userData, { recursive: true, force: true }) } catch (_) { /* 个别缓存文件可能还被占用，留给系统清理临时目录 */ }
  console.log(ok ? '[verify] 通过：窗口已创建，首页已渲染，window.ghd 桥接可用' : '[verify] 失败')
  process.exit(ok ? 0 : 1)
})().catch(err => {
  console.error('[verify] 异常：', err)
  process.exit(1)
})
