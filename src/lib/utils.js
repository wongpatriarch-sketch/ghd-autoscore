// 名单文本解析：支持 中文逗号 / 英文逗号 / 顿号 / 半角空格 / 全角空格 / 换行，自动清洗两字姓名对齐空格，自动去重去空
export function parseNames (text) {
  if (!text) return []
  const s = String(text).trim()
  if (!s) return []

  const HARD_DELIM_RE = /[，,、；;\n\r\t]+/
  // 匹配类似 "张  三" 或 "欧 阳 锋" 这种单字之间填充排版空格的中文姓名
  const SPACED_CN_NAME = /^[\u4e00-\u9fa5](?:[\s\u3000]+[\u4e00-\u9fa5]){1,2}$/
  let tokens = []

  if (HARD_DELIM_RE.test(s)) {
    const rawItems = s.split(HARD_DELIM_RE)
    for (const item of rawItems) {
      const trimmed = item.trim()
      if (!trimmed) continue
      if (SPACED_CN_NAME.test(trimmed)) {
        tokens.push(trimmed.replace(/[\s\u3000]+/g, ''))
      } else {
        const subItems = trimmed.split(/[\s\u3000]+/)
        tokens.push(...subItems.filter(Boolean))
      }
    }
  } else {
    // 纯空格分隔的文本，若整体就是单个中间带空格的中文名（如输入 "张  三"）
    if (SPACED_CN_NAME.test(s)) {
      tokens.push(s.replace(/[\s\u3000]+/g, ''))
    } else {
      tokens = s.split(/[\s\u3000]+/).filter(Boolean)
    }
  }

  const seen = new Set()
  const out = []
  for (const raw of tokens) {
    const n = raw.trim()
    if (!n || seen.has(n)) continue
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
