// 统一封装主进程 IPC 调用；所有返回值为 { ok, data?, error?, code? }
async function invoke (channel, ...args) {
  if (!window.ghd) {
    return { ok: false, code: 'NO_BRIDGE', error: '当前环境未检测到 Electron 桥接（请在桌面端运行）' }
  }
  try {
    return await window.ghd.invoke(channel, ...args)
  } catch (e) {
    return { ok: false, code: 'IPC_FAIL', error: e.message }
  }
}

export const api = {
  openExcelDialog: () => invoke('dialog:openExcel'),
  openImportFileDialog: () => invoke('dialog:openImportFile'),
  saveProjectFileDialog: (name) => invoke('dialog:saveProjectFile', name),
  openProjectFileDialog: () => invoke('dialog:openProjectFile'),
  selectDirectoryDialog: () => invoke('dialog:selectDirectory'),
  listRecent: () => invoke('recent:list'),
  removeRecent: (p) => invoke('recent:remove', p),
  createProject: (args) => invoke('project:create', args),
  openProject: (p) => invoke('project:open', p),
  saveProject: (p, cfg) => invoke('project:save', p, cfg),
  closeProject: (excelPath) => invoke('project:close', excelPath),
  readExcel: (p) => invoke('excel:read', p),
  commitEvent: (p, payload) => invoke('excel:commitEvent', p, payload),
  applyIncrement: (p, payload) => invoke('excel:applyIncrement', p, payload),
  applyEventEdit: (p, payload) => invoke('excel:applyEventEdit', p, payload),
  deleteActivityColumn: (p, payload) => invoke('excel:deleteActivityColumn', p, payload),
  restoreBackup: (p, backupPath) => invoke('excel:restoreBackup', p, backupPath),
  readExternal: (p, mode) => invoke('excel:readExternal', p, mode)
}
