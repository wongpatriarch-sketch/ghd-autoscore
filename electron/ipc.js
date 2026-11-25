const { ipcMain, dialog, BrowserWindow } = require('electron')
const fs = require('fs')
const excelService = require('./services/excelService')
const projectService = require('./services/projectService')
const lockService = require('./services/lockService')

function win () { return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] }

const XLSX_FILTER = [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
const JSON_FILTER = [{ name: '国护项目文件', extensions: ['json'] }]

// 打开项目时加不上锁的原因，换成使用者能看懂的话
function busyError (lock) {
  if (lock.reason === 'busy') {
    return {
      ok: false,
      code: 'EBUSY',
      error: '这张表格正被其他程序占用（多半是在 Excel / WPS 里开着），请先关闭该表格再试'
    }
  }
  if (lock.reason === 'readonly') {
    return {
      ok: false,
      code: 'EREADONLY',
      error: '这张表格是只读的（文件属性里勾选了"只读"，或者当前账号没有写入权限），请先取消只读，再重新打开项目'
    }
  }
  if (lock.reason === 'lockfail') return { ok: false, code: 'LOCK_FAIL', error: lock.error }
  if (lock.reason === 'not-found') return { ok: false, code: 'EXCEL_MISSING', error: `绑定的 Excel 文件不存在：${lock.excelPath || '（路径未知）'}` }
  const holder = lock.lock && lock.lock.projectName ? `（占用项目：${lock.lock.projectName}）` : ''
  return { ok: false, code: 'LOCKED', error: `这张表格已被其他项目占用${holder}，请先在那个项目里点“关闭项目并释放锁定”` }
}

function describeError (e) {
  if (e && e.code === 'ENOENT') return '找不到指定的文件夹或文件，请确认保存位置存在'
  return e && e.message ? e.message : String(e)
}

function registerIpc () {
  // ---------- 对话框 ----------
  ipcMain.handle('dialog:openExcel', async () => {
    const r = await dialog.showOpenDialog(win(), { title: '选择总积分表格', filters: XLSX_FILTER, properties: ['openFile'] })
    return r.canceled ? { ok: true, data: null } : { ok: true, data: r.filePaths[0] }
  })

  ipcMain.handle('dialog:openImportFile', async () => {
    const r = await dialog.showOpenDialog(win(), { title: '选择要导入的考勤/积分表格', filters: XLSX_FILTER, properties: ['openFile'] })
    return r.canceled ? { ok: true, data: null } : { ok: true, data: r.filePaths[0] }
  })

  ipcMain.handle('dialog:saveProjectFile', async (_e, defaultName) => {
    // 项目名称里可能带着 Windows 文件名不允许的字符（如 / : * ?），放进默认文件名前先替换掉，
    // 否则保存对话框一弹出就是非法文件名
    const safeName = String(defaultName || '').replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名项目'
    const r = await dialog.showSaveDialog(win(), {
      title: '保存项目工程配置文件',
      defaultPath: `${safeName}.json`,
      filters: JSON_FILTER
    })
    return r.canceled ? { ok: true, data: null } : { ok: true, data: r.filePath }
  })

  ipcMain.handle('dialog:openProjectFile', async () => {
    const r = await dialog.showOpenDialog(win(), { title: '打开项目工程文件', filters: JSON_FILTER, properties: ['openFile'] })
    return r.canceled ? { ok: true, data: null } : { ok: true, data: r.filePaths[0] }
  })

  ipcMain.handle('dialog:selectDirectory', async () => {
    const r = await dialog.showOpenDialog(win(), { title: '选择新表格的保存文件夹', properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? { ok: true, data: null } : { ok: true, data: r.filePaths[0] }
  })

  // ---------- 最近项目 ----------
  ipcMain.handle('recent:list', () => projectService.listRecent())
  ipcMain.handle('recent:remove', (_e, configPath) => projectService.removeRecent(configPath))

  // ---------- 项目生命周期 ----------
  ipcMain.handle('project:create', async (_e, args) => {
    const { projectName, mode, excelPath, templateDir, templateName, configPath } = args || {}
    let createdTemplate = null // 本次新建的表格
    let lockedExcel = null // 本次加的锁
    // 任何一步失败都收拾干净：删掉本次新建的表格和配置、释放本次加的锁，不留半成品
    const fail = result => {
      if (lockedExcel) lockService.release(lockedExcel)
      if (createdTemplate) { try { fs.unlinkSync(createdTemplate) } catch (_) {} }
      if (result.cleanupConfig) { try { fs.unlinkSync(configPath) } catch (_) {} }
      return result
    }
    try {
      if (!projectName || !String(projectName).trim()) return { ok: false, code: 'BAD_NAME', error: '项目名称不能为空' }
      if (!configPath) return { ok: false, code: 'BAD_CONFIG', error: '请选择项目配置文件保存位置' }
      if (fs.existsSync(configPath)) return { ok: false, code: 'CONFIG_EXISTS', error: '该位置已存在同名项目文件，请更换名称或位置' }

      let target = excelPath
      if (mode === 'template') {
        if (!templateDir || !templateName) return { ok: false, code: 'BAD_PATH', error: '请指定新表格的保存文件夹和文件名' }
        // 完整路径由主进程拼接，界面只传"文件夹 + 文件名"
        target = projectService.templateFilePath(templateDir, templateName)
        if (fs.existsSync(target)) return { ok: false, code: 'EXCEL_EXISTS', error: '该位置已存在同名 Excel 文件，请换一个文件名' }
        const made = await excelService.createTemplate(target)
        if (!made.ok) return made
        createdTemplate = target
      } else {
        if (!target || !fs.existsSync(target)) return { ok: false, code: 'NOT_FOUND', error: '关联的 Excel 文件不存在' }
      }
      // 统一成绝对路径、盘符大写：项目配置、锁、最近项目里记的都是同一种写法
      target = projectService.normalizePath(target)

      const lock = lockService.acquire(target, projectName, configPath)
      if (!lock.ok) return fail(busyError(lock))
      lockedExcel = target

      let created
      try {
        created = projectService.createProject({ projectName: String(projectName).trim(), excelPath: target, configPath })
      } catch (e) {
        // 配置文件可能只写了一半：进入这里之前已确认过它原本不存在，可以放心删掉
        return fail({ ok: false, code: 'CREATE_FAIL', error: `项目配置写入失败：${describeError(e)}`, cleanupConfig: true })
      }
      if (!created.ok) return fail(created)
      projectService.pushRecent(created.data)
      return created
    } catch (e) {
      return fail({ ok: false, code: e.code || 'CREATE_FAIL', error: `项目创建失败：${describeError(e)}` })
    }
  })

  ipcMain.handle('project:open', async (_e, configPath) => {
    // 主进程接口不能向外抛异常：任何一步出错都整理成带说明的结果交给界面
    try {
      const opened = projectService.openProject(configPath)
      if (!opened.ok) return opened
      const cfg = opened.data
      const lock = lockService.acquire(cfg.excelPath, cfg.projectName, cfg.configPath)
      if (!lock.ok) return busyError(lock)
      projectService.pushRecent(cfg)
      return { ok: true, data: cfg }
    } catch (e) {
      return { ok: false, code: e.code || 'OPEN_FAIL', error: `项目打开失败：${describeError(e)}` }
    }
  })

  ipcMain.handle('project:save', (_e, configPath, cfg) => projectService.saveProject(configPath, cfg))

  ipcMain.handle('project:close', (_e, excelPath) => {
    lockService.release(excelPath)
    return { ok: true }
  })

  // ---------- Excel 数据操作 ----------
  ipcMain.handle('excel:read', (_e, excelPath) => excelService.readWorkbook(excelPath))
  ipcMain.handle('excel:commitEvent', (_e, excelPath, payload) => excelService.commitEvent(excelPath, payload))
  ipcMain.handle('excel:applyIncrement', (_e, excelPath, payload) => excelService.applyIncrement(excelPath, payload))
  ipcMain.handle('excel:applyEventEdit', (_e, excelPath, payload) => excelService.applyEventEdit(excelPath, payload))
  ipcMain.handle('excel:deleteActivityColumn', (_e, excelPath, payload) => excelService.deleteActivityColumn(excelPath, payload))
  // 历史记录保存失败时，用写入前的备份把表格恢复原样
  ipcMain.handle('excel:restoreBackup', (_e, excelPath, backupPath) => excelService.restoreBackup(excelPath, backupPath))
  ipcMain.handle('excel:readExternal', (_e, filePath, mode) => excelService.readExternal(filePath, mode))
}

module.exports = { registerIpc }
