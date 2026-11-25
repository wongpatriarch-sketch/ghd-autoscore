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

// ---------- "正在写入"的计数 ----------
// 一次写入分两步落盘：① 主进程改 Excel；② 界面把这一笔历史记录存进项目配置。
// 两步之间如果关闭了项目，第 ② 步就不会做——结果是表格改了，历史里却没有这一笔，之后想撤销也对不上账。
// 所以这里记着"正在进行、不能被打断的落盘操作"有几件：改 Excel 的调用自己会计数，
// App 在做第 ② 步前后也手动计数。App 用它来拦住写入期间的"关闭项目"
let inflight = 0
const listeners = new Set()
const changed = () => { for (const fn of listeners) fn() }

export const isWriting = () => inflight > 0

// 供 React 的 useSyncExternalStore 订阅；返回取消订阅的函数
export function subscribeWriting (fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// 进入 / 离开一段不能被打断的落盘操作（成对调用）
export function beginWrite () {
  inflight++
  changed()
}

export function endWrite () {
  inflight = Math.max(0, inflight - 1)
  changed()
}

// 包住会修改 Excel 的调用：调用进行期间计入"正在写入"，成功、失败都照常计数
function writing (fn) {
  return async (...args) => {
    beginWrite()
    try {
      return await fn(...args)
    } finally {
      endWrite()
    }
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
  commitEvent: writing((p, payload) => invoke('excel:commitEvent', p, payload)),
  applyIncrement: writing((p, payload) => invoke('excel:applyIncrement', p, payload)),
  applyEventEdit: writing((p, payload) => invoke('excel:applyEventEdit', p, payload)),
  deleteActivityColumn: writing((p, payload) => invoke('excel:deleteActivityColumn', p, payload)),
  restoreBackup: (p, backupPath) => invoke('excel:restoreBackup', p, backupPath),
  readExternal: (p, mode) => invoke('excel:readExternal', p, mode)
}
