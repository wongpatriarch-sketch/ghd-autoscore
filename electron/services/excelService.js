const fs = require('fs')
const path = require('path')
require('./exceljsColumnWidth') // 修正 ExcelJS 写回时丢失"列宽 = 9"的列的问题（见该文件里的说明）
const ExcelJS = require('exceljs')
const { ValueType } = ExcelJS
const { backupExcel } = require('./backupService')
const lockService = require('./lockService')

// ---------- 主表列契约（与真实总积分表一致）----------
// A 姓名 | B 夜训周训 | C 升降旗 | D 后勤 | E 综办 | F 汇总 | 第 7 列空白分隔 | 第 8 列起：各活动列
const FIXED_COLS = 6
const NAME_COL = 1
const SUMMARY_COL = 6
const FIRST_ACTIVITY_COL = 7 // 第 7 列起属于"活动区"；第 7 列本身留空作分隔，程序写入的活动列从第 8 列开始
const INCREMENT_COLS = [2, 3, 4, 5] // 只有 B/C/D/E 四列允许做增量累加；F 列由程序重算，不允许直接累加
// 届别行形如「--30届--」。两端的横线可以是 2 个以上的减号、中文破折号（——）或短横线（–），
// 届数前后也允许带空白和一个"第"字：有的表里写成「—— 29 届 ——」「--第26届--」。
// 认不出届别行的后果是它被当成一个"队员"，所以这里宁可放宽一些（队员名字不会长成这样）
const COHORT_RE = /^[-—–]{2,}\s*第?\s*(\d+)\s*届\s*[-—–]{2,}$/
// 带排版空格的姓名：为了和三字名对齐，有的名单把两字名写成「张 三」。
// 整格都是"单个汉字 + 空白"时，它是一个名字而不是几个名字，读出来时把空白去掉
const SPACED_NAME_RE = /^\p{Script=Han}(?:\s+\p{Script=Han})+$/u
const EPSILON = 1e-9

// ---------- 新建模板：表头、列宽、届别行均照真实主表制作 ----------
const TEMPLATE_SHEET_NAME = 'Sheet1'
const TEMPLATE_HEADERS = ['姓名', '夜训周训', '升降旗', '后勤', '综办', '汇总']
const TEMPLATE_WIDTHS = [9, 9, 8.88, 8.88, 8.88, 8.88, 7.83] // 第 7 个是空白分隔列的宽度
const TEMPLATE_FONT = { name: '等线', size: 11 }
const TEMPLATE_HEADER_HEIGHT = 40
const TEMPLATE_COHORTS = [30, 29, 28, 27, 26] // 届别行按届数降序排列
const TEMPLATE_COHORT_FILL = 'FF00B0F0'

// ---------- 取单元格里的内容 ----------
// 下面这些函数都直接接收"单元格"而不是 cell.value，原因是一个很容易踩的坑：
// ExcelJS 通过 cell.value 给出公式单元格时，只保留"非零"的计算结果——公式算出 0 的格子，
// 读出来 result 是空的，和"公式根本没有保存计算结果"长得一模一样。
// 考勤表里次数合计为 0 的人很常见，按 cell.value 判断会把正常的表误判成坏文件。
// cell.type / cell.result 读的是单元格内部模型，0 会被原样保留，所以以它们为准。

// 公式单元格
function isFormula (cell) {
  return cell.type === ValueType.Formula
}

// 文字内容（表头、姓名用）；空单元格、没有可读结果的公式都返回空串
function textOf (v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v instanceof Date) return v.toISOString()
  if (v.richText) return v.richText.map(t => t.text).join('').trim()
  if (v.text !== undefined) return textOf(v.text)
  if (v.result !== undefined) return textOf(v.result)
  if (v.hyperlink) return textOf(v.hyperlink)
  if (v.error !== undefined) return String(v.error)
  if (v.formula !== undefined || v.sharedFormula !== undefined) return ''
  return String(v).trim()
}

function cellText (cell) {
  return isFormula(cell) ? textOf(cell.result) : textOf(cell.value)
}

// 某一行的姓名格（以及别的文字格）的内容。
// 合并单元格里"从属"的格子（多行表头里常见：A1 与 A2 合并成「姓名」）读出来的是左上角那一格的文字，
// 直接用会把表头的第二行误当成一个队员，所以从属格一律按空白处理
function textIn (row, col) {
  const cell = row.getCell(col)
  if (cell.isMerged && cell.master !== cell) return ''
  return cellText(cell)
}

