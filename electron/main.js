// 兼容处理：生产打包环境下 dunder-proto 查找 call-bind-apply-helpers 的嵌套寻址回退
const Module = require('module')
const path = require('path')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, isMain, options) {
  try {
    return origResolve.call(this, request, parent, isMain, options)
  } catch (err) {
    if (request === 'call-bind-apply-helpers' || request.startsWith('call-bind-apply-helpers/')) {
      const sub = request.slice('call-bind-apply-helpers'.length)
      const candidates = [
        path.join(__dirname, '..', 'node_modules', 'call-bind-apply-helpers' + (sub || '/index.js')),
        path.join(__dirname, '..', 'node_modules', 'call-bind', 'node_modules', 'call-bind-apply-helpers' + (sub || '/index.js')),
        ...(process.resourcesPath ? [
          path.join(process.resourcesPath, 'app.asar', 'node_modules', 'call-bind-apply-helpers' + (sub || '/index.js')),
          path.join(process.resourcesPath, 'app.asar', 'node_modules', 'call-bind', 'node_modules', 'call-bind-apply-helpers' + (sub || '/index.js'))
        ] : [])
      ]
      for (const cand of candidates) {
        try {
          return origResolve.call(this, cand, parent, isMain, options)
        } catch (_) {}
      }
    }
    throw err
  }
}

const { app, BrowserWindow } = require('electron')
const { registerIpc } = require('./ipc')

let mainWindow = null

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#121218',
    title: '国护积分管理',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 进程退出时释放所有由本进程持有的 Excel 锁
app.on('before-quit', () => {
  try { require('./services/lockService').releaseAll() } catch (_) {}
})
