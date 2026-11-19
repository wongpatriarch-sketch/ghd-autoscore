const fs = require('fs')
const path = require('path')
const ExcelJS = require('exceljs')
const { backupExcel } = require('./backupService')
const lockService = require('./lockService')

const FIXED_COLS = 6 // A姓名 B夜训周训 C升降旗 D后勤部 E综办部 F汇总
const COHORT_RE = /^[-—–]{2,}\s*第?\s*(\d+)\s*届\s*[-—–]{2,}$/

function textOf (v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v instanceof Date) return v.toISOString()
  if (v.richText) return v.richText.map(t => t.text).join('').trim()
  if (v.text !== undefined) return textOf(v.text)
  if (v.result !== undefined) return textOf(v.result)
  if (v.hyperlink) return textOf(v.hyperlink)
  return String(v).trim()
}

function numOf (v) {
  if (v === null || v === undefined || v === '') return null
  let raw = v
  if (typeof v === 'object') raw = v.result !== undefined ? v.result : (v.text !== undefined ? v.text : null)
  if (raw === null || raw === undefined || raw === '') return null
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

function numOr0 (v) {
  const n = numOf(v)
  return n === null ? 0 : n
}

function findHeaderRow (ws, required) {
  const limit = Math.min(ws.rowCount, 15)
  for (let r = 1; r <= limit; r++) {
    const row = ws.getRow(r)
    const hits = {}
    row.eachCell((cell, col) => {
      const t = textOf(cell.value)
      if (required.includes(t) && !(t in hits)) hits[t] = col
    })
    if (required.every(k => k in hits)) return { row: r, hits }
  }
  return null
}

async function loadWorkbook (excelPath) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(excelPath)
  return wb
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

function guardBusy (excelPath) {
  if (!fs.existsSync(excelPath)) return { ok: false, code: 'NOT_FOUND', error: '目标 Excel 文件不存在' }
  if (lockService.isFileBusy(excelPath)) {
    return { ok: false, code: 'EBUSY', error: '写入失败：Excel 文件正被其他程序占用，请关闭该表格后重试' }
  }
  return { ok: true }
}

async function getSheet (wb) {
  const ws = wb.worksheets[0]
  if (!ws) throw new Error('工作簿中没有工作表')
  return ws
}

// ---------- 读取主表 ----------
async function readWorkbook (excelPath) {
  const g = guardBusy(excelPath)
  if (!g.ok) return g
  try {
    const wb = await loadWorkbook(excelPath)
    const ws = await getSheet(wb)

    const headers = []
    const colCount = Math.max(ws.actualColumnCount || 0, FIXED_COLS)
    const headerRow = ws.getRow(1)
    for (let c = 1; c <= colCount; c++) headers.push(textOf(headerRow.getCell(c).value))

    const activityColumns = []
    for (let c = FIXED_COLS + 1; c <= colCount; c++) {
      if (headers[c - 1]) activityColumns.push({ name: headers[c - 1], col: c })
    }

    const members = []
    const nameCount = {}
    let generation = null
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const a = textOf(row.getCell(1).value)
      if (!a) continue
      const m = a.match(COHORT_RE)
      if (m) { generation = parseInt(m[1], 10); continue }
      const extras = {}
      for (const ac of activityColumns) extras[ac.name] = numOf(row.getCell(ac.col).value)
      members.push({
        row: r,
        name: a,
        generation,
        b: numOf(row.getCell(2).value),
        c: numOf(row.getCell(3).value),
        d: numOf(row.getCell(4).value),
        e: numOf(row.getCell(5).value),
        f: numOf(row.getCell(6).value),
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
        lastCol: colCount,
        totalRows: ws.rowCount
      }
    }
  } catch (e) {
    return { ok: false, code: e.code || 'READ_FAIL', error: `读取失败：${e.message}` }
  }
}

// ---------- 按标准模板新建 ----------
async function createTemplate (targetPath) {
  try {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('总积分')
    const titles = ['姓名', '夜训周训', '升降旗', '后勤部', '综办部', '汇总']
    const header = ws.getRow(1)
    titles.forEach((t, i) => {
      const cell = header.getCell(i + 1)
      cell.value = t
      cell.font = { bold: true }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }
    })
    header.commit && header.commit()
    ws.getColumn(1).width = 14
    for (let c = 2; c <= 6; c++) ws.getColumn(c).width = 12
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    const r = await atomicWrite(wb, targetPath)
    return r.ok ? { ok: true } : r
  } catch (e) {
    return { ok: false, code: e.code || 'TEMPLATE_FAIL', error: `模板创建失败：${e.message}` }
  }
}