// 数值内容：空、文字、日期、错误值等非数字都返回 null
function numOf (v) {
  if (v === null || v === undefined || v === '' || typeof v === 'object') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

// 单元格里的数值。公式单元格以"文件里保存的计算结果"为准（软件不负责计算公式）
function cellNum (cell) {
  if (isFormula(cell)) {
    const r = cell.result
    // 没有保存计算结果，或者结果是错误值（如 #REF!）：读不出数值
    if (r === undefined || r === null || typeof r === 'object') return null
    return numOf(r)
  }
  return numOf(cell.value)
}

function cellNumOr0 (cell) {
  const n = cellNum(cell)
  return n === null ? 0 : n
}

// 公式单元格，却读不出数值（没有保存计算结果，或者结果是错误值）。
// 这种格子不能当作 0 悄悄使用，各处都要把它如实报告出来。
function isFormulaWithoutNumber (cell) {
  return isFormula(cell) && cellNum(cell) === null
}

// 分数统一保留 4 位小数，消除 0.1 + 0.2 这类浮点误差
function round4 (n) {
  return +Number(n).toFixed(4)
}

// 把 { 姓名: 分值 } 整理成 [姓名, 分值] 列表。
// 分值只认数字和"纯数字的字符串"（如 2、'2.5'），其余类型（NaN、Infinity、布尔值、空值、对象、数组）一律忽略，分值为 0 的也忽略。
// 不直接用 Number() 强转，是因为它会把 true 变成 1、把 [1] 变成 1，等于把类型错误的输入悄悄写进表里
function toEntries (obj) {
  const source = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {}
  return Object.entries(source)
    .map(([name, value]) => {
      const raw = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? Number(value) : NaN
      return [name, round4(raw)]
    })
    .filter(([, value]) => Number.isFinite(value) && value !== 0)
}

// 界面经 IPC 传来的参数统一在这里"整形"：不是普通对象（null、数组、字符串、数字……）一律当成空对象。
// 这样参数类型不对时，后面按"缺少必填项"正常返回错误说明，而不是在解构属性时抛出异常
function payloadOf (payload) {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
}

// 列号只认数字和"纯数字的字符串"（如 3、'3'）。
// 数组、布尔值这些 Number() 能悄悄转成数字的类型不认：Number([3]) 是 3，不能因此就把第 3 列当成合法目标
function colNumber (value) {
  const acceptable = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')
  return acceptable ? Number(value) : NaN
}

// ---------- 基础读写 ----------
async function loadWorkbook (excelPath) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(excelPath)
  return wb
}

async function getSheet (wb) {
  const ws = wb.worksheets[0]
  if (!ws) throw new Error('工作簿中没有工作表')
  return ws
}

// 原子写回：先写临时文件再替换，失败时清理临时文件并返回错误码
async function atomicWrite (wb, excelPath) {
  const tmp = `${excelPath}.tmp-${process.pid}-${Date.now()}`
  try {
    await wb.xlsx.writeFile(tmp)
    fs.renameSync(tmp, excelPath)
    return { ok: true }
  } catch (e) {
    try { fs.unlinkSync(tmp) } catch (_) {}
    return { ok: false, code: e.code || 'WRITE_FAIL', error: e.message }
  }
}

// 文件是否存在。路径不是字符串（界面传错参数）时直接按"不存在"处理，
// 不把它交给 fs.existsSync——新版 Node 对这种参数会打出警告
function fileExists (p) {
  return typeof p === 'string' && p.length > 0 && fs.existsSync(p)
}

// 读、写文件出错时，把底层库的英文报错换成使用者能看懂的话；认不出来的原样返回
function describeIoError (e) {
  const msg = (e && e.message) || String(e)
  if (e && e.code === 'EISDIR') return '选中的是一个文件夹，不是 Excel 文件'
  // 表格旁边存放备份的 .backups 文件夹，被一个同名的普通文件占着（一般是手动误建）：备份存不进去，也就不能写入
  if (e && (e.code === 'EEXIST' || e.code === 'ENOTDIR') && /\.backups/.test(msg)) {
    return '表格旁边的 .backups 应该是存放备份的文件夹，现在被一个同名文件占着。请把那个文件删掉或改名后重试'
  }
  if ((e && e.code === 'EBUSY') || /resource busy|being used by another process/i.test(msg)) {
    return '这张表格正被其他程序占用（多半是在 Excel / WPS 里开着），请先关闭该表格再试'
  }
  // Windows 下"文件被别的程序开着、不让改名 / 替换"报的也是 EPERM，所以不能只说"没有权限"
  if (e && (e.code === 'EACCES' || e.code === 'EPERM')) return '文件被其他程序占用，或者没有访问权限。请先关闭正在使用这个文件的程序（如 Excel / WPS）再试'
  if (/End of data reached|end of central directory|Corrupted zip/i.test(msg)) {
    return '这不是有效的 Excel 文件（.xlsx），或者文件已经损坏。请用 Excel / WPS 打开确认后再试'
  }
  return msg
}

// 写入前的占用检查：文件不存在，或被 Excel/WPS 等其他程序占用时拒绝
function guardBusy (excelPath, action = '写入') {
  if (!fileExists(excelPath)) return { ok: false, code: 'NOT_FOUND', error: '目标 Excel 文件不存在' }
  if (lockService.isFileBusy(excelPath)) {
    return { ok: false, code: 'EBUSY', error: `${action}失败：Excel 文件正被其他程序占用，请关闭该表格后重试` }
  }
  return { ok: true }
}

