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
  const timeStr = ts()
  let dest = path.join(dir, `${timeStr}_${base}.xlsx`)

  // 若当前秒内已存在同名备份，递增序号生成新文件，防止覆盖
  if (fs.existsSync(dest)) {
    let seq = 1
    while (fs.existsSync(path.join(dir, `${timeStr}_${seq}_${base}.xlsx`))) {
      seq++
    }
    dest = path.join(dir, `${timeStr}_${seq}_${base}.xlsx`)
  }

  fs.copyFileSync(excelPath, dest)
  prune(dir, base)
  return dest
}

function prune (dir, base) {
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith(`_${base}.xlsx`))
    .map(f => {
      try {
        return { f, t: fs.statSync(path.join(dir, f)).mtimeMs }
      } catch (_) {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.t - a.t)
  for (const item of files.slice(MAX_BACKUPS)) {
    try { fs.unlinkSync(path.join(dir, item.f)) } catch (_) {}
  }
}

module.exports = { backupExcel }
