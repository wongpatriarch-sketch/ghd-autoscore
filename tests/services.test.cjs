/* 服务层集成测试：node tests/services.test.cjs */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const os = require('os')
const ExcelJS = require('exceljs')

const excelService = require('../electron/services/excelService')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ghd-test-'))
const mainXlsx = path.join(tmp, '总积分.xlsx')
const extCount = path.join(tmp, '升降旗考勤.xlsx')
const extSandwich = path.join(tmp, '后勤统计.xlsx')

async function makeMain () {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('总积分')
  ws.getRow(1).values = ['姓名', '夜训周训', '升降旗', '后勤部', '综办部', '汇总']
  ws.getRow(2).values = ['--31届--']
  ws.getRow(3).values = ['张三', 1, 2, null, null, 3]
  ws.getRow(4).values = ['李四', null, null, null, null, null] // 空单元格
  ws.getRow(5).values = ['--30届--']
  ws.getRow(6).values = ['王五', 2, 1, 1, 1, 5]
  ws.getRow(7).values = ['张三', null, null, null, null, -2] // 同名 + 负分
  ws.getRow(8).values = [null, null, null, null, null, null] // 空行
  await wb.xlsx.writeFile(mainXlsx)
}

async function cell (file, r, c) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  return wb.worksheets[0].getRow(r).getCell(c).value
}