// 表格实际用到的最后一列的列号。
// 注意不能用 ws.actualColumnCount：它统计的是"有多少个不同的列被用过"，
// 中间有空白分隔列时会少算，进而让新活动列覆盖掉最后一列旧数据。
// 这里按"有内容的最大列号"来算；只有格式、没有内容的空格不算（遍历时会被跳过）。
function lastUsedColumn (ws) {
  let last = FIXED_COLS
  ws.eachRow({ includeEmpty: false }, row => {
    row.eachCell({ includeEmpty: false }, (_cell, col) => {
      if (col > last) last = col
    })
  })
  return last
}

// 按表头文字估算列宽：中日韩文字按 2 个宽度单位、其余按 1 个，取最长的一行
function columnWidth (text) {
  const longest = String(text).split(/\r?\n/).reduce((max, line) => {
    const w = Array.from(line).reduce((sum, ch) => sum + (/[\u2e80-\uffff]/.test(ch) ? 2 : 1), 0)
    return Math.max(max, w)
  }, 0)
  return Math.min(40, Math.max(10, +(longest * 0.95 + 2).toFixed(2)))
}

// 把参照单元格的外观（字体、对齐、边框、底色、数字格式）复制到目标单元格。
// 凡是要改某个已有单元格的样式，都先经过这里，让它拿到自己独有的一份样式，原因是一个 ExcelJS 的坑：
// 读完文件后，样式相同的单元格共用同一个样式对象。直接改目标单元格的样式，表里所有与它同款式的格子
// 都会跟着变，写回时就被一起改掉了（真实主表的活动区里，近两百个空格子共用一种样式，就是这样被改的）。
function copyStyle (src, dst) {
  dst.style = { ...dst.style }
  for (const key of ['font', 'alignment', 'border', 'fill', 'numFmt']) {
    const value = src[key]
    if (value && (typeof value === 'string' ? value : Object.keys(value).length)) {
      dst[key] = typeof value === 'object' ? { ...value } : value
    }
  }
}

// 按姓名定位行号（精确匹配；届别行不参与；同名时只取第一行）
function buildRowMap (ws) {
  const map = new Map()
  const dups = new Set()
  for (let r = 2; r <= ws.rowCount; r++) {
    const a = textIn(ws.getRow(r), NAME_COL)
    if (!a || COHORT_RE.test(a)) continue
    if (map.has(a)) dups.add(a)
    else map.set(a, r)
  }
  return { map, dups }
}

function findActivityCol (ws, activityName) {
  const target = String(activityName || '').trim()
  const lastCol = lastUsedColumn(ws)
  for (let c = FIRST_ACTIVITY_COL; c <= lastCol; c++) {
    if (cellText(ws.getRow(1).getCell(c)) === target) return c
  }
  return null
}

// 给单元格加上一个变化量。
// 加完正好是 0 时写成空白，而不是 0：表里没有分数的格子本来就是空白（只有边框），
// 撤销或更正一笔分数后，格子应当回到这种样子，而不是凭空留下一个 0。
// 汇总列（F）不走这里，它始终写成数字。
function addToCell (row, col, delta) {
  const cell = row.getCell(col)
  const cur = cellNum(cell)
  const next = round4((cur === null ? 0 : cur) + delta)
  cell.value = next === 0 ? null : next
}

// 单元格是否带有外观（字体、对齐、边框、底色、数字格式）
function hasStyle (cell) {
  return ['font', 'alignment', 'border', 'fill', 'numFmt'].some(key => {
    const v = cell[key]
    return v !== undefined && v !== null && v !== '' && (typeof v !== 'object' || Object.keys(v).length > 0)
  })
}

// 记下某一列"现在的样子"：列宽 + 所有只有格式、没有内容的格子。
// 新活动列总是接在最后一个有内容的列后面，而真实主表在这一列上往往已经画好了边框
// （上一个活动删掉后留下的格式）。新建活动会占用这一列；撤销新建时按这里记下的样子恢复，
// 表格才能回到新建前的状态。这一列本来就是空白时返回 null。
function columnSkeleton (ws, col) {
  const cells = []
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.findRow(r)
    const cell = row && row.findCell(col)
    if (cell && hasStyle(cell)) cells.push([r, JSON.parse(JSON.stringify(cell.style))])
  }
  const width = ws.getColumn(col).width
  return width === undefined && !cells.length ? null : { width, cells }
}