// 按姓名定位行号（精确匹配，含届别行过滤）
function buildRowMap (ws) {
  const map = new Map()
  const dups = new Set()
  for (let r = 2; r <= ws.rowCount; r++) {
    const a = textOf(ws.getRow(r).getCell(1).value)
    if (!a || COHORT_RE.test(a)) continue
    if (map.has(a)) dups.add(a)
    else map.set(a, r)
  }
  return { map, dups }
}

function addToCell (row, col, delta) {
  const cur = numOr0(row.getCell(col).value)
  row.getCell(col).value = +(cur + delta).toFixed(4)
}

// ---------- 活动结算：追加新列 + F 汇总同步 ----------
async function commitEvent (excelPath, { activityName, scores }) {
  const g = guardBusy(excelPath)
  if (!g.ok) return g
  try {
    backupExcel(excelPath)
    const wb = await loadWorkbook(excelPath)
    const ws = await getSheet(wb)
    const { map, dups } = buildRowMap(ws)

    const name = String(activityName).trim()
    if (!name) return { ok: false, code: 'BAD_NAME', error: '活动名称不能为空' }
    const colCount = Math.max(ws.actualColumnCount || 0, FIXED_COLS)
    for (let c = 1; c <= colCount; c++) {
      if (textOf(ws.getRow(1).getCell(c).value) === name) {
        const isFixed = c <= FIXED_COLS
        return {
          ok: false,
          code: 'DUP_COLUMN',
          error: isFixed ? `「${name}」为前 6 列固定列名，不能用作活动名称` : `已存在同名活动列「${name}」，请更换活动名称`
        }
      }
    }

    const newCol = colCount + 1
    const headerCell = ws.getRow(1).getCell(newCol)
    headerCell.value = name
    headerCell.font = { bold: true }
    headerCell.alignment = { horizontal: 'center', vertical: 'middle' }
    ws.getColumn(newCol).width = 14

    const missing = []
    for (const [memberName, value] of Object.entries(scores)) {
      if (!value) continue
      const r = map.get(memberName)
      if (!r) { missing.push(memberName); continue }
      const row = ws.getRow(r)
      row.getCell(newCol).value = +Number(value).toFixed(4)
      addToCell(row, FIXED_COLS, value)
    }
    if (missing.length) {
      return { ok: false, code: 'MEMBER_MISSING', error: `以下队员在主表中不存在：${missing.join('、')}`, data: { missing } }
    }
    const r = await atomicWrite(wb, excelPath)
    if (!r.ok) return r
    return { ok: true, data: { column: newCol, duplicateNames: [...dups] } }
  } catch (e) {
    return { ok: false, code: e.code || 'COMMIT_FAIL', error: `写入失败：${e.message}` }
  }
}

// ---------- 增量累加（B/C/D/E 列 + F 汇总） ----------
async function applyIncrement (excelPath, { targetCol, deltas }) {
  const g = guardBusy(excelPath)
  if (!g.ok) return g
  try {
    backupExcel(excelPath)
    const wb = await loadWorkbook(excelPath)
    const ws = await getSheet(wb)
    const { map, dups } = buildRowMap(ws)
    const missing = []
    for (const [memberName, delta] of Object.entries(deltas)) {
      if (!delta) continue
      const r = map.get(memberName)
      if (!r) { missing.push(memberName); continue }
      const row = ws.getRow(r)
      addToCell(row, targetCol, delta)
      addToCell(row, FIXED_COLS, delta)
    }
    if (missing.length) {
      return { ok: false, code: 'MEMBER_MISSING', error: `以下队员在主表中不存在：${missing.join('、')}`, data: { missing } }
    }
    const res = await atomicWrite(wb, excelPath)
    if (!res.ok) return res
    return { ok: true, data: { duplicateNames: [...dups] } }
  } catch (e) {
    return { ok: false, code: e.code || 'INCREMENT_FAIL', error: `写入失败：${e.message}` }
  }
}

// ---------- 活动修改：按活动列名施加差值 ----------
async function applyEventEdit (excelPath, { activityName, deltas }) {
  const g = guardBusy(excelPath)
  if (!g.ok) return g
  try {
    const wb0 = await loadWorkbook(excelPath)
    const ws0 = await getSheet(wb0)
    const colIdx = findActivityCol(ws0, activityName)
    if (!colIdx) return { ok: false, code: 'COL_NOT_FOUND', error: `未找到活动列「${activityName}」` }
    backupExcel(excelPath)
    const { map } = buildRowMap(ws0)
    const missing = []
    for (const [memberName, delta] of Object.entries(deltas)) {
      if (!delta) continue
      const r = map.get(memberName)
      if (!r) { missing.push(memberName); continue }
      const row = ws0.getRow(r)
      addToCell(row, colIdx, delta)
      addToCell(row, FIXED_COLS, delta)
    }
    if (missing.length) {
      return { ok: false, code: 'MEMBER_MISSING', error: `以下队员在主表中不存在：${missing.join('、')}`, data: { missing } }
    }
    const res = await atomicWrite(wb0, excelPath)
    if (!res.ok) return res
    return { ok: true }
  } catch (e) {
    return { ok: false, code: e.code || 'EDIT_FAIL', error: `写入失败：${e.message}` }
  }
}

