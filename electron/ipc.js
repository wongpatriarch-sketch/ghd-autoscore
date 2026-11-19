const { ipcMain, dialog, BrowserWindow } = require('electron')
const fs = require('fs')
const excelService = require('./services/excelService')
const projectService = require('./services/projectService')
const lockService = require('./services/lockService')

function win () { return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] }

const XLSX_FILTER = [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
const JSON_FILTER = [{ name: '国护项目文件', extensions: ['json'] }]

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
    const r = await dialog.showSaveDialog(win(), {
      title: '保存项目工程配置文件',
      defaultPath: `${defaultName || '未命名项目'}.json`,
      filters: JSON_FILTER
    })
    return r.canceled ? { ok: true, data: null } : { ok: true, data: r.filePath }
  })

  ipcMain.handle('dialog:openProjectFile', async () => {
    const r = await dialog.showOpenDialog(win(), { title: '打开项目工程文件', filters: JSON_FILTER, properties: ['openFile'] })
    return r.canceled ? { ok: true, data: null } : { ok: true, data: r.filePaths[0] }
  })

  ipcMain.handle('dialog:selectDirectory', async () => {
    const r = await dialog.showOpenDialog(win(), { title: '选择模板保存目录', properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? { ok: true, data: null } : { ok: true, data: r.filePaths[0] }
  })

  // ---------- 最近项目 ----------
  ipcMain.handle('recent:list', () => projectService.listRecent())
  ipcMain.handle('recent:remove', (_e, configPath) => projectService.removeRecent(configPath))

  // ---------- 项目生命周期 ----------
  ipcMain.handle('project:create', async (_e, args) => {
    const { projectName, mode, excelPath, templatePath, configPath } = args
    try {
      if (!projectName || !String(projectName).trim()) return { ok: false, code: 'BAD_NAME', error: '项目名称不能为空' }
      if (!configPath) return { ok: false, code: 'BAD_CONFIG', error: '请选择项目配置文件保存位置' }
      if (fs.existsSync(configPath)) return { ok: false, code: 'CONFIG_EXISTS', error: '该位置已存在同名项目文件，请更换名称或位置' }

      let target = excelPath
      if (mode === 'template') {
        if (!templatePath) return { ok: false, code: 'BAD_PATH', error: '请指定新表格的保存路径' }
        if (fs.existsSync(templatePath)) return { ok: false, code: 'EXCEL_EXISTS', error: '该位置已存在同名 Excel 文件' }
        const t = await excelService.createTemplate(templatePath)
        if (!t.ok) return t
        target = templatePath
      } else {
        if (!target || !fs.existsSync(target)) return { ok: false, code: 'NOT_FOUND', error: '关联的 Excel 文件不存在' }
      }

      const lock = lockService.acquire(target, projectName, configPath)
      if (!lock.ok) {
        return { ok: false, code: lock.reason === 'busy' ? 'EBUSY' : 'LOCKED', error: '目标表格已被占用，请先释放占用或关闭对应文件' }
      }

      const created = projectService.createProject({ projectName: String(projectName).trim(), excelPath: target, configPath })
      if (!created.ok) return created
      projectService.pushRecent(created.data)
      return created
    } catch (e) {
      return { ok: false, code: e.code || 'CREATE_FAIL', error: `项目创建失败：${e.message}` }
    }
  })

  ipcMain.handle('project:open', async (_e, configPath) => {
    const opened = projectService.openProject(configPath)
    if (!opened.ok) return opened
    const cfg = opened.data
    const lock = lockService.acquire(cfg.excelPath, cfg.projectName, cfg.configPath)
    if (!lock.ok) {
      return {
        ok: false,
        code: lock.reason === 'busy' ? 'EBUSY' : 'LOCKED',
        error: lock.reason === 'busy'
          ? '目标表格已被占用，请先释放占用或关闭对应文件（检测到第三方 Office 软件独占锁定）'
          : `目标表格已被占用，请先释放占用或关闭对应文件（占用项目：${lock.lock && lock.lock.projectName ? lock.lock.projectName : '未知'}）`
      }
    }
    projectService.pushRecent(cfg)
    return { ok: true, data: cfg }
  })

  ipcMain.handle('project:save', (_e, configPath, cfg) => projectService.saveProject(configPath, cfg))

  ipcMain.handle('project:close', (_e, excelPath) => {
    lockService.release(excelPath)
    return { ok: true }
  })

  ipcMain.handle('lock:check', (_e, excelPath) => lockService.check(excelPath))

  // ---------- Excel 数据操作 ----------
  ipcMain.handle('excel:read', (_e, excelPath) => excelService.readWorkbook(excelPath))
  ipcMain.handle('excel:createTemplate', (_e, targetPath) => excelService.createTemplate(targetPath))
  ipcMain.handle('excel:commitEvent', (_e, excelPath, payload) => excelService.commitEvent(excelPath, payload))
  ipcMain.handle('excel:applyIncrement', (_e, excelPath, payload) => excelService.applyIncrement(excelPath, payload))
  ipcMain.handle('excel:applyEventEdit', (_e, excelPath, payload) => excelService.applyEventEdit(excelPath, payload))
  ipcMain.handle('excel:deleteActivityColumn', (_e, excelPath, payload) => excelService.deleteActivityColumn(excelPath, payload))
  ipcMain.handle('excel:readExternal', (_e, filePath, mode) => excelService.readExternal(filePath, mode))
}

module.exports = { registerIpc }