// 把某一列恢复成 columnSkeleton 记下的样子。
// skeleton 来自项目配置文件，可能被手工改坏，所以逐项校验，不合法的条目直接跳过。
function restoreColumn (ws, col, skeleton) {
  if (!skeleton || typeof skeleton !== 'object') return
  const width = Number(skeleton.width)
  if (Number.isFinite(width) && width > 0) ws.getColumn(col).width = width
  if (!Array.isArray(skeleton.cells)) return
  for (const item of skeleton.cells) {
    if (!Array.isArray(item) || !Number.isInteger(item[0]) || item[0] < 1) continue
    const style = item[1]
    if (!style || typeof style !== 'object') continue
    ws.getCell(item[0], col).style = JSON.parse(JSON.stringify(style))
  }
}

// 数字格式是不是"日期 / 时间"类（如 yyyy-mm-dd、h:mm）。
// 判断方法和 ExcelJS 读表时用的完全一样：去掉方括号、引号里的内容后，只要还出现 y m d h s b 之一就算。
// 这一点必须和 ExcelJS 一致——它读表时会把"日期格式"格子里的数字转成日期对象，
// 而程序只认数字，转换之后的汇总格在程序眼里就成了"读不出数值"
function isDateFormat (fmt) {
  if (!fmt || typeof fmt !== 'string') return false
  return /[ymdhMsb]+/.test(fmt.replace(/\[[^\]]*]/g, '').replace(/"[^"]*"/g, ''))
}

// 汇总列通常用的数字格式：取第一个"汇总格是数字且不是日期格式"的队员格的格式，找不到就用常规格式
function summaryFormatOf (ws) {
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.findRow(r)
    const cell = row && row.getCell(SUMMARY_COL)
    if (cell && cellNum(cell) !== null && !isDateFormat(cell.numFmt)) return cell.numFmt || 'General'
  }
  return 'General'
}

// 计入汇总分的列：B~E 四个明细列，加上第 7 列起"有表头"的列——和 readWorkbook 认定活动列的口径一致。
// 没有表头的列（第 7 列分隔列、表头被误删的列）里即使填了数字也不算，否则界面上看不到的数字会悄悄进汇总分。
function scoreColumns (ws) {
  const headerRow = ws.getRow(1)
  const cols = [...INCREMENT_COLS]
  for (let c = FIRST_ACTIVITY_COL; c <= lastUsedColumn(ws); c++) {
    if (cellText(headerRow.getCell(c))) cols.push(c)
  }
  return cols
}

// 重算所有队员行的 F 列：F = B + C + D + E + 全部活动列之和（空单元格按 0）。
// 届别行和姓名为空的行不动。
// deltasByRow 是本次操作对各行的"预期汇总变化量"，用来区分"本次操作带来的正常变化"和
// "原汇总本来就和明细对不上"；后者以及"没有计算结果的公式"都会被统计出来交给界面提示。
function recalcSummary (ws, deltasByRow) {
  const cols = scoreColumns(ws)
  const summaryFixed = []
  let uncalculatedFormulas = 0
  let summaryFormat = null // 用到时才去取（绝大多数表里汇总格本来就是数字，用不到）
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const name = textIn(row, NAME_COL)
    if (!name || COHORT_RE.test(name)) continue
    let sum = 0
    for (const c of cols) {
      const cell = row.getCell(c)
      if (isFormulaWithoutNumber(cell)) uncalculatedFormulas++
      sum += cellNumOr0(cell)
    }
    const fCell = row.getCell(SUMMARY_COL)
    const fRaw = cellNum(fCell)
    const oldF = fRaw === null ? 0 : fRaw
    const newF = round4(sum)
    // 汇总格里不是数字（文字、日期、错误值、没算出来的公式）：读不出数值，要改成算出来的数字。
    // 只含空白的格子看起来就是空的，不算
    const rawF = fCell.value
    const blankText = typeof rawF === 'string' && rawF.trim() === ''
    const badContent = fRaw === null && rawF !== null && rawF !== undefined && !blankText
    if (Math.abs(newF - oldF) > EPSILON || badContent) {
      // 原来是空白、算出来也是 0 的格子不会走到这里（oldF = 0 = newF，且不是坏内容），保持空白
      fCell.value = newF
      // 日期格式的格子里写数字，Excel 会把它显示成一个日期，下次读表时 ExcelJS 也会把它转成日期对象。
      // 所以这种格子要换掉数字格式。改之前先让这个格子拿到独有的一份样式（见 copyStyle 的说明）
      if (isDateFormat(fCell.numFmt)) {
        copyStyle(fCell, fCell)
        if (summaryFormat === null) summaryFormat = summaryFormatOf(ws)
        fCell.numFmt = summaryFormat
      }
    }
    const expected = round4(oldF + (deltasByRow ? (deltasByRow.get(r) || 0) : 0))
    // from 为 null 表示原来汇总格是空的或者不是数字
    if (badContent || Math.abs(newF - expected) > EPSILON) summaryFixed.push({ name, row: r, from: fRaw, to: newF })
  }
  return { summaryFixed, uncalculatedFormulas }
}