;(async () => {
  let passed = 0
  const t = async (name, fn) => {
    try { await fn(); passed++; console.log(`  ✓ ${name}`) } catch (e) {
      console.error(`  ✗ ${name}\n    ${e.message}`)
      process.exitCode = 1
    }
  }

  await makeMain()
  console.log('临时目录:', tmp)

  await t('createTemplate 生成标准模板', async () => {
    const p = path.join(tmp, 'template.xlsx')
    const r = await excelService.createTemplate(p)
    assert(r.ok, r.error)
    assert.strictEqual(await cell(p, 1, 1), '姓名')
    assert.strictEqual(await cell(p, 1, 6), '汇总')
  })

  await t('readWorkbook 解析届别/同名/空行', async () => {
    const r = await excelService.readWorkbook(mainXlsx)
    assert(r.ok, r.error)
    const d = r.data
    assert.strictEqual(d.members.length, 4)
    assert.deepStrictEqual(d.members.map(m => m.name), ['张三', '李四', '王五', '张三'])
    assert.strictEqual(d.members[0].generation, 31)
    assert.strictEqual(d.members[2].generation, 30)
    assert.deepStrictEqual(d.duplicateNames, ['张三'])
    assert.strictEqual(d.members[1].f, null) // 李四 F 为空
    assert.strictEqual(d.members[3].f, -2)
  })

  await t('commitEvent 追加活动列 + F 同步（空单元格按 0）', async () => {
    const r = await excelService.commitEvent(mainXlsx, {
      activityName: '国庆出旗',
      scores: { 张三: 4.5, 李四: 3, 王五: 2 }
    })
    assert(r.ok, r.error)
    assert.strictEqual(r.data.column, 7)
    assert.strictEqual(await cell(mainXlsx, 1, 7), '国庆出旗')
    assert.strictEqual(await cell(mainXlsx, 3, 7), 4.5) // 张三(row3)
    assert.strictEqual(await cell(mainXlsx, 3, 6), 7.5) // 3 + 4.5
    assert.strictEqual(await cell(mainXlsx, 4, 6), 3)    // 李四 空->0 + 3
    assert.strictEqual(await cell(mainXlsx, 6, 6), 7)    // 王五 5+2
    // 同名第二个张三(row7)不应被写入
    assert.strictEqual(await cell(mainXlsx, 7, 7), null)
  })

  await t('commitEvent 同名活动列阻断', async () => {
    const r = await excelService.commitEvent(mainXlsx, { activityName: '国庆出旗', scores: { 张三: 1 } })
    assert(!r.ok && r.code === 'DUP_COLUMN')
  })

  await t('applyIncrement C 列 + F 增量累加', async () => {
    const before = await cell(mainXlsx, 3, 6)
    const r = await excelService.applyIncrement(mainXlsx, { targetCol: 3, deltas: { 张三: 1.5, 王五: 0.5 } })
    assert(r.ok, r.error)
    assert.strictEqual(await cell(mainXlsx, 3, 3), 3.5) // 2+1.5
    assert.strictEqual(await cell(mainXlsx, 3, 6), before + 1.5)
    assert.strictEqual(await cell(mainXlsx, 6, 3), 1.5) // 1+0.5
  })

  await t('applyEventEdit 差值写入活动列与 F', async () => {
    const r = await excelService.applyEventEdit(mainXlsx, { activityName: '国庆出旗', deltas: { 张三: -1.5, 王五: 1 } })
    assert(r.ok, r.error)
    assert.strictEqual(await cell(mainXlsx, 3, 7), 3)     // 4.5-1.5
    assert.strictEqual(await cell(mainXlsx, 3, 6), 7.5)   // 9(7.5+1.5 增量测试后)-1.5
    assert.strictEqual(await cell(mainXlsx, 6, 7), 3)     // 2+1
    assert.strictEqual(await cell(mainXlsx, 6, 6), 8.5)   // 7.5+1
  })

  await t('deleteActivityColumn 物理删列 + F 反向扣减', async () => {
    const r = await excelService.deleteActivityColumn(mainXlsx, {
      activityName: '国庆出旗',
      deltas: { 张三: 3, 李四: 3, 王五: 3 }
    })
    assert(r.ok, r.error)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(mainXlsx)
    const ws = wb.worksheets[0]
    assert.strictEqual(ws.getRow(1).getCell(7).value, null)
    assert.strictEqual(await cell(mainXlsx, 3, 6), 4.5) // 7.5-3
    assert.strictEqual(await cell(mainXlsx, 4, 6), 0)   // 3-3
    assert.strictEqual(await cell(mainXlsx, 6, 6), 5.5) // 8.5-3
  })

  await t('readExternal count 模式（严格 姓名/总次数 + 空值清洗）', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('考勤')
    ws.getRow(1).values = ['序号', '姓名', '总次数']
    ws.getRow(2).values = [1, '张三', 3]
    ws.getRow(3).values = [2, null, 5]       // 姓名为空 -> 过滤
    ws.getRow(4).values = [3, '李四', null]  // 总次数空 -> 0
    ws.getRow(5).values = [4, '王五', 2]
    await wb.xlsx.writeFile(extCount)
    const r = await excelService.readExternal(extCount, 'count')
    assert(r.ok, r.error)
    assert.deepStrictEqual(r.data.entries, [
      { name: '张三', count: 3 },
      { name: '李四', count: 0 },
      { name: '王五', count: 2 }
    ])
  })

  await t('readExternal sandwich 模式（中间列自适应忽略）', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('后勤')
    ws.getRow(1).values = ['姓名', '1月', '2月', '扣分', '总积分']
    ws.getRow(2).values = ['张三', 1, 2, -1, 2]
    ws.getRow(3).values = ['王五', 3, 1, 0, 4]
    ws.getRow(4).values = [null, 9, 9, 9, 9]
    await wb.xlsx.writeFile(extSandwich)
    const r = await excelService.readExternal(extSandwich, 'sandwich')
    assert(r.ok, r.error)
    assert.deepStrictEqual(r.data.entries, [
      { name: '张三', count: 2 },
      { name: '王五', count: 4 }
    ])
  })

  await t('readExternal 列名不匹配时报错', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('x')
    ws.getRow(1).values = ['名字', '次数']
    ws.getRow(2).values = ['张三', 3]
    const p = path.join(tmp, 'bad.xlsx')
    await wb.xlsx.writeFile(p)
    const r = await excelService.readExternal(p, 'count')
    assert(!r.ok && r.code === 'HEADER_MISMATCH', JSON.stringify(r))
  })

  await t('滚动备份 .backups 生成且不超过 20 份', async () => {
    const dir = path.join(tmp, '.backups')
    assert(fs.existsSync(dir), '.backups 目录应存在')
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.xlsx'))
    assert(files.length > 0, '应有备份文件')
    assert(files.length <= 20, `备份应 ≤20 份，实际 ${files.length}`)
    assert(/^\d{8}_\d{6}_总积分\.xlsx$/.test(files[0]), `命名格式: ${files[0]}`)
  })

  await t('不存在的文件返回 NOT_FOUND 而非崩溃', async () => {
    const r = await excelService.readWorkbook(path.join(tmp, '不存在.xlsx'))
    assert(!r.ok && r.code === 'NOT_FOUND')
  })

  console.log(`\n${passed} 项测试通过${process.exitCode ? '（存在失败项）' : ''}`)
})().catch(e => { console.error(e); process.exit(1) })
