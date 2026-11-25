/*
 * 把 Electron 主进程（electron/main.js）与 preload.js 连同它们用到的全部 Node 依赖
 * （exceljs 及其一百多个间接依赖）打成单文件，输出到 dist-electron/。
 *
 * 为什么要这么做：
 *   electron-builder 打包 node_modules 时会按自己的规则重新整理依赖树，之前就因此
 *   漏掉了若干顶层包，导致安装后的程序一启动就报 "Cannot find module"。
 *   改成单文件后，安装包里只需要 dist/（界面）和 dist-electron/（主进程），
 *   不再携带 node_modules，从根上消除这类问题。
 *
 * 开发模式（npm run dev）与安装包共用同一份产物，保证"开发时跑的"和"装上去跑的"一致。
 *
 * 用法：node scripts/build-electron.cjs            打包一次
 *       node scripts/build-electron.cjs --watch    监听 electron/ 目录，改动后自动重新打包
 */
const path = require('path')
const esbuild = require('esbuild')

const root = path.join(__dirname, '..')
const watch = process.argv.includes('--watch')

async function main () {
  const ctx = await esbuild.context({
    entryPoints: [
      path.join(root, 'electron', 'main.js'),
      path.join(root, 'electron', 'preload.js')
    ],
    outdir: path.join(root, 'dist-electron'),
    outbase: path.join(root, 'electron'), // 保证产物是 dist-electron/main.js、dist-electron/preload.js
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20', // Electron 33 内置的是 Node 20
    external: ['electron'], // electron 模块由运行时提供，不能打进包里
    sourcemap: false,
    logLevel: 'info'
  })

  if (watch) {
    await ctx.watch()
    console.log('[build-electron] 正在监听 electron/ 目录，改动后自动重新打包')
  } else {
    await ctx.rebuild()
    await ctx.dispose()
  }
}

main().catch(err => {
  console.error('[build-electron] 打包失败：', err)
  process.exit(1)
})