// 所有写操作的公共骨架：
//   占用检查 → 读表 → prepare（只读校验，不通过则直接退出、不留任何痕迹）
//   → 备份 → commit（真正修改）→ 重算 F 列 → 原子写回
async function runMutation (excelPath, { prepare, commit, data }) {
  const g = guardBusy(excelPath, '写入')
  if (!g.ok) return g
  try {
    const wb = await loadWorkbook(excelPath)
    const ws = await getSheet(wb)
    const prepared = await prepare(ws)
    if (!prepared.ok) return prepared

    const backup = backupExcel(excelPath)
    const deltasByRow = commit(ws, prepared)
    const recalculated = recalcSummary(ws, deltasByRow)
    const r = await atomicWrite(wb, excelPath)
    if (!r.ok) return { ...r, error: `写入失败：${describeIoError({ code: r.code, message: r.error })}` }
    return {
      ok: true,
      data: { backup, ...recalculated, ...data(prepared) }
    }
  } catch (e) {
    return { ok: false, code: e.code || 'WRITE_FAIL', error: `写入失败：${describeIoError(e)}` }
  }
}

// ---------- 写入排队 ----------
// 同一张表格的写操作一个接一个执行：后到的要等前一个写完再开始。
// 界面上的按钮在写入期间是禁用的，正常情况下不会有两个写入同时发生；
// 但万一有（连点、自动化脚本、以后新增的入口），不排队的话两次写入都会基于"写入前"的旧内容各改各的，
// 后写的会把先写的整个覆盖掉——先写的那次等于白写，界面却已经提示成功、历史里也记了一笔。
const writeTails = new Map()

function writeKey (excelPath) {
  try {
    const abs = path.resolve(String(excelPath))
    return process.platform === 'win32' ? abs.toLowerCase() : abs
  } catch (_) {
    return String(excelPath)
  }
}

async function mutateWorkbook (excelPath, options) {
  const key = writeKey(excelPath)
  const tail = writeTails.get(key)
  const current = tail ? tail.then(() => runMutation(excelPath, options)) : runMutation(excelPath, options)
  // 排在后面的写入只认"前一个是否结束"，不关心它是成功还是失败，所以记进队列的是永远不会"拒绝"的那一个
  const settled = current.catch(() => undefined)
  writeTails.set(key, settled)
  try {
    return await current
  } finally {
    if (writeTails.get(key) === settled) writeTails.delete(key)
  }
}

// ---------- 读取主表（只读，不需要写权限）----------
async function readWorkbook (excelPath) {
  if (!fileExists(excelPath)) return { ok: false, code: 'NOT_FOUND', error: '目标 Excel 文件不存在' }
  try {
    const wb = await loadWorkbook(excelPath)
    const ws = await getSheet(wb)

    const lastCol = lastUsedColumn(ws)
    const headers = []
    for (let c = 1; c <= lastCol; c++) headers.push(cellText(ws.getRow(1).getCell(c)))

    // 表头为空的列（如第 7 列空白分隔列）不算活动列
    const activityColumns = []
    for (let c = FIRST_ACTIVITY_COL; c <= lastCol; c++) {
      if (headers[c - 1]) activityColumns.push({ name: headers[c - 1], col: c })
    }
    // 活动列重名：按活动名查找列时只会命中排在前面的那一列，要如实告诉界面
    const duplicateColumns = activityColumns
      .map(ac => ac.name)
      .filter((name, i, all) => all.indexOf(name) !== i)

    const members = []
    const nameCount = {}
    let generation = null
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const a = textIn(row, NAME_COL)
      if (!a) continue
      const m = a.match(COHORT_RE)
      if (m) { generation = parseInt(m[1], 10); continue }
      // 活动分按"列号"存，而不是按活动名存：两列重名时，按名字存会让后一列覆盖前一列
      const extras = {}
      for (const ac of activityColumns) extras[ac.col] = cellNum(row.getCell(ac.col))
      members.push({
        row: r,
        name: a,
        generation,
        b: cellNum(row.getCell(2)),
        c: cellNum(row.getCell(3)),
        d: cellNum(row.getCell(4)),
        e: cellNum(row.getCell(5)),
        f: cellNum(row.getCell(SUMMARY_COL)),
        extras
      })
      nameCount[a] = (nameCount[a] || 0) + 1
    }
    const duplicateNames = Object.keys(nameCount).filter(k => nameCount[k] > 1)

    return {
      ok: true,
      data: {
        filePath: excelPath,
        headers,
        members,
        activityColumns,
        duplicateNames,
        duplicateColumns,
        lastCol,
        totalRows: ws.rowCount
      }
    }
  } catch (e) {
    return { ok: false, code: e.code || 'READ_FAIL', error: `读取失败：${describeIoError(e)}` }
  }
}

