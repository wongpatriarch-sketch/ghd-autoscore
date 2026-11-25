const { app, BrowserWindow } = require('electron')
const path = require('path')
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
      // preload.js 只用到 electron 自带的 contextBridge / ipcRenderer，不需要 Node.js，
      // 所以开着沙箱：界面进程即使被页面内容攻破，也碰不到文件系统和系统命令
      sandbox: true
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

// 单实例：同一个软件只允许开一个窗口。
// 两个窗口同时操作同一张积分表会互相覆盖，而"谁最后保存谁生效"这种事应当从根上避免。
// 拿不到单实例锁（说明已经有一个在运行）时，本次启动直接退出，由先前的实例把窗口拉到前台。
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

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
}
