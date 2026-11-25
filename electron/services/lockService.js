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

// 文件属性里的"只读"有没有勾上。Windows 上 fs.stat 给出的权限位里只有这一位是真实的：只读时写权限位被清掉
function isReadOnlyAttribute (excelPath) {
  try { return !(fs.statSync(excelPath).mode & 0o200) } catch (_) { return false }
}

// 探测表格现在能不能写：试着以"读写"方式打开一下，马上关上。
//   ok        可以写
//   busy      被别的程序独占（多半是在 Excel / WPS 里开着），关掉那个程序就好
//   readonly  文件属性是只读，或者当前账号没有写入权限——关掉 Excel 也解决不了，所以不能说成"被占用"
// 别的错误（例如这个路径其实是个文件夹）不在这里下结论，留给后面的读写去报告
function probeWritable (excelPath) {
  try {
    const fd = fs.openSync(excelPath, 'r+')
    fs.closeSync(fd)
    return { ok: true }
  } catch (e) {
    if (e.code === 'EBUSY') return { ok: false, reason: 'busy' }
    if (e.code === 'EACCES') return { ok: false, reason: 'readonly' }
    // Windows 上"只读属性"的文件以写方式打开，报的也是 EPERM（实测如此），和杀毒软件 / 索引服务"一闪而过"地占用
    // 是同一个错误码。光看错误码分不清，再看一眼文件属性里的只读位
    if (e.code === 'EPERM') return { ok: false, reason: isReadOnlyAttribute(excelPath) ? 'readonly' : 'busy' }
    return { ok: true }
  }
}

function check (excelPath) {
  if (!fs.existsSync(excelPath)) return { ok: false, reason: 'not-found', excelPath }
  const lock = readLock(excelPath)
  if (lock && lock.pid !== process.pid && isPidAlive(lock.pid)) {
    return { ok: false, reason: 'locked', lock }
  }
  const probe = probeWritable(excelPath)
  if (!probe.ok) return probe
  return { ok: true }
}

function acquire (excelPath, projectName, projectPath) {
  const status = check(excelPath)
  if (!status.ok) return status
  const lp = lockPathOf(excelPath)
  try {
    fs.writeFileSync(lp, JSON.stringify({
      pid: process.pid,
      projectName,
      projectPath,
      excelPath,
      since: new Date().toISOString()
    }, null, 2), 'utf-8')
  } catch (e) {
    // 这个位置写不进去（只读的 U 盘 / 网络共享、没有权限的文件夹……）。
    // 锁文件都写不成，后面的备份和写入也一定失败，所以在这里就说清楚，而不是带着一个"没有锁"的项目进入工作区
    const why = (e && e.code === 'EACCES') || (e && e.code === 'EPERM') ? '这个位置是只读的，或者当前账号没有写入权限' : `系统报错：${e.message}`
    return { ok: false, reason: 'lockfail', error: `无法在表格所在的文件夹里创建锁定文件（${why}）。请把表格另存到可以写入的位置，再重新关联` }
  }
  heldLocks.add(path.resolve(excelPath))
  return { ok: true }
}

function release (excelPath) {
  // 界面传来的参数不是路径时无事可做（不能交给 path.resolve，它会抛异常）
  if (typeof excelPath !== 'string' || !excelPath) return
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

module.exports = { check, acquire, release, releaseAll, lockPathOf, probeWritable }