// ---------- 按真实主表格式新建空白模板 ----------
async function createTemplate (targetPath) {
  try {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet(TEMPLATE_SHEET_NAME)
    ws.properties.defaultRowHeight = 14
    TEMPLATE_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w })

    const header = ws.getRow(1)
    header.height = TEMPLATE_HEADER_HEIGHT
    TEMPLATE_HEADERS.forEach((title, i) => {
      const cell = header.getCell(i + 1)
      cell.value = title
      cell.font = { ...TEMPLATE_FONT }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
    })
    // 第 7 列：空白分隔列——只有表头样式、没有文字，和真实主表一致
    const gap = header.getCell(FIRST_ACTIVITY_COL)
    gap.font = { ...TEMPLATE_FONT }
    gap.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }

    ws.getColumn(NAME_COL).alignment = { horizontal: 'center' }

    // 届别行：程序靠「--30届--」这样的文字识别届别
    for (const g of TEMPLATE_COHORTS) {
      const row = ws.addRow()
      row.height = 16
      const nameCell = row.getCell(NAME_COL)
      nameCell.value = `--${g}届--`
      nameCell.font = { ...TEMPLATE_FONT }
      nameCell.alignment = { horizontal: 'center' }
      nameCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEMPLATE_COHORT_FILL } }
      row.getCell(SUMMARY_COL).value = 0
    }

    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1, showGridLines: true, zoomScale: 115, zoomScaleNormal: 115 }]
    const r = await atomicWrite(wb, targetPath)
    return r.ok ? { ok: true } : { ...r, error: `模板创建失败：${r.error}` }
  } catch (e) {
    return { ok: false, code: e.code || 'TEMPLATE_FAIL', error: `模板创建失败：${describeIoError(e)}` }
  }
}

// ---------- 活动结算：追加新列 + 重算 F 列 ----------
async function commitEvent (excelPath, payload) {
  const { activityName, scores } = payloadOf(payload)
  const name = typeof activityName === 'string' ? activityName.trim() : ''
  const entries = toEntries(scores)
  if (!name) return { ok: false, code: 'BAD_NAME', error: '活动名称不能为空' }
  if (!entries.length) return { ok: false, code: 'EMPTY_ACTIVITY', error: `「${name}」没有任何队员得分，未写入主表` }

  return mutateWorkbook(excelPath, {
    prepare (ws) {
      const { map, dups } = buildRowMap(ws)
      const missing = entries.filter(([n]) => !map.has(n)).map(([n]) => n)
      if (missing.length) {
        return { ok: false, code: 'MEMBER_MISSING', error: `以下队员在主表中不存在：${missing.join('、')}`, data: { missing } }
      }
      const lastCol = lastUsedColumn(ws)
      for (let c = 1; c <= lastCol; c++) {
        if (cellText(ws.getRow(1).getCell(c)) === name) {
          return { ok: false, code: 'DUP_COLUMN', error: `主表中已有名为「${name}」的列，请更换活动名称` }
        }
      }
      // 新列接在最后一个有内容的列之后；第 7 列是空白分隔列，永远不占用
      const newCol = Math.max(lastCol, FIRST_ACTIVITY_COL) + 1
      // 外观参照列：有活动列时仿照最后一个活动列，否则仿照「汇总」列
      const styleCol = lastCol > FIRST_ACTIVITY_COL ? lastCol : SUMMARY_COL
      return { ok: true, map, dups, newCol, styleCol, prevColumn: columnSkeleton(ws, newCol) }
    },
    commit (ws, { map, newCol, styleCol }) {
      const headerRow = ws.getRow(1)
      const headerCell = headerRow.getCell(newCol)
      copyStyle(headerRow.getCell(styleCol), headerCell)
      headerCell.value = name
      headerCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      if (!headerRow.height || headerRow.height < TEMPLATE_HEADER_HEIGHT) headerRow.height = TEMPLATE_HEADER_HEIGHT
      ws.getColumn(newCol).width = columnWidth(name)

      const deltasByRow = new Map()
      for (const [memberName, value] of entries) {
        const r = map.get(memberName)
        const row = ws.getRow(r)
        const cell = row.getCell(newCol)
        // 外观（字体、对齐、边框……）整体照参照列，新列看上去和左边各列是同一套排版
        copyStyle(row.getCell(styleCol), cell)
        cell.value = value
        // 只有参照列自己没定义对齐方式时（空表、空列），分数才用默认的居中显示
        if (!cell.alignment) cell.alignment = { horizontal: 'center', vertical: 'middle' }
        deltasByRow.set(r, value)
      }
      return deltasByRow
    },
    // prevColumn：新列占用的那一列在新建前的样子（列宽、已有的格式格子）。界面把它存进历史记录，撤销新建时带回来
    data: ({ dups, newCol, prevColumn }) => ({ column: newCol, duplicateNames: [...dups], prevColumn })
  })
}

