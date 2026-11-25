// 名单文本解析：中文逗号 / 英文逗号 / 顿号 / 分号 / 制表符 / 换行 都可以当分隔符，
// 只用空格（半角、全角）隔开也行；自动去重去空。
//
// 「排版空格」：有的名单为了和三字名对齐，会把两字名写成「张 三」（中间加一个空格）。
// 处理办法：先用上面这些"明确的分隔符"把文本切成小段，如果某一小段从头到尾都是
// 「单个汉字 空格 单个汉字」（一共 2~3 个字），就认定这是一个名字，去掉中间的空格。
// 只在这种没有歧义的情况下才合并：「张 三 李 四」这种只靠空格隔开的几个名字，没法确定该在哪里断开，
// 仍然按单字拆开。这些单字会被判为"不在名册"，由用户逐个指定是谁，不会悄悄把分算到别人头上。
const HARD_DELIM_RE = /[，,、；;\n\r\t]+/
const SPACED_NAME_RE = /^\p{Script=Han}(?:\s+\p{Script=Han}){1,2}$/u

export function parseNames (text) {
  if (!text) return []
  const tokens = []
  for (const item of String(text).split(HARD_DELIM_RE)) {
    const piece = item.trim()
    if (!piece) continue
    if (SPACED_NAME_RE.test(piece)) tokens.push(piece.replace(/\s+/g, ''))
    else tokens.push(...piece.split(/\s+/).filter(Boolean))
  }
  const seen = new Set()
  const out = []
  for (const n of tokens) {
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

// 数值统一保留 4 位小数，消除 0.1 + 0.2 这类浮点误差（与主进程 excelService 的 round4 保持一致）
export function round4 (n) {
  return +Number(n).toFixed(4)
}

// 把一次写入返回的 summaryFixed / uncalculatedFormulas 整理成给用户看的补充说明。
// 没有需要说明的情况时返回空字符串。
export function summaryNote (data) {
  if (!data) return ''
  const parts = []
  if (data.uncalculatedFormulas) {
    parts.push(`主表有 ${data.uncalculatedFormulas} 个公式单元格没有保存计算结果，本次按 0 计入汇总；用 Excel 或 WPS 打开主表保存一次后，再做任意一次写入就会自动纠正`)
  }
  const list = data.summaryFixed
  if (list && list.length) {
    const shown = list.slice(0, 3)
      .map(x => `${x.name}（${x.from === null || x.from === undefined ? '空' : x.from} → ${x.to}）`)
      .join('、')
    parts.push(`有 ${list.length} 行的原汇总与明细对不上，已按明细重算：${shown}${list.length > 3 ? ' 等' : ''}`)
  }
  return parts.join('；')
}
