const { contextBridge, ipcRenderer } = require('electron')

// 界面允许调用的通道白名单：不在名单里的通道一律拒绝
const ALLOWED = new Set([
  'dialog:openExcel',
  'dialog:saveProjectFile',
  'dialog:openProjectFile',
  'dialog:openImportFile',
  'dialog:selectDirectory',
  'recent:list',
  'recent:remove',
  'project:create',
  'project:open',
  'project:save',
  'project:close',
  'excel:read',
  'excel:commitEvent',
  'excel:applyIncrement',
  'excel:applyEventEdit',
  'excel:deleteActivityColumn',
  'excel:restoreBackup',
  'excel:readExternal'
])

contextBridge.exposeInMainWorld('ghd', {
  invoke (channel, ...args) {
    if (!ALLOWED.has(channel)) return Promise.reject(new Error(`blocked channel: ${channel}`))
    return ipcRenderer.invoke(channel, ...args)
  }
})
