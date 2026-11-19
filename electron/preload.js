const { contextBridge, ipcRenderer } = require('electron')

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
  'lock:check',
  'excel:read',
  'excel:createTemplate',
  'excel:commitEvent',
  'excel:applyIncrement',
  'excel:applyEventEdit',
  'excel:deleteActivityColumn',
  'excel:readExternal'
])

contextBridge.exposeInMainWorld('ghd', {
  invoke (channel, ...args) {
    if (!ALLOWED.has(channel)) return Promise.reject(new Error(`blocked channel: ${channel}`))
    return ipcRenderer.invoke(channel, ...args)
  }
})