// ---------- 增量累加（B/C/D/E 列 + 重算 F 列）----------
async function applyIncrement (excelPath, payload) {
  const { targetCol, deltas } = payloadOf(payload)
  const col = colNumber(targetCol)
  const entries = toEntries(deltas)
  if (!INCREMENT_COLS.includes(col)) {
    return { ok: false, code: 'BAD_TARGET_COL', error: `只能对夜训周训 / 升降旗 / 后勤 / 综办四列做增量累加，不允许写入第 ${targetCol} 列` }
  }
  if (!entries.length) return { ok: false, code: 'EMPTY_DELTAS', error: '没有任何需要写入的分数变动' }

  return mutateWorkbook(excelPath, {
    prepare (ws) {
      const { map, dups } = buildRowMap(ws)
      const missing = entries.filter(([n]) => !map.has(n)).map(([n]) => n)
      if (missing.length) {
        return { ok: false, code: 'MEMBER_MISSING', error: `以下队员在主表中不存在：${missing.join('、')}`, data: { missing } }
      }
      return { ok: true, map, dups }
    },
    commit (ws, { map }) {
      const deltasByRow = new Map()
      for (const [memberName, delta] of entries) {
        const r = map.get(memberName)
        addToCell(ws.getRow(r), col, delta)
        deltasByRow.set(r, round4((deltasByRow.get(r) || 0) + delta))
      }
      return deltasByRow
    },
    data: ({ dups }) => ({ targetCol: col, duplicateNames: [...dups] })
  })
}

// ---------- 活动修改：按活动列名施加差值 + 重算 F 列 ----------
async function applyEventEdit (excelPath, payload) {
  const { activityName, deltas } = payloadOf(payload)
  const name = typeof activityName === 'string' ? activityName.trim() : ''
  const entries = toEntries(deltas)
  if (!name) return { ok: false, code: 'BAD_NAME', error: '活动名称不能为空' }
  if (!entries.length) return { ok: false, code: 'EMPTY_DELTAS', error: '没有任何需要写入的分数变动' }

  return mutateWorkbook(excelPath, {
    prepare (ws) {
      const colIdx = findActivityCol(ws, name)
      if (!colIdx) return { ok: false, code: 'COL_NOT_FOUND', error: `未找到活动列「${name}」` }
      const { map, dups } = buildRowMap(ws)
      const missing = entries.filter(([n]) => !map.has(n)).map(([n]) => n)
      if (missing.length) {
        return { ok: false, code: 'MEMBER_MISSING', error: `以下队员在主表中不存在：${missing.join('、')}`, data: { missing } }
      }
      return { ok: true, map, dups, colIdx }
    },
    commit (ws, { map, colIdx }) {
      const deltasByRow = new Map()
      for (const [memberName, delta] of entries) {
        const r = map.get(memberName)
        addToCell(ws.getRow(r), colIdx, delta)
        deltasByRow.set(r, round4((deltasByRow.get(r) || 0) + delta))
      }
      return deltasByRow
    },
    data: ({ dups, colIdx }) => ({ column: colIdx, duplicateNames: [...dups] })
  })
}

// ---------- 撤销初次创建：物理删除活动列 + 重算 F 列 ----------
// prevColumn：新建活动时记下的"这一列新建前的样子"（由界面从历史记录里带回来），有就照它恢复
async function deleteActivityColumn (excelPath, payload) {
  const { activityName, prevColumn } = payloadOf(payload)
  const name = typeof activityName === 'string' ? activityName.trim() : ''
  if (!name) return { ok: false, code: 'BAD_NAME', error: '活动名称不能为空' }

  return mutateWorkbook(excelPath, {
    prepare (ws) {
      const colIdx = findActivityCol(ws, name)
      if (!colIdx) return { ok: false, code: 'COL_NOT_FOUND', error: `未找到活动列「${name}」` }
      // 这一列右边还有几个有内容的列。正常是 0（新活动总是接在最后）；
      // 万一有人后来在表里手工往右边加了内容，删列后右侧各列左移，被删的列就落在右边那几列之后
      const tail = lastUsedColumn(ws) - colIdx
      return { ok: true, colIdx, tail }
    },
    commit (ws, { colIdx, tail }) {
      // 汇总分的变化量 = 这一列里各人的分数（取负）。交给重算函数核对，
      // 否则重算函数会把这些正常的变化误报成"原汇总与明细对不上"
      const deltasByRow = new Map()
      for (let r = 2; r <= ws.rowCount; r++) {
        const row = ws.getRow(r)
        const member = textIn(row, NAME_COL)
        if (!member || COHORT_RE.test(member)) continue
        const v = cellNum(row.getCell(colIdx))
        if (v !== null && v !== 0) deltasByRow.set(r, round4(-v))
      }
      ws.spliceColumns(colIdx, 1) // 右侧各列整体左移，列宽与单元格样式随之移动
      restoreColumn(ws, colIdx + tail, prevColumn)
      return deltasByRow
    },
    data: () => ({})
  })
}

