const fs = require('fs')
const path = require('path')

const MAX_BACKUPS = 20

function ts () {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

// 落盘前静默滚动备份：Excel 同级目录下的 .backups，仅保留最近 20 份
function backupExcel (excelPath) {
  const dir = path.join(path.dirname(excelPath), '.backups')
  fs.mkdirSync(dir, { recursive: true })
  const base = path.basename(excelPath, path.extname(excelPath))
  // 文件名只精确到秒：同一秒内连续写入时追加序号，保证每份备份都是独立的
  // （否则后一次写入会覆盖前一次的备份，回滚时就恢复不到正确的状态）
  let dest = path.join(dir, `${ts()}_${base}.xlsx`)
  for (let n = 2; fs.existsSync(dest); n++) dest = path.join(dir, `${ts()}_${n}_${base}.xlsx`)
  fs.copyFileSync(excelPath, dest)
  prune(dir, base)
  return dest
}

// 清理旧备份：只认"时间戳[_序号]_原文件名.xlsx"这种完整文件名，并且原文件名要和本表完全一致。
// 不能只看"是不是以 _积分.xlsx 结尾"：同目录下另有「总_积分.xlsx」时，它的备份也以 _积分.xlsx 结尾，
// 会被算进本表的 20 份上限，本表的备份就可能被多删几份
function prune (dir, base) {
  const re = new RegExp(`^\\d{8}_\\d{6}(?:_\\d+)?_${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.xlsx$`)
  const files = fs.readdirSync(dir)
    .filter(f => re.test(f))
    .map(f => {
      // 备份已经拷贝成功后才走到这里；万一某个旧备份恰好被别的东西删了，跳过它即可，不能让本次写入失败
      try { return { f, t: fs.statSync(path.join(dir, f)).mtimeMs } } catch (_) { return null }
    })
    .filter(Boolean)
    .sort((a, b) => b.t - a.t)
  for (const item of files.slice(MAX_BACKUPS)) {
    try { fs.unlinkSync(path.join(dir, item.f)) } catch (_) {}
  }
}

module.exports = { backupExcel }