function findActivityCol (ws, activityName) {
  const colCount = ws.actualColumnCount || FIXED_COLS
  for (let c = FIXED_COLS + 1; c <= colCount; c++) {
    if (textOf(ws.getRow(1).getCell(c).value) === activityName) return c
  }
  return null
}

// ---------- 撤销初次创建：F 反向扣减 + 物理删除活动列 ----------
async function deleteActivityColumn (excelPath, { activityName, deltas }) {
  const g = guardBusy(excelPath)
  if (!g.ok) return g
  try {
    const wb = await loadWorkbook(excelPath)
    const ws = await getSheet(wb)
    const colIdx = findActivityCol(ws, activityName)
    if (!colIdx) return { ok: false, code: 'COL_NOT_FOUND', error: `未找到活动列「${activityName}」` }
    backupExcel(excelPath)
    const { map } = buildRowMap(ws)
    for (const [memberName, delta] of Object.entries(deltas || {})) {
      if (!delta) continue
      const r = map.get(memberName)
      if (!r) continue
      addToCell(ws.getRow(r), FIXED_COLS, -delta)
    }
    ws.spliceColumns(colIdx, 1)
    const res = await atomicWrite(wb, excelPath)
    if (!res.ok) return res
    return { ok: true }
  } catch (e) {
    return { ok: false, code: e.code || 'DELETE_COL_FAIL', error: `写入失败：${e.message}` }
  }
}

// ---------- 外部导入表解析 ----------
// mode: 'count' -> 严格匹配 姓名 + 总次数；'sandwich' -> 首列姓名 + 尾列总积分（中间列自适应忽略）
async function readExternal (filePath, mode) {
  try {
    if (!fs.existsSync(filePath)) return { ok: false, code: 'NOT_FOUND', error: '导入文件不存在' }
    const wb = await loadWorkbook(filePath)
    const ws = wb.worksheets[0]
    if (!ws) return { ok: false, code: 'EMPTY', error: '导入文件中没有工作表' }

    const cleanHeader = s => String(s || '').replace(/[\s\u3000]+/g, '')
    const SPACED_CN_NAME = /^[\u4e00-\u9fa5](?:[\s\u3000]+[\u4e00-\u9fa5]){1,2}$/
    let headerRowIdx = null
    let nameCol = null
    let valueCol = null
    const limit = Math.min(ws.rowCount, 15)
    for (let r = 1; r <= limit; r++) {
      const row = ws.getRow(r)
      const cols = []
      row.eachCell((cell, c) => {
        const t = textOf(cell.value)
        if (t) cols.push({ t, c, clean: cleanHeader(t) })
      })
      const nc = cols.find(x => x.clean === '姓名')
      if (mode === 'count') {
        const vc = cols.find(x => x.clean === '总次数')
        if (nc && vc) { headerRowIdx = r; nameCol = nc.c; valueCol = vc.c; break }
      } else {
        const vcs = cols.filter(x => x.clean === '总积分')
        if (nc && vcs.length) {
          headerRowIdx = r; nameCol = nc.c
          valueCol = vcs[vcs.length - 1].c
          break
        }
      }
    }
    if (!headerRowIdx) {
      const need = mode === 'count' ? '姓名 / 总次数' : '姓名 / 总积分'
      return { ok: false, code: 'HEADER_MISMATCH', error: `未在导入文件中找到强制列名（${need}），请核对表格格式` }
    }

    const entries = []
    for (let r = headerRowIdx + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      let name = textOf(row.getCell(nameCol).value)
      if (!name || COHORT_RE.test(name)) continue
      if (SPACED_CN_NAME.test(name)) name = name.replace(/[\s\u3000]+/g, '')
      const count = numOr0(row.getCell(valueCol).value)
      entries.push({ name, count })
    }
    return { ok: true, data: { fileName: path.basename(filePath), entries } }
  } catch (e) {
    return { ok: false, code: e.code || 'EXTERNAL_READ_FAIL', error: `导入文件解析失败：${e.message}` }
  }
}

module.exports = {
  readWorkbook,
  createTemplate,
  commitEvent,
  applyIncrement,
  applyEventEdit,
  deleteActivityColumn,
  readExternal
}