// ---------- 把写入前的备份恢复为主表（历史记录保存失败时的补偿）----------
async function restoreBackup (excelPath, backupPath) {
  const g = guardBusy(excelPath, '恢复')
  if (!g.ok) return g
  const norm = p => (process.platform === 'win32' ? p.toLowerCase() : p)
  const backupDir = norm(path.join(path.dirname(path.resolve(excelPath)), '.backups') + path.sep)
  const abs = path.resolve(String(backupPath || ''))
  if (!norm(abs).startsWith(backupDir) || path.extname(abs).toLowerCase() !== '.xlsx') {
    return { ok: false, code: 'BAD_BACKUP', error: '备份文件路径不合法，已拒绝恢复' }
  }
  if (!fileExists(abs)) return { ok: false, code: 'NOT_FOUND', error: '备份文件不存在' }
  try {
    fs.copyFileSync(abs, excelPath)
    return { ok: true }
  } catch (e) {
    return { ok: false, code: e.code || 'RESTORE_FAIL', error: `恢复备份失败：${describeIoError(e)}` }
  }
}

// ---------- 外部导入表解析 ----------
// mode: 'count' -> 严格匹配 姓名 + 总次数；'sandwich' -> 首列姓名 + 尾列总积分（中间列自适应忽略）

// 导入表的表头文字去掉所有空白后再比较：有的表头为了对齐加了空格或换了行（「姓 名」「总\n次数」）
const cleanHeader = s => String(s || '').replace(/\s+/g, '')

// 在一个工作表的前 15 行里找表头，返回表头所在行和两列的列号；找不到返回 null
function findImportHeader (ws, mode) {
  const limit = Math.min(ws.rowCount, 15)
  for (let r = 1; r <= limit; r++) {
    const cols = []
    ws.getRow(r).eachCell((cell, c) => {
      const t = cellText(cell)
      if (t) cols.push({ key: cleanHeader(t), c })
    })
    const nc = cols.find(x => x.key === '姓名')
    if (mode === 'count') {
      const vc = cols.find(x => x.key === '总次数')
      if (nc && vc) return { headerRowIdx: r, nameCol: nc.c, valueCol: vc.c }
    } else {
      const vcs = cols.filter(x => x.key === '总积分')
      if (nc && vcs.length) return { headerRowIdx: r, nameCol: nc.c, valueCol: vcs[vcs.length - 1].c }
    }
  }
  return null
}

async function readExternal (filePath, mode) {
  try {
    if (!fileExists(filePath)) return { ok: false, code: 'NOT_FOUND', error: '导入文件不存在' }
    const wb = await loadWorkbook(filePath)
    if (!wb.worksheets.length) return { ok: false, code: 'EMPTY', error: '导入文件中没有工作表' }

    // 从第一个工作表起依次找，用第一个带有所需表头的工作表。
    // 有的文件把封面、说明或原始记录放在前面的工作表里，要导入的那张表排在后面
    let ws = null
    let header = null
    for (const sheet of wb.worksheets) {
      header = findImportHeader(sheet, mode)
      if (header) { ws = sheet; break }
    }
    if (!header) {
      const need = mode === 'count' ? '姓名 / 总次数' : '姓名 / 总积分'
      return { ok: false, code: 'HEADER_MISMATCH', error: `没有在导入文件里找到「${need}」表头（已逐个查看每个工作表的前 15 行），请核对表格格式` }
    }
    const { headerRowIdx, nameCol, valueCol } = header
    const valueHeader = cellText(ws.getRow(headerRowIdx).getCell(valueCol))

    const entries = []
    let uncalculated = 0
    for (let r = headerRowIdx + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      let name = textIn(row, nameCol)
      if (!name || COHORT_RE.test(name)) continue
      if (SPACED_NAME_RE.test(name)) name = name.replace(/\s+/g, '')
      const cell = row.getCell(valueCol)
      if (isFormulaWithoutNumber(cell)) { uncalculated++; continue }
      entries.push({ name, count: cellNumOr0(cell) })
    }
    // 公式没有保存计算结果时读到的是空值，若按 0 导入会把分数算错，宁可拒绝并说明原因
    if (uncalculated) {
      return {
        ok: false,
        code: 'FORMULA_NO_RESULT',
        error: `导入表的「${valueHeader}」列有 ${uncalculated} 个公式单元格没有保存计算结果，无法读出数值。请用 Excel 或 WPS 打开该表格，确认数值显示正常后保存一次，再重新导入。`,
        data: { uncalculated }
      }
    }
    return { ok: true, data: { fileName: path.basename(filePath), sheetName: ws.name, sheetCount: wb.worksheets.length, entries } }
  } catch (e) {
    return { ok: false, code: e.code || 'EXTERNAL_READ_FAIL', error: `导入文件解析失败：${describeIoError(e)}` }
  }
}

module.exports = {
  readWorkbook,
  createTemplate,
  commitEvent,
  applyIncrement,
  applyEventEdit,
  deleteActivityColumn,
  restoreBackup,
  readExternal
}
