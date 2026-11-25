/* 服务层集成测试：node tests/services.test.cjs
 * 全部使用临时目录里的仿真表格，不接触任何真实积分表。 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const ExcelJS = require('exceljs')
const JSZip = require('jszip')

const excelService = require('../electron/services/excelService')
const { backupExcel } = require('../electron/services/backupService')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ghd-test-'))
const mainXlsx = path.join(tmp, '总积分.xlsx') // 旧式 6 列表（没有空白分隔列）
const realXlsx = path.join(tmp, '真实结构.xlsx') // 真实主表结构（空白第 7 列 + 只有格式的尾列）
const backupDir = path.join(tmp, '.backups')

const HEADERS = ['姓名', '夜训周训', '升降旗', '后勤部', '综办部', '汇总']

async function open (file) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  return wb.worksheets[0]
}

async function cell (file, r, c) {
  return (await open(file)).getRow(r).getCell(c).value
}

const snapshot = file => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex')
const backups = () => (fs.existsSync(backupDir) ? fs.readdirSync(backupDir).filter(f => f.endsWith('.xlsx')) : [])

// 旧式 6 列表：同名队员、负分、空行、空单元格、与明细对不上的汇总都有
async function makeMain () {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('总积分')
  ws.getRow(1).values = HEADERS
  ws.getRow(2).values = ['--31届--', null, null, null, null, 5] // 届别行：汇总列有值，用来验证"程序不动届别行"
  ws.getRow(3).values = ['张三', 1, 2, null, null, 3]
  ws.getRow(4).values = ['李四', null, null, null, null, null] // 空单元格
  ws.getRow(5).values = ['--30届--']
  ws.getRow(6).values = ['王五', 2, 1, 1, 1, 5]
  ws.getRow(7).values = ['张三', null, null, null, null, -2] // 同名 + 负分（且与明细不符）
  ws.getRow(8).values = [null, null, null, null, null, null] // 空行
  await wb.xlsx.writeFile(mainXlsx)
}

// 仿真实主表：A-F 固定列 | 第 7 列空白 | 第 8 列起活动列 | 末尾一个"只有格式没有内容"的单元格
async function makeReal () {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  ws.getRow(1).values = ['姓名', '夜训周训', '升降旗', '后勤', '综办', '汇总', null, '26.8月教官部加训\n（8次训练）', '国庆出旗', '校运会出旗']
  ws.getRow(1).height = 40
  ws.getColumn(7).width = 7.83
  ;[8, 9, 10].forEach((c, i) => { ws.getColumn(c).width = [12.68, 20.5, 24.71][i] })
  for (let c = 1; c <= 10; c++) ws.getRow(1).getCell(c).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  ws.getRow(2).values = ['--30届--', null, null, null, null, 0]
  ws.getRow(3).values = ['甲', 1, 1, 1, 1, 7, null, 2, 1]
  ws.getRow(4).values = ['--29届--', null, null, null, null, 0]
  ws.getRow(5).values = ['乙', 0.5, 0.5, null, null, 5, null, null, 1, 3]
  for (const r of [3, 5]) for (let c = 2; c <= 10; c++) ws.getRow(r).getCell(c).alignment = { horizontal: 'center' }
  ws.getCell('K3').font = { name: '等线', size: 11 } // 只有格式、没有内容（真实表第 15 列就是这种情况）
  await wb.xlsx.writeFile(realXlsx)
}

// 手工拼一个最小的 xlsx，用来复现 Excel 保存"共享公式"时的真实写法。
// 共享公式：第一格带公式文字和适用范围（t="shared" ref="B3:B4"），同一组的其余格子只带编号（si="0"）。
// 这是用 ExcelJS 的公开接口造不出来的文件，但对真实考勤表很常见，所以按 Excel 的原始格式直接写。
// 公式算出 0 的格子，文件里保存的是 <v>0</v>；"没有保存结果"的格子则根本没有 <v>。
// colsXml 是可选的列宽定义（<cols>…</cols>），同样按 Excel 的原始写法直接写。
async function writeRawXlsx (file, rowsXml, colsXml = '') {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`)
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`)
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${colsXml}<sheetData>${rowsXml.join('')}</sheetData></worksheet>`)
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }))
}

// 读出文件里某个单元格的原始 XML（用来确认公式和已保存的结果在写入后还在）
async function rawCell (file, addr) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file))
  const xml = await zip.file('xl/worksheets/sheet1.xml').async('string')
  const m = xml.match(new RegExp(`<c r="${addr}"[^>]*>([\\s\\S]*?)</c>`))
  return m ? m[1] : ''
}

// 读出文件里原始的列宽定义（<cols>…</cols>），用来确认列宽在写入后没有被弄丢
async function rawCols (file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file))
  const xml = await zip.file('xl/worksheets/sheet1.xml').async('string')
  return (xml.match(/<cols>[\s\S]*?<\/cols>/) || [''])[0]
}

const sCell = (addr, text) => `<c r="${addr}" t="inlineStr"><is><t>${text}</t></is></c>`
const nCell = (addr, v) => `<c r="${addr}"><v>${v}</v></c>`
const row = (r, ...cells) => `<row r="${r}">${cells.join('')}</row>`

;(async () => {
  let passed = 0
  const t = async (name, fn) => {
    try { await fn(); passed++; console.log(`  ✓ ${name}`) } catch (e) {
      console.error(`  ✗ ${name}\n    ${e.message}`)
      process.exitCode = 1
    }
  }

  await makeMain()
  await makeReal()
  console.log('临时目录:', tmp)

  // ---------- 新建模板 ----------
  await t('createTemplate 与真实主表一致（Sheet1、表头、空白第 7 列、届别行、冻结）', async () => {
    const p = path.join(tmp, '模板.xlsx')
    const r = await excelService.createTemplate(p)
    assert(r.ok, r.error)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(p)
    const ws = wb.worksheets[0]
    assert.strictEqual(ws.name, 'Sheet1')
    assert.deepStrictEqual([1, 2, 3, 4, 5, 6].map(c => ws.getRow(1).getCell(c).value), ['姓名', '夜训周训', '升降旗', '后勤', '综办', '汇总'])
    assert.strictEqual(ws.getRow(1).getCell(7).value, null, '第 7 列不应有文字')
    assert(ws.getRow(1).getCell(7).alignment, '第 7 列表头应带样式（与真实表一致）')
    assert.strictEqual(ws.getRow(1).height, 40)
    assert.strictEqual(ws.getRow(1).getCell(1).font.name, '等线')
    assert.strictEqual(ws.getColumn(7).width, 7.83)
    assert.deepStrictEqual(
      [2, 3, 4, 5, 6].map(r => [ws.getRow(r).getCell(1).value, ws.getRow(r).getCell(6).value]),
      [['--30届--', 0], ['--29届--', 0], ['--28届--', 0], ['--27届--', 0], ['--26届--', 0]]
    )
    assert.strictEqual(ws.getRow(2).height, 16)
    assert.strictEqual(ws.getRow(2).getCell(1).fill.fgColor.argb, 'FF00B0F0')
    assert.strictEqual(ws.views[0].state, 'frozen')
    assert.strictEqual(ws.views[0].xSplit, 1)
    assert.strictEqual(ws.views[0].ySplit, 1)

    const rd = await excelService.readWorkbook(p)
    assert(rd.ok, rd.error)
    assert.deepStrictEqual(rd.data.members, [])
    assert.deepStrictEqual(rd.data.activityColumns, [])
    assert.strictEqual(rd.data.lastCol, 6)
  })

  await t('createTemplate 目标目录不存在时返回带说明的错误', async () => {
    const r = await excelService.createTemplate(path.join(tmp, '不存在的目录', 'x.xlsx'))
    assert(!r.ok)
    assert(/模板创建失败/.test(r.error), r.error)
  })

  await t('模板上第一个活动列落在第 8 列，第 7 列保持空白', async () => {
    const p = path.join(tmp, '模板.xlsx')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(p)
    wb.worksheets[0].addRow(['甲'])
    await wb.xlsx.writeFile(p)

    const r = await excelService.commitEvent(p, { activityName: '测试活动', scores: { 甲: 2 } })
    assert(r.ok, r.error)
    assert.strictEqual(r.data.column, 8)
    const ws = await open(p)
    assert.strictEqual(ws.getRow(1).getCell(7).value, null)
    assert.strictEqual(ws.getRow(1).getCell(8).value, '测试活动')
    assert.strictEqual(ws.getRow(7).getCell(8).value, 2)
    assert.strictEqual(ws.getRow(7).getCell(6).value, 2)
  })

  // ---------- 读取 ----------
  await t('readWorkbook 解析届别/同名/空行', async () => {
    const r = await excelService.readWorkbook(mainXlsx)
    assert(r.ok, r.error)
    const d = r.data
    assert.strictEqual(d.members.length, 4)
    assert.deepStrictEqual(d.members.map(m => m.name), ['张三', '李四', '王五', '张三'])
    assert.deepStrictEqual(d.members.map(m => m.generation), [31, 31, 30, 30])
    assert.deepStrictEqual(d.duplicateNames, ['张三'])
    assert.strictEqual(d.members[1].f, null) // 李四 F 为空
    assert.strictEqual(d.members[3].f, -2)
    assert.deepStrictEqual(d.activityColumns, [])
    assert.strictEqual(d.lastCol, 6)
  })

  await t('真实表结构：空白第 7 列 + 只有格式的尾列，不误判最后一列', async () => {
    const ws = await open(realXlsx)
    assert(ws.actualColumnCount < 10, `夹具应能复现 actualColumnCount 少算的陷阱，实际 ${ws.actualColumnCount}`)
    const r = await excelService.readWorkbook(realXlsx)
    assert(r.ok, r.error)
    assert.strictEqual(r.data.lastCol, 10)
    assert.deepStrictEqual(
      r.data.activityColumns.map(x => [x.col, x.name]),
      [[8, '26.8月教官部加训\n（8次训练）'], [9, '国庆出旗'], [10, '校运会出旗']]
    )
    assert.deepStrictEqual(r.data.members.map(m => [m.name, m.generation, m.f]), [['甲', 30, 7], ['乙', 29, 5]])
    // 活动分按列号存：{ 8: 第一项活动, 9: 第二项, 10: 第三项 }
    assert.deepStrictEqual(r.data.members.map(m => m.extras), [{ 8: 2, 9: 1, 10: null }, { 8: null, 9: 1, 10: 3 }])
    assert.deepStrictEqual(r.data.duplicateColumns, [])
  })

  await t('两列活动重名：分数按列号分别读取、重名如实报告，按名字修改只改到排在前面的那一列', async () => {
    const p = path.join(tmp, '重名活动列.xlsx')
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('总积分')
    ws.getRow(1).values = [...HEADERS, null, '出旗', '出旗']
    ws.getRow(2).values = ['甲', 1, null, null, null, 6, null, 3, 2]
    await wb.xlsx.writeFile(p)
    const r = await excelService.readWorkbook(p)
    assert(r.ok, r.error)
    assert.deepStrictEqual(r.data.duplicateColumns, ['出旗'])
    assert.deepStrictEqual([r.data.members[0].extras[8], r.data.members[0].extras[9]], [3, 2])

    const e = await excelService.applyEventEdit(p, { activityName: '出旗', deltas: { 甲: 1 } })
    assert(e.ok, e.error)
    assert.strictEqual(e.data.column, 8)
    assert.strictEqual(await cell(p, 2, 8), 4)
    assert.strictEqual(await cell(p, 2, 9), 2)
    assert.strictEqual(await cell(p, 2, 6), 7) // 1 + 4 + 2（原来写的 6 与明细不符，被一并纠正）
  })

  // ---------- 活动结算 ----------
  let lastBackup = null
  await t('commitEvent：6 列表上新列落在第 8 列（第 7 列留空），F 列同步重算', async () => {
    const r = await excelService.commitEvent(mainXlsx, {
      activityName: '国庆出旗',
      scores: { 张三: 4.5, 李四: 3, 王五: 2 }
    })
    assert(r.ok, r.error)
    assert.strictEqual(r.data.column, 8)
    assert.strictEqual(await cell(mainXlsx, 1, 7), null)
    assert.strictEqual(await cell(mainXlsx, 1, 8), '国庆出旗')
    assert.strictEqual(await cell(mainXlsx, 3, 8), 4.5)
    assert.strictEqual(await cell(mainXlsx, 3, 6), 7.5) // 1 + 2 + 4.5
    assert.strictEqual(await cell(mainXlsx, 4, 6), 3) // 空 -> 0 + 3
    assert.strictEqual(await cell(mainXlsx, 6, 6), 7) // 5 + 2
    assert.strictEqual(await cell(mainXlsx, 7, 8), null) // 同名第二个张三不写入
    // 同名第二个张三的汇总原来是 -2，但明细全是空 -> 重算为 0，并被如实报告
    assert.deepStrictEqual(r.data.summaryFixed, [{ name: '张三', row: 7, from: -2, to: 0 }])
    assert.strictEqual(await cell(mainXlsx, 7, 6), 0)
    assert.deepStrictEqual(r.data.duplicateNames, ['张三'])
    // 届别行不参与重算
    assert.strictEqual(await cell(mainXlsx, 2, 6), 5)
    assert.strictEqual(await cell(mainXlsx, 5, 6), null)
    // 返回备份路径，供历史记录保存失败时回滚
    lastBackup = r.data.backup
    assert(lastBackup && fs.existsSync(lastBackup), '应返回备份路径')
    assert(path.dirname(lastBackup) === backupDir, '备份应位于 .backups 目录')

    const ws = await open(mainXlsx)
    assert.strictEqual(ws.getRow(1).getCell(8).alignment.wrapText, true)
    assert.strictEqual(ws.getRow(3).getCell(8).alignment.horizontal, 'center')
  })

  await t('commitEvent 同名活动列阻断', async () => {
    const r = await excelService.commitEvent(mainXlsx, { activityName: '国庆出旗', scores: { 张三: 1 } })
    assert(!r.ok && r.code === 'DUP_COLUMN', JSON.stringify(r))
  })

  await t('commitEvent 与固定表头重名也阻断', async () => {
    const r = await excelService.commitEvent(mainXlsx, { activityName: '汇总', scores: { 张三: 1 } })
    assert(!r.ok && r.code === 'DUP_COLUMN', JSON.stringify(r))
  })

  await t('校验不通过时：不改表格、不留备份', async () => {
    const before = snapshot(mainXlsx)
    const n = backups().length

    const empty = await excelService.commitEvent(mainXlsx, { activityName: '空活动', scores: { 张三: 0 } })
    assert(!empty.ok && empty.code === 'EMPTY_ACTIVITY', JSON.stringify(empty))

    const missing = await excelService.commitEvent(mainXlsx, { activityName: '有人不存在', scores: { 不存在的人: 1 } })
    assert(!missing.ok && missing.code === 'MEMBER_MISSING', JSON.stringify(missing))
    assert.deepStrictEqual(missing.data.missing, ['不存在的人'])

    const blank = await excelService.commitEvent(mainXlsx, { activityName: '   ', scores: { 张三: 1 } })
    assert(!blank.ok && blank.code === 'BAD_NAME', JSON.stringify(blank))

    const noCol = await excelService.deleteActivityColumn(mainXlsx, { activityName: '没有这个活动' })
    assert(!noCol.ok && noCol.code === 'COL_NOT_FOUND', JSON.stringify(noCol))

    const badCol = await excelService.applyIncrement(mainXlsx, { targetCol: 6, deltas: { 张三: 1 } })
    assert(!badCol.ok && badCol.code === 'BAD_TARGET_COL', JSON.stringify(badCol))

    assert.strictEqual(snapshot(mainXlsx), before, '表格不应被改动')
    assert.strictEqual(backups().length, n, '不应产生新备份')
    assert.strictEqual(await cell(mainXlsx, 1, 9), null)
  })

  // ---------- 增量 / 修改 ----------
  await t('applyIncrement C 列累加 + F 列重算', async () => {
    const r = await excelService.applyIncrement(mainXlsx, { targetCol: 3, deltas: { 张三: 1.5, 王五: 0.5 } })
    assert(r.ok, r.error)
    assert.strictEqual(await cell(mainXlsx, 3, 3), 3.5)
    assert.strictEqual(await cell(mainXlsx, 3, 6), 9) // 1 + 3.5 + 4.5
    assert.strictEqual(await cell(mainXlsx, 6, 3), 1.5)
    assert.strictEqual(await cell(mainXlsx, 6, 6), 7.5) // 2 + 1.5 + 1 + 1 + 2
    assert.deepStrictEqual(r.data.summaryFixed, [])
    assert.strictEqual(r.data.targetCol, 3)
  })

  await t('applyIncrement 只允许 B/C/D/E 四列', async () => {
    for (const targetCol of [1, 6, 7, 8, 99, 'x', undefined]) {
      const r = await excelService.applyIncrement(mainXlsx, { targetCol, deltas: { 张三: 1 } })
      assert(!r.ok && r.code === 'BAD_TARGET_COL', `第 ${targetCol} 列应被拒绝：${JSON.stringify(r)}`)
    }
    for (const targetCol of [2, 3, 4, 5]) {
      const r = await excelService.applyIncrement(mainXlsx, { targetCol, deltas: {} })
      assert(!r.ok && r.code === 'EMPTY_DELTAS', JSON.stringify(r))
    }
    const ok = await excelService.applyIncrement(mainXlsx, { targetCol: 2, deltas: { 李四: 1 } })
    assert(ok.ok, ok.error)
    assert.strictEqual(await cell(mainXlsx, 4, 2), 1)
    assert.strictEqual(await cell(mainXlsx, 4, 6), 4)
  })

  await t('applyEventEdit 差值写入活动列与 F', async () => {
    const r = await excelService.applyEventEdit(mainXlsx, { activityName: '国庆出旗', deltas: { 张三: -1.5, 王五: 1 } })
    assert(r.ok, r.error)
    assert.strictEqual(r.data.column, 8)
    assert.strictEqual(await cell(mainXlsx, 3, 8), 3)
    assert.strictEqual(await cell(mainXlsx, 3, 6), 7.5) // 9 - 1.5
    assert.strictEqual(await cell(mainXlsx, 6, 8), 3)
    assert.strictEqual(await cell(mainXlsx, 6, 6), 8.5) // 7.5 + 1
  })

  await t('每次写入都重算全部队员的汇总：与明细不符的旧汇总被纠正并报告', async () => {
    // 人为把李四的汇总改成 100（明细合计应为 4）
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(mainXlsx)
    wb.worksheets[0].getRow(4).getCell(6).value = 100
    await wb.xlsx.writeFile(mainXlsx)

    // 这次写入只动了王五的后勤分，但李四的汇总也会被一并纠正
    const r = await excelService.applyIncrement(mainXlsx, { targetCol: 4, deltas: { 王五: 1 } })
    assert(r.ok, r.error)
    assert.strictEqual(await cell(mainXlsx, 6, 6), 9.5) // 8.5 + 1
    assert.strictEqual(await cell(mainXlsx, 4, 6), 4)
    assert.deepStrictEqual(r.data.summaryFixed, [{ name: '李四', row: 4, from: 100, to: 4 }])
  })

  await t('deleteActivityColumn 物理删列 + F 列重算', async () => {
    const r = await excelService.deleteActivityColumn(mainXlsx, { activityName: '国庆出旗' })
    assert(r.ok, r.error)
    const ws = await open(mainXlsx)
    assert.strictEqual(ws.getRow(1).getCell(8).value, null)
    assert.strictEqual(ws.getRow(1).getCell(7).value, null)
    assert.strictEqual(ws.getRow(3).getCell(6).value, 4.5) // 1 + 3.5
    assert.strictEqual(ws.getRow(4).getCell(6).value, 1) // 只剩 B 的 1
    assert.strictEqual(ws.getRow(6).getCell(6).value, 6.5) // 2 + 1.5 + 2 + 1
    assert.strictEqual(ws.getRow(2).getCell(6).value, 5) // 届别行原样保留
    assert.strictEqual(ws.getRow(5).getCell(6).value, null)

    const again = await excelService.applyEventEdit(mainXlsx, { activityName: '国庆出旗', deltas: { 张三: 1 } })
    assert(!again.ok && again.code === 'COL_NOT_FOUND', JSON.stringify(again))
  })

  await t('浮点误差：0.1 + 0.2 + 0.3 的汇总写成 0.6', async () => {
    const p = path.join(tmp, '浮点.xlsx')
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('总积分')
    ws.getRow(1).values = HEADERS
    ws.getRow(2).values = ['甲', 0.1, 0.2]
    await wb.xlsx.writeFile(p)
    const r = await excelService.commitEvent(p, { activityName: '测试活动', scores: { 甲: 0.3 } })
    assert(r.ok, r.error)
    assert.strictEqual(await cell(p, 2, 6), 0.6)
    // 原来明细有分而汇总格是空的：属于"与明细不符"，会被补上并报告（from 为 null 表示原来是空的）
    assert.deepStrictEqual(r.data.summaryFixed, [{ name: '甲', row: 2, from: null, to: 0.6 }])
  })

  await t('同一秒内的多次备份不会互相覆盖', async () => {
    const p = path.join(tmp, '备份防覆盖.xlsx')
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('x')
    ws.getCell('A1').value = 1
    await wb.xlsx.writeFile(p)
    const first = backupExcel(p)
    ws.getCell('A1').value = 2
    await wb.xlsx.writeFile(p)
    const second = backupExcel(p)
    assert.notStrictEqual(first, second, '两份备份的文件名不应相同')
    assert.strictEqual((await open(first)).getCell('A1').value, 1)
    assert.strictEqual((await open(second)).getCell('A1').value, 2)
  })

  // ---------- 真实表结构上的写入 ----------
  await t('新活动列接在最后一个有内容的列之后，不覆盖最后一列旧数据', async () => {
    const r = await excelService.commitEvent(realXlsx, { activityName: '新生开学典礼出旗', scores: { 甲: 1, 乙: 1 } })
    assert(r.ok, r.error)
    assert.strictEqual(r.data.column, 11)
    assert.strictEqual(await cell(realXlsx, 1, 10), '校运会出旗') // 原最后一列完好
    assert.strictEqual(await cell(realXlsx, 5, 10), 3)
    assert.strictEqual(await cell(realXlsx, 1, 11), '新生开学典礼出旗')
    assert.strictEqual(await cell(realXlsx, 3, 11), 1)
    assert.strictEqual(await cell(realXlsx, 3, 6), 8)
    assert.strictEqual(await cell(realXlsx, 5, 6), 6)
    assert.deepStrictEqual(r.data.summaryFixed, [])

    const ws = await open(realXlsx)
    assert.strictEqual(ws.getRow(1).getCell(11).alignment.wrapText, true, '新表头沿用活动列表头样式')
    assert.strictEqual(ws.getRow(1).getCell(11).alignment.horizontal, 'center')
    assert.strictEqual(ws.getRow(3).getCell(11).alignment.horizontal, 'center', '新数据格沿用活动列样式')
    const w = ws.getColumn(11).width
    assert(w >= 10 && w <= 40, `列宽应在 10~40 之间，实际 ${w}`)
  })

  await t('最后一列活动可以修改；删除中间活动列后右侧各列整体左移', async () => {
    const edit = await excelService.applyEventEdit(realXlsx, { activityName: '校运会出旗', deltas: { 乙: -3 } })
    assert(edit.ok, edit.error)
    assert.strictEqual(edit.data.column, 10)
    // 3 - 3 = 0：写成空白，而不是留下一个 0
    assert.strictEqual(await cell(realXlsx, 5, 10), null)
    assert.strictEqual(await cell(realXlsx, 5, 6), 3) // 0.5 + 0.5 + 1 + 0 + 1

    const del = await excelService.deleteActivityColumn(realXlsx, { activityName: '国庆出旗' })
    assert(del.ok, del.error)
    const ws = await open(realXlsx)
    assert.strictEqual(ws.getRow(1).getCell(7).value, null)
    assert.strictEqual(ws.getRow(1).getCell(8).value, '26.8月教官部加训\n（8次训练）')
    assert.strictEqual(ws.getRow(1).getCell(9).value, '校运会出旗')
    assert.strictEqual(ws.getRow(1).getCell(10).value, '新生开学典礼出旗')
    assert.strictEqual(ws.getRow(1).getCell(11).value, null)
    assert.strictEqual(ws.getColumn(9).width, 24.71, '列宽应随列一起移动')
    assert.strictEqual(ws.getRow(3).getCell(6).value, 7) // 4 + 2 + 0 + 1
    assert.strictEqual(ws.getRow(5).getCell(6).value, 2) // 1 + 0 + 0 + 1
  })

  await t('新列的样式只落到新列：表里与它同款式的其他单元格不会被连带改掉', async () => {
    const file = path.join(tmp, '共用样式.xlsx')
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Sheet1')
    ws.getRow(1).values = ['姓名', '夜训周训', '升降旗', '后勤', '综办', '汇总', null, '出旗一', '出旗二', '出旗三']
    ws.getRow(2).values = ['甲', 1, null, null, null, 3, null, 2, null, null]
    ws.getRow(3).values = ['乙', 1, null, null, null, 1]
    for (let c = 8; c <= 10; c++) ws.getRow(1).getCell(c).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    // 第 10 列的数据格、以及第 11 列（新活动列会落在这里）的格子：只有格式没有内容，款式完全相同。
    // ExcelJS 读入文件后，这些格子共用同一个样式对象——真实主表的活动区正是这种情况
    for (const addr of ['J2', 'J3', 'K1', 'K2', 'K3']) ws.getCell(addr).alignment = { horizontal: 'center' }
    await wb.xlsx.writeFile(file)

    const res = await excelService.commitEvent(file, { activityName: '元旦出旗', scores: { 甲: 1 } })
    assert(res.ok, JSON.stringify(res))
    assert.strictEqual(res.data.column, 11)

    const ws2 = await open(file)
    const align = addr => JSON.stringify(ws2.getCell(addr).alignment)
    for (const addr of ['J2', 'J3', 'K3']) {
      assert.strictEqual(align(addr), '{"horizontal":"center"}', `${addr} 不是新列里被打分的格子，样式不应被改动`)
    }
    assert.strictEqual(align('K1'), '{"horizontal":"center","vertical":"middle","wrapText":true}', '新列表头应照参照列表头（居中 + 换行）')
    assert.strictEqual(align('K2'), '{"horizontal":"center"}', '新列数据格的对齐方式照参照列')
    assert.strictEqual(ws2.getCell('K2').value, 1)
  })

  await t('没有表头的列（分隔列、表头被删的列）里填了数字也不计入汇总，和榜单显示的口径一致', async () => {
    const file = path.join(tmp, '无表头数字.xlsx')
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Sheet1')
    ws.getRow(1).values = ['姓名', '夜训周训', '升降旗', '后勤', '综办', '汇总', null, '出旗']
    ws.getRow(2).values = ['甲', 1, null, null, null, 999, null, 2]
    ws.getRow(2).getCell(7).value = 100 // 空白分隔列里误填的数字
    ws.getRow(2).getCell(10).value = 100 // 有数字、没有表头的列
    await wb.xlsx.writeFile(file)

    const read = await excelService.readWorkbook(file)
    assert.deepStrictEqual(read.data.activityColumns.map(c => c.name), ['出旗'], '没有表头的列不算活动列')

    const res = await excelService.applyIncrement(file, { targetCol: 2, deltas: { 甲: 1 } })
    assert(res.ok, JSON.stringify(res))
    assert.strictEqual(await cell(file, 2, 6), 4, '汇总 = 夜训周训 2 + 出旗 2，两个 100 都不算')
    assert.deepStrictEqual(res.data.summaryFixed, [{ name: '甲', row: 2, from: 999, to: 4 }])
    assert.strictEqual(await cell(file, 2, 7), 100, '分隔列里的数字原样保留，程序不去动它')
  })

  // ---------- 写回时的保真：列宽、空白格子、撤销新建 ----------
  await t('列宽正好是 9 的列（真实主表的姓名、夜训周训两列）：写回后列宽定义不丢失', async () => {
    const p = path.join(tmp, '列宽9.xlsx')
    await writeRawXlsx(p, [
      row(1, ...HEADERS.map((h, i) => sCell(`${'ABCDEF'[i]}1`, h))),
      row(2, sCell('A2', '甲'), nCell('B2', 1), nCell('F2', 1))
    ], '<cols><col min="1" max="2" width="9" customWidth="1"/><col min="3" max="6" width="8.88333333333333" customWidth="1"/></cols>')
    const r = await excelService.applyIncrement(p, { targetCol: 2, deltas: { 甲: 1 } })
    assert(r.ok, r.error)
    assert.strictEqual(await cell(p, 2, 2), 2)
    const cols = await rawCols(p)
    assert(/<col min="1" max="2" width="9" customWidth="1"\/>/.test(cols), `A、B 两列的列宽定义应原样保留，实际：${cols}`)
    assert(/<col min="3" max="6" width="8\.88333333333333" customWidth="1"\/>/.test(cols), `C~F 列的列宽定义应原样保留，实际：${cols}`)
  })

  await t('按模板新建的空白表：列宽（含正好是 9 的 A、B 两列）写进了文件', async () => {
    const p = path.join(tmp, '模板列宽.xlsx')
    const r = await excelService.createTemplate(p)
    assert(r.ok, r.error)
    const cols = await rawCols(p)
    assert(/<col min="1" max="1" width="9"[^>]*customWidth="1"\/>/.test(cols), `模板的 A 列列宽应为 9，实际：${cols}`)
    assert(/<col min="2" max="2" width="9" customWidth="1"\/>/.test(cols), `模板的 B 列列宽应为 9（没有补丁时这一列会被丢掉），实际：${cols}`)
    assert(/<col min="3" max="6" width="8\.88" customWidth="1"\/>/.test(cols), `模板的 C~F 列列宽应为 8.88，实际：${cols}`)
    assert(/<col min="7" max="7" width="7\.83" customWidth="1"\/>/.test(cols), `模板第 7 列列宽应为 7.83，实际：${cols}`)
  })

  await t('原来是空白的格子：加分后再撤销，恢复成空白而不是留下一个 0', async () => {
    const p = path.join(tmp, '撤销留零.xlsx')
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('总积分')
    ws.getRow(1).values = HEADERS
    ws.getRow(2).values = ['甲', 1, null, null, null, 1]
    ws.getRow(3).values = ['乙', null, null, null, null, null]
    ws.getRow(3).getCell(2).alignment = { horizontal: 'center' } // 空格子带着格式
    await wb.xlsx.writeFile(p)

    const create = await excelService.commitEvent(p, { activityName: '出旗', scores: { 甲: 2 } })
    assert(create.ok, create.error)
    const add = await excelService.applyEventEdit(p, { activityName: '出旗', deltas: { 乙: 1.5 } })
    assert(add.ok, add.error)
    assert.strictEqual(await cell(p, 3, 8), 1.5)
    assert.strictEqual(await cell(p, 3, 6), 1.5)

    const undo = await excelService.applyEventEdit(p, { activityName: '出旗', deltas: { 乙: -1.5 } })
    assert(undo.ok, undo.error)
    assert.strictEqual(await cell(p, 3, 8), null, '活动列里原来是空白，撤销后应恢复为空白')
    assert.deepStrictEqual(undo.data.summaryFixed, [], '撤销带来的汇总变化是预期内的，不应被报告')

    // B~E 四列同理
    const add2 = await excelService.applyIncrement(p, { targetCol: 4, deltas: { 乙: 2 } })
    assert(add2.ok, add2.error)
    assert.strictEqual(await cell(p, 3, 4), 2)
    const undo2 = await excelService.applyIncrement(p, { targetCol: 4, deltas: { 乙: -2 } })
    assert(undo2.ok, undo2.error)
    assert.strictEqual(await cell(p, 3, 4), null, '原来是空白的后勤格，撤销后应恢复为空白')
    assert.strictEqual(await cell(p, 3, 6), 0, '汇总格始终是数字：按明细重算为 0')

    // 原来就有分数的格子被减到 0：同样写成空白，和表里其他"没有分数"的格子保持一致
    const zero = await excelService.applyIncrement(p, { targetCol: 2, deltas: { 甲: -1 } })
    assert(zero.ok, zero.error)
    assert.strictEqual(await cell(p, 2, 2), null)
    assert.strictEqual(await cell(p, 2, 6), 2, '汇总格：出旗 2 + 后勤 0')
  })

  await t('撤销"新建活动"后，这一列恢复成新建前的样子（列宽 + 原有的格式格子）', async () => {
    const p = path.join(tmp, '撤销新建恢复原样.xlsx')
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Sheet1')
    ws.getRow(1).values = ['姓名', '夜训周训', '升降旗', '后勤', '综办', '汇总', null, '国庆出旗']
    ws.getRow(2).values = ['甲', 1, 1, null, null, 3, null, 1]
    ws.getRow(4).values = ['--29届--', null, null, null, null, 0] // 这一行的右侧没有任何格式
    ws.getColumn(8).width = 12.68
    ws.getColumn(9).width = 18.475 // 下一列已经设好了列宽
    for (const addr of ['I1', 'I2', 'I3']) { // 以及只有格式、没有内容的格子
      ws.getCell(addr).border = { top: { style: 'thin' }, bottom: { style: 'thin' } }
    }
    await wb.xlsx.writeFile(p)
    const before = await open(p)
    const originalStyle = JSON.stringify(before.getCell('I2').style)
    const originalWidth = before.getColumn(9).width

    const create = await excelService.commitEvent(p, { activityName: '元旦出旗', scores: { 甲: 2 } })
    assert(create.ok, create.error)
    assert.strictEqual(create.data.column, 9)
    const skeleton = create.data.prevColumn
    assert(skeleton, '新列占用的这一列新建前带有列宽和格式，应被记录下来')
    assert.strictEqual(skeleton.width, originalWidth)
    assert.deepStrictEqual(skeleton.cells.map(c => c[0]), [1, 2, 3])
    assert.strictEqual(JSON.stringify(skeleton.cells[1][1]), originalStyle, '记下的应是格子原来的样式')

    // 界面把 prevColumn 存进项目配置再带回来，中间会经过一次 JSON 序列化
    const undo = await excelService.deleteActivityColumn(p, { activityName: '元旦出旗', prevColumn: JSON.parse(JSON.stringify(skeleton)) })
    assert(undo.ok, undo.error)
    assert.deepStrictEqual(undo.data.summaryFixed, [], '撤销新建带来的汇总变化是预期内的，不应被报告成"原汇总与明细对不上"')
    const after = await open(p)
    assert.strictEqual(after.getRow(1).getCell(8).value, '国庆出旗')
    assert.strictEqual(after.getRow(1).getCell(9).value, null)
    assert.strictEqual(after.getCell('I2').value, null)
    assert.strictEqual(JSON.stringify(after.getCell('I2').style), originalStyle, '这一列原有的格式应恢复')
    assert.strictEqual(after.getColumn(9).width, originalWidth, '这一列原有的列宽应恢复')
    assert.strictEqual(after.getCell('F2').value, 3)
    assert.strictEqual(after.findRow(4).findCell(9), undefined, '新建前没有格式的行不应凭空多出格子')

    // 历史记录里的 prevColumn 被改坏时：撤销照常进行，不恢复也不崩溃
    const again = await excelService.commitEvent(p, { activityName: '元旦出旗', scores: { 甲: 2 } })
    assert(again.ok, again.error)
    const broken = await excelService.deleteActivityColumn(p, {
      activityName: '元旦出旗',
      prevColumn: { width: 'abc', cells: [['x', {}], [0, {}], [2, 'bad'], [2, null], null] }
    })
    assert(broken.ok, broken.error)
    assert.strictEqual(await cell(p, 2, 6), 3)
    assert.deepStrictEqual((await open(p)).getCell('I2').style, {}, '不合法的条目不应被应用')
  })

  // ---------- 回滚 ----------
  await t('restoreBackup 把备份恢复为主表', async () => {
    assert(lastBackup, '前面应有备份路径')
    fs.writeFileSync(mainXlsx, 'garbage')
    const r = await excelService.restoreBackup(mainXlsx, lastBackup)
    assert(r.ok, r.error)
    assert.strictEqual(snapshot(mainXlsx), snapshot(lastBackup))
    // 备份是"写入前"的快照：应回到第一次活动结算之前的状态
    assert.strictEqual(await cell(mainXlsx, 1, 8), null)
    assert.strictEqual(await cell(mainXlsx, 3, 6), 3)
    assert.strictEqual(await cell(mainXlsx, 7, 6), -2)
  })

  await t('restoreBackup 只接受 .backups 目录里的 xlsx', async () => {
    const bad = [
      path.join(tmp, '总积分.xlsx'), // 表格自身
      path.join(backupDir, '说明.txt'), // 非 xlsx
      path.join(backupDir, '..', '总积分.xlsx'), // 用 .. 逃出备份目录
      path.join(backupDir, '不存在.xlsx')
    ]
    const codes = []
    for (const p of bad) {
      const r = await excelService.restoreBackup(mainXlsx, p)
      assert(!r.ok, `不应接受：${p}`)
      codes.push(r.code)
    }
    assert.deepStrictEqual(codes, ['BAD_BACKUP', 'BAD_BACKUP', 'BAD_BACKUP', 'NOT_FOUND'])
  })

  // ---------- 导入表 ----------
  await t('readExternal count 模式（严格 姓名/总次数 + 空值清洗）', async () => {
    const p = path.join(tmp, '升降旗考勤.xlsx')
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('考勤')
    ws.getRow(1).values = ['序号', '姓名', '总次数']
    ws.getRow(2).values = [1, '张三', 3]
    ws.getRow(3).values = [2, null, 5] // 姓名为空 -> 过滤
    ws.getRow(4).values = [3, '李四', null] // 总次数空 -> 0
    ws.getRow(5).values = [4, '王五', 2]
    await wb.xlsx.writeFile(p)
    const r = await excelService.readExternal(p, 'count')
    assert(r.ok, r.error)
    assert.deepStrictEqual(r.data.entries, [
      { name: '张三', count: 3 },
      { name: '李四', count: 0 },
      { name: '王五', count: 2 }
    ])
  })

  await t('readExternal sandwich 模式（中间列自适应忽略，取最后一个"总积分"）', async () => {
    const p = path.join(tmp, '后勤统计.xlsx')
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('后勤')
    ws.getRow(1).values = ['姓名', '1月', '2月', '扣分', '总积分']
    ws.getRow(2).values = ['张三', 1, 2, -1, 2]
    ws.getRow(3).values = ['王五', 3, 1, 0, 4]
    ws.getRow(4).values = [null, 9, 9, 9, 9]
    await wb.xlsx.writeFile(p)
    const r = await excelService.readExternal(p, 'sandwich')
    assert(r.ok, r.error)
    assert.deepStrictEqual(r.data.entries, [
      { name: '张三', count: 2 },
      { name: '王五', count: 4 }
    ])
  })

  await t('readExternal 列名不匹配时报错', async () => {
    const p = path.join(tmp, 'bad.xlsx')
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('x')
    ws.getRow(1).values = ['名字', '次数']
    ws.getRow(2).values = ['张三', 3]
    await wb.xlsx.writeFile(p)
    const r = await excelService.readExternal(p, 'count')
    assert(!r.ok && r.code === 'HEADER_MISMATCH', JSON.stringify(r))
  })

  await t('readExternal：表头里的排版空格、换行不影响识别；带排版空格的姓名合并成一个名字', async () => {
    const p = path.join(tmp, '排版空格.xlsx')
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('考勤')
    ws.addRow(['序号', '姓 名', '总\n次数']) // 表头为了对齐加了空格、换了行
    ws.addRow([1, '张 三', 3]) // 两字名中间加空格（为了和三字名对齐）
    ws.addRow([2, '阿 不 都 热　合 曼', 2]) // 更长的名字；中间还混了一个全角空格
    ws.addRow([3, '艾克拜尔·司马义', 1]) // 带间隔号的姓名原样保留
    ws.addRow([4, '张三 李四', 5]) // 一格里塞了两个名字：没法确定该在哪里断开，原样交给界面提示
    await wb.xlsx.writeFile(p)
    const r = await excelService.readExternal(p, 'count')
    assert(r.ok, r.error)
    assert.deepStrictEqual(r.data.entries, [
      { name: '张三', count: 3 },
      { name: '阿不都热合曼', count: 2 },
      { name: '艾克拜尔·司马义', count: 1 },
      { name: '张三 李四', count: 5 }
    ])
    assert.strictEqual(r.data.sheetName, '考勤')
    assert.strictEqual(r.data.sheetCount, 1)
  })

  await t('readExternal：第一个工作表没有表头时接着往后找（封面、说明页排在前面也不怕）', async () => {
    const p = path.join(tmp, '多工作表-考勤.xlsx')
    const wb = new ExcelJS.Workbook()
    wb.addWorksheet('封面').getCell('A1').value = '2026 秋季学期升旗次数统计表'
    const note = wb.addWorksheet('说明')
    note.addRow(['这份表由值班系统导出'])
    note.addRow(['姓名一栏请勿修改']) // 只是像"姓名"，不是表头
    const data = wb.addWorksheet('导出数据')
    data.addRow(['姓名', '总次数'])
    data.addRow(['张三', 4])
    wb.addWorksheet('空表')
    await wb.xlsx.writeFile(p)
    const r = await excelService.readExternal(p, 'count')
    assert(r.ok, r.error)
    assert.deepStrictEqual(r.data.entries, [{ name: '张三', count: 4 }])
    assert.strictEqual(r.data.sheetName, '导出数据')
    assert.strictEqual(r.data.sheetCount, 4)

    // 部门积分（sandwich 模式）同理
    const p2 = path.join(tmp, '多工作表-部门.xlsx')
    const wb2 = new ExcelJS.Workbook()
    wb2.addWorksheet('封面').addRow(['后勤部十月工作统计'])
    const data2 = wb2.addWorksheet('统计')
    data2.addRow(['姓 名', '序号', '备注', '总 积分'])
    data2.addRow(['张三', 7, '搬桌椅', 1.5])
    data2.addRow(['王五', 1, '采购', 2])
    await wb2.xlsx.writeFile(p2)
    const r2 = await excelService.readExternal(p2, 'sandwich')
    assert(r2.ok, r2.error)
    assert.deepStrictEqual(r2.data.entries, [{ name: '张三', count: 1.5 }, { name: '王五', count: 2 }])
    assert.strictEqual(r2.data.sheetName, '统计')
  })

  await t('readExternal：每个工作表都没有所需表头时，报错并说明已经逐个查看过', async () => {
    const p = path.join(tmp, '都没有表头.xlsx')
    const wb = new ExcelJS.Workbook()
    wb.addWorksheet('一').addRow(['名字', '次数'])
    wb.addWorksheet('二').addRow(['姓名', '合计'])
    await wb.xlsx.writeFile(p)
    const r = await excelService.readExternal(p, 'count')
    assert(!r.ok && r.code === 'HEADER_MISMATCH', JSON.stringify(r))
    assert(/每个工作表/.test(r.error), r.error)

    const empty = path.join(tmp, '没有工作表.xlsx')
    await new ExcelJS.Workbook().xlsx.writeFile(empty)
    const r2 = await excelService.readExternal(empty, 'count')
    assert(!r2.ok && r2.code === 'EMPTY', JSON.stringify(r2))
  })

  await t('届别行：中文破折号、长短不一的横线、「第」字、多余空白都能认出来', async () => {
    const p = path.join(tmp, '各种届别写法.xlsx')
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Sheet1')
    ws.getRow(1).values = HEADERS
    ws.getRow(2).values = ['——31届——', null, null, null, null, 9] // 中文破折号
    ws.getRow(3).values = ['张三', 1, 1, null, null, 2]
    ws.getRow(4).values = ['—–30届-—'] // 两种横线混着用
    ws.getRow(5).values = ['李四', 2, null, null, null, 2]
    ws.getRow(6).values = [' --- 第 29 届 --- ', null, null, null, null, 0] // 多个减号 + "第"字 + 两端空白
    ws.getRow(7).values = ['王五', null, 3, null, null, 3]
    ws.getRow(8).values = ['王五届', null, null, null, null, 0] // 名字最后一个字是"届"，但两端没有横线：是队员
    await wb.xlsx.writeFile(p)
    const r = await excelService.readWorkbook(p)
    assert(r.ok, r.error)
    assert.deepStrictEqual(
      r.data.members.map(m => [m.name, m.generation]),
      [['张三', 31], ['李四', 30], ['王五', 29], ['王五届', 29]],
      '届别行不能被当成队员；它后面的人要归到它的届'
    )
    // 写入时同样不会把这些届别行当成队员
    const w = await excelService.applyIncrement(p, { targetCol: 2, deltas: { 张三: 1, 王五届: 1 } })
    assert(w.ok, w.error)
    assert.strictEqual(await cell(p, 2, 6), 9, '届别行原样不动')
    assert.strictEqual(await cell(p, 3, 6), 3, '张三：夜训 2 + 升降旗 1')
    assert.strictEqual(await cell(p, 8, 6), 1, '王五届：夜训 1')

    // 导入表里的届别行（同样的各种写法）也要跳过
    const ext = path.join(tmp, '带届别行的导入表.xlsx')
    const wb2 = new ExcelJS.Workbook()
    const ws2 = wb2.addWorksheet('考勤')
    ws2.addRow(['姓名', '总次数'])
    ws2.addRow(['——30届——', 99])
    ws2.addRow(['张三', 3])
    ws2.addRow(['-- 第 29 届 --', 88])
    ws2.addRow(['李四', 1])
    await wb2.xlsx.writeFile(ext)
    const e = await excelService.readExternal(ext, 'count')
    assert(e.ok, e.error)
    assert.deepStrictEqual(e.data.entries, [{ name: '张三', count: 3 }, { name: '李四', count: 1 }])
  })

  await t('导入表的数值列是"没有计算结果的公式"时拒绝导入，而不是按 0 算', async () => {
    const p = path.join(tmp, '公式导入.xlsx')
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('x')
    ws.getRow(1).values = ['姓名', '总积分']
    ws.getRow(2).values = ['甲', 3]
    ws.getRow(3).getCell(1).value = '乙'
    ws.getRow(3).getCell(2).value = { formula: 'SUM(1+1)' } // 没有 result
    await wb.xlsx.writeFile(p)
    const r = await excelService.readExternal(p, 'sandwich')
    assert(!r.ok && r.code === 'FORMULA_NO_RESULT', JSON.stringify(r))
    assert(/保存一次/.test(r.error), r.error)
  })

  await t('主表里有"没有计算结果的公式"时照常写入，但如实报告（该格按 0 计入汇总）', async () => {
    const p = path.join(tmp, '公式主表.xlsx')
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('总积分')
    ws.getRow(1).values = HEADERS
    ws.getRow(2).getCell(1).value = '甲'
    ws.getRow(2).getCell(2).value = { formula: '1+1' } // 没有 result
    ws.getRow(2).getCell(3).value = 1
    await wb.xlsx.writeFile(p)
    const r = await excelService.applyIncrement(p, { targetCol: 3, deltas: { 甲: 1 } })
    assert(r.ok, r.error)
    assert.strictEqual(r.data.uncalculatedFormulas, 1)
    assert.strictEqual(await cell(p, 2, 6), 2)
  })

  // 考勤表头部 + 前四行：普通公式（结果 7）、共享公式第一格（结果 0）、共享公式其余格（结果 3、结果 0）
  const DAILY_HEAD = [
    row(1, sCell('A1', '姓名'), sCell('B1', '第一周'), sCell('C1', '第二周'), sCell('D1', '总次数')),
    row(2, sCell('A2', '甲'), nCell('B2', 3), nCell('C2', 4), '<c r="D2"><f>SUM(B2:C2)</f><v>7</v></c>'),
    row(3, sCell('A3', '乙'), nCell('B3', 0), nCell('C3', 0), '<c r="D3"><f t="shared" ref="D3:D5" si="0">SUM(B3:C3)</f><v>0</v></c>'),
    row(4, sCell('A4', '丙'), nCell('B4', 2), nCell('C4', 1), '<c r="D4"><f t="shared" si="0"/><v>3</v></c>'),
    row(5, sCell('A5', '丁'), nCell('B5', 0), nCell('C5', 0), '<c r="D5"><f t="shared" si="0"/><v>0</v></c>')
  ]

  await t('导入表里"公式算出 0"的格子按 0 读取，不误判成没有计算结果（真实日常训练表的结构）', async () => {
    const p = path.join(tmp, '共享公式导入.xlsx')
    await writeRawXlsx(p, DAILY_HEAD)
    const r = await excelService.readExternal(p, 'count')
    assert(r.ok, r.error)
    assert.deepStrictEqual(r.data.entries, [
      { name: '甲', count: 7 },
      { name: '乙', count: 0 },
      { name: '丙', count: 3 },
      { name: '丁', count: 0 }
    ])
  })

  await t('导入表里真正没有计算结果 / 结果是错误值的公式仍然拒绝，且只数这两类', async () => {
    const p = path.join(tmp, '无结果公式导入.xlsx')
    await writeRawXlsx(p, [
      ...DAILY_HEAD,
      row(6, sCell('A6', '戊'), '<c r="D6"><f>SUM(B6:C6)</f></c>'), // 没有 <v>
      row(7, sCell('A7', '己'), '<c r="D7" t="e"><f>1/0</f><v>#DIV/0!</v></c>')
    ])
    const r = await excelService.readExternal(p, 'count')
    assert(!r.ok && r.code === 'FORMULA_NO_RESULT', JSON.stringify(r))
    assert.strictEqual(r.data.uncalculated, 2, '只应数"戊、己"两格，不能把结果为 0 的乙、丁算进去')
    assert(/有 2 个/.test(r.error), r.error)
  })

  await t('主表里的公式（含结果为 0 的共享公式）：读得出数值，写入后公式和已保存结果都原样保留', async () => {
    const p = path.join(tmp, '公式保留主表.xlsx')
    await writeRawXlsx(p, [
      row(1, ...HEADERS.map((h, i) => sCell(`${'ABCDEF'[i]}1`, h))),
      row(2, sCell('A2', '甲'), '<c r="B2"><f>1+1</f><v>2</v></c>', nCell('C2', 0), nCell('F2', 2)),
      row(3, sCell('A3', '乙'), '<c r="B3"><f t="shared" ref="B3:B4" si="0">2-2</f><v>0</v></c>', nCell('C3', 0), nCell('F3', 0)),
      row(4, sCell('A4', '丙'), '<c r="B4"><f t="shared" si="0"/><v>0</v></c>', nCell('C4', 1), nCell('F4', 1))
    ])
    const before = await excelService.readWorkbook(p)
    assert(before.ok, before.error)
    assert.deepStrictEqual(before.data.members.map(m => [m.name, m.b, m.f]), [['甲', 2, 2], ['乙', 0, 0], ['丙', 0, 1]], '结果为 0 的公式应读成 0，而不是空')

    const r = await excelService.applyIncrement(p, { targetCol: 3, deltas: { 甲: 1, 乙: 1 } })
    assert(r.ok, r.error)
    assert.strictEqual(r.data.uncalculatedFormulas, 0, '结果为 0 的公式不应被报告成"没有计算结果"')
    assert.deepStrictEqual(r.data.summaryFixed, [])

    const after = await excelService.readWorkbook(p)
    assert.deepStrictEqual(after.data.members.map(m => [m.name, m.b, m.c, m.f]), [['甲', 2, 1, 3], ['乙', 0, 1, 1], ['丙', 0, 1, 1]])
    assert.strictEqual(await rawCell(p, 'B2'), '<f>1+1</f><v>2</v>')
    const b3 = await rawCell(p, 'B3')
    assert(/^<f t="shared" ref="B3:B4" si="\d+">2-2<\/f><v>0<\/v>$/.test(b3), `共享公式第一格应保留公式、范围和已保存结果 0，实际：${b3}`)
    const b4 = await rawCell(p, 'B4')
    assert(/^<f t="shared" si="\d+"\/><v>0<\/v>$/.test(b4), `共享公式其余格应保留编号和已保存结果 0，实际：${b4}`)
  })

  // ---------- 合计行、公式格、替换文件时的重试 ----------
  const HEADER_ROW = row(1, ...HEADERS.map((h, i) => sCell(`${'ABCDEF'[i]}1`, h)))

  await t('「合计」「备注」这类文字行不是队员：不进名单、不能被写入、汇总格原样保留', async () => {
    const p = path.join(tmp, '带合计行.xlsx')
    await writeRawXlsx(p, [
      HEADER_ROW,
      row(2, sCell('A2', '甲'), nCell('B2', 1), nCell('C2', 2), nCell('F2', 3)),
      row(3, sCell('A3', '乙'), nCell('B3', 1), nCell('C3', 0), nCell('F3', 1)),
      row(4, sCell('A4', '合计'), '<c r="F4"><f>SUM(F2:F3)</f><v>4</v></c>'), // 汇总格是公式的合计行
      row(5, sCell('A5', '备注：10 月起按新标准'), nCell('F5', 9)), // 备注行，汇总格里碰巧有个数
      row(6, sCell('A6', '姓 名'), sCell('B6', '夜训周训'), sCell('F6', '汇总')), // 中间又出现一次表头
      row(7, sCell('A7', '小 计'), nCell('F7', 100)) // 字中间带排版空格的小计行
    ])
    const rd = await excelService.readWorkbook(p)
    assert(rd.ok, rd.error)
    assert.deepStrictEqual(rd.data.members.map(m => m.name), ['甲', '乙'], '合计、备注、重复的表头都不应进名单')
    assert.deepStrictEqual(rd.data.labelRows.map(x => [x.row, x.name]), [[4, '合计'], [5, '备注：10 月起按新标准'], [6, '姓 名'], [7, '小 计']])

    const r = await excelService.applyIncrement(p, { targetCol: 2, deltas: { 甲: 1 } })
    assert(r.ok, r.error)
    assert.deepStrictEqual(r.data.summaryFixed, [], '文字行不应被报告成"原汇总与明细对不上"')
    assert.deepStrictEqual(r.data.untouchedRows, [])
    assert.strictEqual(await rawCell(p, 'F4'), '<f>SUM(F2:F3)</f><v>4</v>', '合计行的公式和结果应原样保留')
    assert.strictEqual(await cell(p, 5, 6), 9)
    assert.strictEqual(await cell(p, 6, 6), '汇总')
    assert.strictEqual(await cell(p, 7, 6), 100)
    assert.strictEqual(await cell(p, 2, 6), 4, '队员行照常重算')

    // 名单里出现「合计」时不能把分写到那一行：它不是队员
    const w = await excelService.applyIncrement(p, { targetCol: 2, deltas: { 合计: 1 } })
    assert(!w.ok && w.code === 'MEMBER_MISSING', JSON.stringify(w))
  })

  await t('明细里没有任何分数、汇总格却是"算出了数值"的公式：多半是合计行，不改动并如实报告', async () => {
    const p = path.join(tmp, '无名单计行.xlsx')
    await writeRawXlsx(p, [
      HEADER_ROW,
      row(2, sCell('A2', '甲'), nCell('B2', 1), nCell('F2', 1)),
      row(3, sCell('A3', '全体'), '<c r="F3"><f>SUM(F2:F2)</f><v>1</v></c>'),
      // 对照：队员的汇总格是公式、算出来是 0，明细也是空的——这是正常的"还没有分数的队员"，照常处理
      row(4, sCell('A4', '乙'), '<c r="F4"><f>SUM(B4:E4)</f><v>0</v></c>')
    ])
    const r = await excelService.applyIncrement(p, { targetCol: 2, deltas: { 甲: 1 } })
    assert(r.ok, r.error)
    assert.deepStrictEqual(r.data.untouchedRows, [{ name: '全体', row: 3, summary: 1 }])
    assert.deepStrictEqual(r.data.summaryFixed, [])
    assert.strictEqual(await rawCell(p, 'F3'), '<f>SUM(F2:F2)</f><v>1</v>')
    assert.strictEqual(await cell(p, 2, 6), 2)
    assert.strictEqual(await rawCell(p, 'F4'), '<f>SUM(B4:E4)</f><v>0</v>', '算出来是 0 的空队员不应被当成合计行')
  })

  await t('要累加的格子是公式时拒绝写入（公式不会被换成数字），表格一个字节都不动', async () => {
    const p = path.join(tmp, '公式格主表.xlsx')
    await writeRawXlsx(p, [
      row(1, ...HEADERS.map((h, i) => sCell(`${'ABCDEF'[i]}1`, h)), sCell('H1', '国庆出旗')),
      row(2, sCell('A2', '甲'), '<c r="C2"><f>SUM(1,2)</f><v>3</v></c>', nCell('F2', 3)),
      row(3, sCell('A3', '乙'), nCell('C3', 1), '<c r="H3"><f>SUM(1,2)</f><v>3</v></c>', nCell('F3', 4))
    ])
    const before = snapshot(p)
    const backupCount = backups().length

    const r = await excelService.applyIncrement(p, { targetCol: 3, deltas: { 甲: 1, 乙: 1 } })
    assert(!r.ok && r.code === 'FORMULA_CELL', JSON.stringify(r))
    assert.deepStrictEqual(r.data.formulaCells, ['甲'], '乙的升降旗格是数字，不应被牵连')
    assert(/升降旗/.test(r.error) && /甲/.test(r.error) && /选择性粘贴/.test(r.error), r.error)

    const e = await excelService.applyEventEdit(p, { activityName: '国庆出旗', deltas: { 乙: 1 } })
    assert(!e.ok && e.code === 'FORMULA_CELL', JSON.stringify(e))
    assert(/国庆出旗/.test(e.error) && /乙/.test(e.error), e.error)

    assert.strictEqual(snapshot(p), before, '表格不应有任何改动')
    assert.strictEqual(backups().length, backupCount, '校验没通过时不应产生备份')

    // 别的格子照常可写：把差值加到甲的 B 列（数字格）
    const ok = await excelService.applyIncrement(p, { targetCol: 2, deltas: { 甲: 1 } })
    assert(ok.ok, ok.error)
    assert.strictEqual(await cell(p, 2, 2), 1)
    assert.strictEqual(await cell(p, 2, 6), 4)
    assert.strictEqual(await rawCell(p, 'C2'), '<f>SUM(1,2)</f><v>3</v>', '没有被改到的公式不受影响')
  })

  await t('替换文件时被"一闪而过"地占用（EPERM）：稍等重试后照常写成功', async () => {
    const p = path.join(tmp, '重试主表.xlsx')
    await writeRawXlsx(p, [HEADER_ROW, row(2, sCell('A2', '甲'), nCell('B2', 1), nCell('F2', 1))])
    const realRename = fs.renameSync
    let fails = 2
    fs.renameSync = (a, b) => {
      if (fails > 0) { fails--; throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' }) }
      return realRename(a, b)
    }
    try {
      const r = await excelService.applyIncrement(p, { targetCol: 2, deltas: { 甲: 1 } })
      assert(r.ok, r.error)
      assert.strictEqual(fails, 0, '应当重试到成功为止')
      assert.strictEqual(await cell(p, 2, 2), 2)
    } finally {
      fs.renameSync = realRename
    }
    assert.deepStrictEqual(fs.readdirSync(tmp).filter(f => f.startsWith('重试主表.xlsx.tmp-')), [])
  })

  await t('表格一直被占用时：重试几次后放弃，报"被占用"，不留下临时文件，原表格完好', async () => {
    const realRename = fs.renameSync
    const before = snapshot(mainXlsx)
    let calls = 0
    fs.renameSync = () => { calls++; throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' }) }
    try {
      const r = await excelService.applyIncrement(mainXlsx, { targetCol: 2, deltas: { 张三: 1 } })
      assert(!r.ok && r.code === 'EPERM', JSON.stringify(r))
      assert(/被其他程序占用/.test(r.error), r.error)
      assert(calls >= 3, `应当重试多次，实际调用了 ${calls} 次`)
    } finally {
      fs.renameSync = realRename
    }
    assert.strictEqual(snapshot(mainXlsx), before, '写不进去时原表格应保持原样')
    assert.deepStrictEqual(fs.readdirSync(tmp).filter(f => f.startsWith('总积分.xlsx.tmp-')), [])
  })

  await t('恢复备份先拷成临时文件再替换：拷到一半失败时主表保持原样', async () => {
    const p = path.join(tmp, '回滚主表.xlsx')
    await writeRawXlsx(p, [HEADER_ROW, row(2, sCell('A2', '甲'), nCell('B2', 1), nCell('F2', 1))])
    const written = await excelService.applyIncrement(p, { targetCol: 2, deltas: { 甲: 1 } })
    assert(written.ok, written.error)
    const afterWrite = snapshot(p)
    const realCopy = fs.copyFileSync
    fs.copyFileSync = (src, dest) => {
      fs.writeFileSync(dest, 'PK\u0003\u0004只拷了一半')
      throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' })
    }
    try {
      const r = await excelService.restoreBackup(p, written.data.backup)
      assert(!r.ok && r.code === 'ENOSPC', JSON.stringify(r))
    } finally {
      fs.copyFileSync = realCopy
    }
    assert.strictEqual(snapshot(p), afterWrite, '主表不应被换成半截文件')
    assert.deepStrictEqual(fs.readdirSync(tmp).filter(f => f.startsWith('回滚主表.xlsx.restore-')), [], '不应留下临时文件')
    // 占用解除后用同一份备份恢复：成功，表格回到写入前
    const ok = await excelService.restoreBackup(p, written.data.backup)
    assert(ok.ok, ok.error)
    assert.strictEqual(await cell(p, 2, 2), 1)
    assert.strictEqual(await cell(p, 2, 6), 1)
  })

  await t('备份清理只认本表的备份：文件名以本表名结尾的另一个表不会被混进来', () => {
    const dir = fs.mkdtempSync(path.join(tmp, '多表-'))
    const a = path.join(dir, '积分.xlsx')
    const b = path.join(dir, '总_积分.xlsx')
    fs.writeFileSync(a, 'a')
    fs.writeFileSync(b, 'b')
    for (let i = 0; i < 5; i++) backupExcel(a) // 先给「积分.xlsx」备份 5 份
    for (let i = 0; i < 18; i++) backupExcel(b) // 再给「总_积分.xlsx」备份 18 份（它的备份也以 _积分.xlsx 结尾）
    const names = fs.readdirSync(path.join(dir, '.backups'))
    const ofA = names.filter(f => /^\d{8}_\d{6}(_\d+)?_积分\.xlsx$/.test(f))
    const ofB = names.filter(f => f.endsWith('_总_积分.xlsx'))
    assert.strictEqual(ofA.length, 5, `「积分.xlsx」的 5 份备份应全部保留，实际 ${ofA.length}`)
    assert.strictEqual(ofB.length, 18)
  })

  // ---------- 其他 ----------
  await t('滚动备份 .backups 生成，且每个表格各自不超过 20 份', async () => {
    const files = backups()
    assert(files.length > 0, '应有备份文件')
    assert(/^\d{8}_\d{6}(_\d+)?_总积分\.xlsx$/.test(files.find(f => f.endsWith('_总积分.xlsx'))), '备份命名应为 时间[_序号]_原文件名')
    // 上限是按"原文件"算的（每个表格各自保留最近 20 份），所以逐个表格核对
    const perFile = {}
    for (const f of files) {
      const base = f.replace(/^\d{8}_\d{6}(_\d+)?_/, '')
      perFile[base] = (perFile[base] || 0) + 1
    }
    const over = Object.entries(perFile).filter(([, n]) => n > 20)
    assert.deepStrictEqual(over, [], `备份应每个表格 ≤20 份，实际：${JSON.stringify(perFile)}`)
  })

  await t('不存在的文件返回 NOT_FOUND 而非崩溃', async () => {
    const missing = path.join(tmp, '不存在.xlsx')
    const read = await excelService.readWorkbook(missing)
    assert(!read.ok && read.code === 'NOT_FOUND')
    const write = await excelService.commitEvent(missing, { activityName: 'x', scores: { 甲: 1 } })
    assert(!write.ok && write.code === 'NOT_FOUND', JSON.stringify(write))
    const restore = await excelService.restoreBackup(missing, lastBackup)
    assert(!restore.ok && restore.code === 'NOT_FOUND', JSON.stringify(restore))
  })

  console.log(`\n${passed} 项测试通过${process.exitCode ? '（存在失败项）' : ''}`)
  if (process.exitCode) {
    console.log(`临时目录保留供排查: ${tmp}`)
  } else {
    fs.rmSync(tmp, { recursive: true, force: true })
    console.log('临时目录已清理')
  }
})().catch(e => { console.error(e); process.exit(1) })
