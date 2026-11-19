// 名单文本解析：支持 中文逗号 / 英文逗号 / 顿号 / 半角空格 / 全角空格 / 换行，自动去重去空
export function parseNames (text) {
  if (!text) return []
  const parts = String(text).split(/[，,、\s\u3000\n\r\t]+/)
  const seen = new Set()
  const out = []
  for (const raw of parts) {
    const n = raw.trim()
    if (!n) continue
    if (seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

export function makeBatchId () {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  return `B${stamp}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
}

export function fmtTime (iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function round1 (n) {
  return Math.round((Number(n) + Number.EPSILON) * 10000) / 10000
}
