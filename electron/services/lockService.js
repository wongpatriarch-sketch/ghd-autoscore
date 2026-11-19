const fs = require('fs')
const path = require('path')

const heldLocks = new Set()

function lockPathOf (excelPath) {
  const dir = path.dirname(excelPath)
  const base = path.basename(excelPath)
  return path.join(dir, `.~${base}.lock`)
}

function isPidAlive (pid) {
  try { process.kill(pid, 0); return true } catch (_) { return false }
}

function readLock (excelPath) {
  const lp = lockPathOf(excelPath)
  try {
    return JSON.parse(fs.readFileSync(lp, 'utf-8'))
  } catch (_) { return null }
}

// 检测文件是否被第三方程序（如 Office）独占锁定
function isFileBusy (excelPath) {
  try {
    const fd = fs.openSync(excelPath, 'r+')
    fs.closeSync(fd)
    return false
  } catch (e) {
    return e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES'
  }
}

function check (excelPath) {
  if (!fs.existsSync(excelPath)) return { ok: false, reason: 'not-found' }
  const lock = readLock(excelPath)
  if (lock && lock.pid !== process.pid && isPidAlive(lock.pid)) {
    return { ok: false, reason: 'locked', lock }
  }
  if (isFileBusy(excelPath)) return { ok: false, reason: 'busy' }
  return { ok: true }
}

function acquire (excelPath, projectName, projectPath) {
  const status = check(excelPath)
  if (!status.ok) return status
  const lp = lockPathOf(excelPath)
  fs.writeFileSync(lp, JSON.stringify({
    pid: process.pid,
    projectName,
    projectPath,
    excelPath,
    since: new Date().toISOString()
  }, null, 2), 'utf-8')
  heldLocks.add(path.resolve(excelPath))
  return { ok: true }
}

function release (excelPath) {
  const resolved = path.resolve(excelPath)
  const lp = lockPathOf(excelPath)
  try {
    const lock = readLock(excelPath)
    if (lock && lock.pid === process.pid) fs.unlinkSync(lp)
    else if (!lock) { /* 已不存在 */ }
  } catch (_) {}
  heldLocks.delete(resolved)
}

function releaseAll () {
  for (const p of heldLocks) {
    try { release(p) } catch (_) {}
  }
  heldLocks.clear()
}

module.exports = { check, acquire, release, releaseAll, lockPathOf, isFileBusy }
