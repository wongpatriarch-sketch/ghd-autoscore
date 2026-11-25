/*
 * 压力与边界测试（不需要启动程序，直接调用服务层）。
 * 运行：npm run test:stress
 *
 * 覆盖：
 *   1. 大表：500 人 × 40 个活动列，读、写、改、删列都正常，速度可接受
 *   2. 连续 25 次写入：备份封顶 20 份、留下的都是最近的、汇总分始终一致
 *   3. 同时发起的多次写入：排队执行，不会互相覆盖
 *   4. 奇怪的姓名：首尾空格、全角空格、换行、emoji、引号、纯数字、超长、去空格后重名
 *   5. 奇怪的调用参数：非数字分值、数字字符串、NaN / Infinity、超大数、空值、类型不对的对象
 *   6. 奇怪的表格：汇总列是文字 / 日期 / 错误值、没有表头、表头带空格、合并单元格的表头、届别行的几种写法、
 *      空文件、损坏的文件
 *   7. 写入失败时不留痕迹
 * 全程只用系统临时目录里的副本，不碰任何真实积分表。
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const ExcelJS = require('exceljs')
const JSZip = require('jszip') // ExcelJS 自带的依赖（用来解压 / 压缩 xlsx），这里只借它造一个"不是工作簿的压缩包"
const excelService = require('../electron/services/excelService')

const HEADERS = ['姓名', '夜训周训', '升降旗', '后勤', '综办', '汇总']
const r4 = v => +Number(v).toFixed(4)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ghd-stress-'))
const backupDir = path.join(tmp, '.backups')

async function open (file) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  return wb.worksheets[0]
}
const cell = async (file, r, c) => (await open(file)).getRow(r).getCell(c).value
const snapshot = file => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex')
const backupsOf = base => fs.existsSync(backupDir)
  ? fs.readdirSync(backupDir).filter(f => f.endsWith(`_${base}.xlsx`))
      .map(name => ({ name, file: path.join(backupDir, name), created: fs.statSync(path.join(backupDir, name)).birthtimeMs }))
      .sort((a, b) => a.created - b.created)
  : []
const timed = async (label, fn) => {
  const t0 = performance.now()
  const out = await fn()
  const ms = Math.round(performance.now() - t0)
  console.log(`      ${label}：${ms} ms`)
  return { out, ms }
}

// 最小的一张表：表头 + 几个队员
async function makeSmall (file, rows) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('总积分')
  ws.getRow(1).values = HEADERS
  rows.forEach((values, i) => { ws.getRow(i + 2).values = values })
  await wb.xlsx.writeFile(file)
}

;(async () => {
  let passed = 0
  let failed = 0
  const t = async (name, fn) => {
    try { await fn(); passed++; console.log(`  ✓ ${name}`) } catch (e) {
      failed++
      console.error(`  ✗ ${name}\n    ${e.message}`)
      process.exitCode = 1
    }
  }
  console.log('临时目录:', tmp)

  // ============ 1. 大表 ============
  console.log('\n[1] 大表：500 人 × 40 个活动列')
  const big = path.join(tmp, '大表.xlsx')
  const bigNames = []
  const consistencyOf = rd => rd.data.members.filter(m => Math.abs(
    (m.b || 0) + (m.c || 0) + (m.d || 0) + (m.e || 0) + rd.data.activityColumns.reduce((s, ac) => s + (m.extras[ac.col] || 0), 0) - m.f
  ) > 1e-9).map(m => m.name)
  await t('造一张 500 人 × 40 个活动列、每格都带边框的表', async () => {
    await timed('造表', async () => {
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Sheet1')
      const border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } }
      ws.getRow(1).values = ['姓名', '夜训周训', '升降旗', '后勤', '综办', '汇总', null, ...Array.from({ length: 40 }, (_, i) => `活动${i + 1}\n（第 ${i + 1} 期）`)]
      ws.getRow(1).height = 40
      for (let c = 1; c <= 46; c++) {
        if (c === 7) continue
        const h = ws.getRow(1).getCell(c)
        h.font = { name: '等线', size: 11 }
        h.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
        h.border = { ...border }
      }
      let r = 2
      for (let g = 0; g < 5; g++) {
        const cohort = ws.getRow(r)
        cohort.getCell(1).value = `--${30 - g}届--`
        cohort.getCell(6).value = 0
        r++
        for (let i = 0; i < 100; i++) {
          const row = ws.getRow(r)
          const name = `队员${String(r).padStart(3, '0')}`
          bigNames.push(name)
          row.getCell(1).value = name
          row.getCell(2).value = (i % 7) * 0.5
          row.getCell(3).value = i % 3
          row.getCell(4).value = i % 2
          row.getCell(5).value = i % 5 === 0 ? 1 : null
          let sum = (i % 7) * 0.5 + (i % 3) + (i % 2) + (i % 5 === 0 ? 1 : 0)
          for (let c = 8; c <= 47; c++) {
            const points = (c % 5) * 0.5
            if (i % ((c % 9) + 2) === 0) { row.getCell(c).value = points; sum += points }
            row.getCell(c).border = { ...border }
          }
          row.getCell(6).value = r4(sum)
          r++
        }
      }
      await wb.xlsx.writeFile(big)
    })
    assert(fs.statSync(big).size > 20000, '大表文件应当已经生成')
    console.log(`      文件大小：${Math.round(fs.statSync(big).size / 1024)} KB`)
  })

  await t('读 500 人的表：每人汇总分都与明细对得上', async () => {
    const { out: rd, ms } = await timed('读表', () => excelService.readWorkbook(big))
    assert(rd.ok, rd.error)
    assert.strictEqual(rd.data.members.length, 500)
    assert.strictEqual(rd.data.activityColumns.length, 40)
    assert.deepStrictEqual(consistencyOf(rd), [], '汇总分与明细不一致')
    assert(ms < 20000, `读表耗时 ${ms} ms，超出 20 秒`)
  })

  await t('新建活动（50 人得分）', async () => {
    const scores = {}
    bigNames.forEach((n, i) => { if (i % 10 === 0) scores[n] = 1.5 })
    const { out: res, ms } = await timed('写入', () => excelService.commitEvent(big, { activityName: '大表新活动', scores }))
    assert(res.ok, res.error)
    assert.strictEqual(res.data.column, 48, '新列应落在第 48 列（第 47 列是最后一个活动列）')
    assert.deepStrictEqual(res.data.summaryFixed, [], '原表汇总是对的，不应有"纠正"记录')
    assert.strictEqual(await cell(big, 3, 48), 1.5, '第 1 个队员在第 3 行')
    assert(ms < 30000, `写入耗时 ${ms} ms，超出 30 秒`)
  })

  await t('日常训练累加（100 人）', async () => {
    const deltas = {}
    bigNames.forEach((n, i) => { if (i % 5 === 0) deltas[n] = 0.5 })
    const { out: res, ms } = await timed('写入', () => excelService.applyIncrement(big, { targetCol: 2, deltas }))
    assert(res.ok, res.error)
    assert.strictEqual(await cell(big, 3, 2), 0.5, '第 1 个队员（i = 0）夜训周训 0 → 0.5')
    assert.deepStrictEqual(res.data.summaryFixed, [])
    assert(ms < 30000, `写入耗时 ${ms} ms，超出 30 秒`)
  })

  await t('修改活动分（100 人）', async () => {
    const deltas = {}
    bigNames.forEach((n, i) => { if (i % 10 === 0) deltas[n] = -1 })
    const { out: res, ms } = await timed('写入', () => excelService.applyEventEdit(big, { activityName: '大表新活动', deltas }))
    assert(res.ok, res.error)
    assert.strictEqual(await cell(big, 3, 48), 0.5, '1.5 - 1 = 0.5')
    assert.deepStrictEqual(res.data.summaryFixed, [])
    assert(ms < 30000, `写入耗时 ${ms} ms，超出 30 秒`)
  })

  await t('删掉中间的一个活动列：右侧各列整体左移，500 人汇总分重算', async () => {
    const { out: res, ms } = await timed('删列', () => excelService.deleteActivityColumn(big, { activityName: '活动1\n（第 1 期）' }))
    assert(res.ok, res.error)
    assert.deepStrictEqual(res.data.summaryFixed, [], '删列带来的汇总变化是预期内的，不应被报告成"原汇总与明细对不上"')
    const ws = await open(big)
    assert.strictEqual(ws.getRow(1).getCell(8).value, '活动2\n（第 2 期）')
    assert.strictEqual(ws.getRow(1).getCell(47).value, '大表新活动')
    assert.strictEqual(ws.getRow(1).getCell(48).value, null)
    assert.strictEqual(ws.getRow(1).getCell(7).value, null, '第 7 列仍是空白分隔列')
    const rd = await excelService.readWorkbook(big)
    assert(rd.ok, rd.error)
    assert.strictEqual(rd.data.activityColumns.length, 40)
    assert.deepStrictEqual(consistencyOf(rd), [], '删列后每人的汇总分仍然等于明细之和')
    assert(ms < 30000, `删列耗时 ${ms} ms，超出 30 秒`)
  })

  // ============ 2. 连续写入 ============
  console.log('\n[2] 连续 25 次写入')
  const seq = path.join(tmp, '逐次累加.xlsx')
  await makeSmall(seq, [['甲', 0, null, null, null, 0]])
  await t('25 次写入后：备份正好 20 份、留下的都是最近的 20 份、汇总分始终一致', async () => {
    for (let i = 1; i <= 25; i++) {
      const r = await excelService.applyIncrement(seq, { targetCol: 2, deltas: { 甲: 1 } })
      assert(r.ok, `第 ${i} 次写入失败：${r.error}`)
      assert.deepStrictEqual(r.data.summaryFixed, [])
    }
    assert.strictEqual(await cell(seq, 2, 2), 25)
    assert.strictEqual(await cell(seq, 2, 6), 25)
    const list = backupsOf('逐次累加')
    assert.strictEqual(list.length, 20, `备份应有 20 份，实际 ${list.length}`)
    // 第 k 次写入前甲是 k-1。留下的是第 6~25 次写入前的备份，所以最早的一份里是 5
    assert.strictEqual(await cell(list[0].file, 2, 2), 5, '最早的备份应是"第 6 次写入前"的状态（甲 = 5）')
    assert.strictEqual(await cell(list[list.length - 1].file, 2, 2), 24, '最晚的备份应是"第 25 次写入前"的状态（甲 = 24）')
    for (let i = 1; i < list.length; i++) assert(list[i].created >= list[i - 1].created, '备份应按创建时间从早到晚')
    const numbered = list.filter(b => /^\d{8}_\d{6}_\d+_逐次累加\.xlsx$/.test(b.name))
    console.log(`      同一秒内连写产生的带序号的备份：${numbered.length} 份`)
    for (const b of list) assert(/^\d{8}_\d{6}(_\d+)?_逐次累加\.xlsx$/.test(b.name), `备份文件名不符合规则：${b.name}`)
  })

  // ============ 3. 同时发起的写入 ============
  console.log('\n[3] 同时发起的多次写入')
  const race = path.join(tmp, '并发.xlsx')
  await makeSmall(race, [['甲', 1, null, null, null, 1]])
  await t('两个不同的活动同时写入：两列都在，谁也没把谁覆盖', async () => {
    const [x, y] = await Promise.all([
      excelService.commitEvent(race, { activityName: '活动X', scores: { 甲: 2 } }),
      excelService.commitEvent(race, { activityName: '活动Y', scores: { 甲: 3 } })
    ])
    assert(x.ok && y.ok, `${x.error || ''} ${y.error || ''}`)
    assert.deepStrictEqual([x.data.column, y.data.column].sort((a, b) => a - b), [8, 9], '两次写入应分别落在第 8、9 列')
    assert.strictEqual(await cell(race, 1, 8), '活动X')
    assert.strictEqual(await cell(race, 1, 9), '活动Y')
    assert.strictEqual(await cell(race, 2, 8), 2)
    assert.strictEqual(await cell(race, 2, 9), 3)
    assert.strictEqual(await cell(race, 2, 6), 6, '汇总 = 1 + 2 + 3')
  })
  await t('三次累加同时写入：三次都算数（1 + 1 + 2 + 4 = 8）', async () => {
    const rs = await Promise.all([
      excelService.applyIncrement(race, { targetCol: 2, deltas: { 甲: 1 } }),
      excelService.applyIncrement(race, { targetCol: 2, deltas: { 甲: 2 } }),
      excelService.applyIncrement(race, { targetCol: 2, deltas: { 甲: 4 } })
    ])
    assert(rs.every(r => r.ok), rs.map(r => r.error).join('；'))
    assert.strictEqual(await cell(race, 2, 2), 8)
    assert.strictEqual(await cell(race, 2, 6), 13, '汇总 = 8 + 2 + 3')
    assert.strictEqual(backupsOf('并发').length, 5, '成功的 5 次写入各留 1 份备份')
  })
  await t('同名的两个活动同时写入：一个成功，另一个按"重名"拒绝，不留备份', async () => {
    const rs = await Promise.all([
      excelService.commitEvent(race, { activityName: '活动Z', scores: { 甲: 1 } }),
      excelService.commitEvent(race, { activityName: '活动Z', scores: { 甲: 5 } })
    ])
    assert.strictEqual(rs.filter(r => r.ok).length, 1, '应只有一个成功')
    const failed = rs.find(r => !r.ok)
    assert.strictEqual(failed.code, 'DUP_COLUMN')
    assert.strictEqual(await cell(race, 1, 10), '活动Z')
    assert.strictEqual(await cell(race, 2, 10), 1, '列里的分数应是成功那一次写入的 1')
    assert.strictEqual(backupsOf('并发').length, 6, '被拒绝的那次不留备份')
  })
  await t('写入失败（重名）后队列不卡死：后面的写入照常进行', async () => {
    const r = await excelService.applyIncrement(race, { targetCol: 3, deltas: { 甲: 0.5 } })
    assert(r.ok, r.error)
    assert.strictEqual(await cell(race, 2, 3), 0.5)
    assert.strictEqual(await cell(race, 2, 6), 14.5, '汇总 = 8 + 0.5 + 2 + 3 + 1')
  })

  // ============ 4. 奇怪的姓名 ============
  console.log('\n[4] 奇怪的姓名')
  const odd = path.join(tmp, '怪名字.xlsx')
  const LONG = '名字特别长的队员'.repeat(8)
  await makeSmall(odd, [
    [' 张三 ', null, null, null, null, null], // 单元格里带首尾空格
    ['李四\u3000', null, null, null, null, null], // 带全角空格
    ['王\n五', null, null, null, null, null], // 名字中间换行
    ['O"Brian', null, null, null, null, null], // 引号
    ['😀七', null, null, null, null, null], // emoji
    [123, null, null, null, null, null], // 纯数字（单元格里是数字类型）
    [LONG, null, null, null, null, null], // 超长
    ['张三 ', null, null, null, null, null] // 去掉空格后和第 2 行重名
  ])
  const ODD = { 张三: 1, 李四: 2, '王\n五': 3, 'O"Brian': 4, '😀七': 5, 123: 6, [LONG]: 7 }
  await t('按"去掉首尾空白后的姓名"写入，各种怪名字都能找对行', async () => {
    const r = await excelService.commitEvent(odd, { activityName: '怪名字活动', scores: ODD })
    assert(r.ok, r.error)
    const want = [1, 2, 3, 4, 5, 6, 7, null]
    for (let i = 0; i < want.length; i++) {
      assert.strictEqual(await cell(odd, i + 2, 8), want[i], `第 ${i + 2} 行的活动分应为 ${want[i]}`)
      assert.strictEqual(await cell(odd, i + 2, 6), want[i], `第 ${i + 2} 行的汇总分应为 ${want[i]}`)
    }
    assert.deepStrictEqual(r.data.duplicateNames, ['张三'], '去掉空格后重名的姓名应如实报告')
  })
  await t('界面读出来的姓名、重名提示与写入时用的口径一致', async () => {
    const rd = await excelService.readWorkbook(odd)
    assert(rd.ok, rd.error)
    assert.deepStrictEqual(rd.data.members.map(m => m.name), ['张三', '李四', '王\n五', 'O"Brian', '😀七', '123', LONG, '张三'])
    assert.deepStrictEqual(rd.data.duplicateNames, ['张三'])
  })
  await t('带空格的姓名不能直接匹配（程序认的是去掉首尾空白后的名字）', async () => {
    const r = await excelService.applyIncrement(odd, { targetCol: 2, deltas: { ' 张三 ': 1 } })
    assert(!r.ok && r.code === 'MEMBER_MISSING', JSON.stringify(r))
    assert.deepStrictEqual(r.data.missing, [' 张三 '])
  })
  await t('怪名字的撤销：减回 0 后活动格恢复成空白，汇总分回到 0', async () => {
    const neg = Object.fromEntries(Object.entries(ODD).map(([k, v]) => [k, -v]))
    const r = await excelService.applyEventEdit(odd, { activityName: '怪名字活动', deltas: neg })
    assert(r.ok, r.error)
    for (let row = 2; row <= 8; row++) {
      assert.strictEqual(await cell(odd, row, 8), null, `第 ${row} 行活动格应恢复为空白`)
      assert.strictEqual(await cell(odd, row, 6), 0, `第 ${row} 行汇总分应为 0`)
    }
    assert.strictEqual(await cell(odd, 9, 8), null)
    assert.strictEqual(await cell(odd, 9, 6), null, '从头到尾没有过分数的行，汇总保持空白')
    assert.deepStrictEqual(r.data.summaryFixed, [])
  })
  await t('表头里带首尾空格的活动名：按去掉空格后的名字查找', async () => {
    const file = path.join(tmp, '表头带空格.xlsx')
    await makeSmall(file, [['甲', 1, null, null, null, 1]])
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file)
    wb.worksheets[0].getRow(1).getCell(8).value = '  国庆出旗  '
    await wb.xlsx.writeFile(file)
    const r = await excelService.applyEventEdit(file, { activityName: '国庆出旗', deltas: { 甲: 2 } })
    assert(r.ok, r.error)
    assert.strictEqual(r.data.column, 8)
    assert.strictEqual(await cell(file, 2, 8), 2)
    assert.strictEqual(await cell(file, 2, 6), 3)
    const rd = await excelService.readWorkbook(file)
    assert.deepStrictEqual(rd.data.activityColumns.map(ac => ac.name), ['国庆出旗'], '界面上显示的活动名不带首尾空格')
  })

  // ============ 5. 奇怪的调用参数 ============
  console.log('\n[5] 奇怪的调用参数')
  const args = path.join(tmp, '怪参数.xlsx')
  const TEN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
  await makeSmall(args, TEN.map(n => [n, null, null, null, null, null]))
  await t('分值不是数字：只有"纯数字的字符串"会被当成数字，其余类型一律忽略', async () => {
    const r = await excelService.commitEvent(args, {
      activityName: '怪参数活动',
      scores: { 甲: 'abc', 乙: NaN, 丙: Infinity, 丁: true, 戊: null, 己: undefined, 庚: {}, 辛: [1], 壬: '2.5', 癸: ' 3 ' }
    })
    assert(r.ok, r.error)
    for (const [i, n] of TEN.entries()) {
      const want = n === '壬' ? 2.5 : n === '癸' ? 3 : null
      assert.strictEqual(await cell(args, i + 2, 8), want, `${n} 的活动分应为 ${want}`)
    }
  })
  await t('负数、超大数：原样写入，不会被当成 0', async () => {
    const r = await excelService.applyIncrement(args, { targetCol: 2, deltas: { 甲: -1.5 } })
    assert(r.ok, r.error)
    assert.strictEqual(await cell(args, 2, 2), -1.5, '原来空白、加负数：写成负数')
    assert.strictEqual(await cell(args, 2, 6), -1.5)
    const big2 = await excelService.applyIncrement(args, { targetCol: 3, deltas: { 甲: 1e15 } })
    assert(big2.ok, big2.error)
    assert.strictEqual(await cell(args, 2, 3), 1e15)
    assert.strictEqual(await cell(args, 2, 6), 1e15 - 1.5)
  })
  await t('参数类型完全不对：返回带原因的错误，不崩溃、不改表、不留备份', async () => {
    const before = snapshot(args)
    const n = backupsOf('怪参数').length
    const cases = [
      () => excelService.commitEvent(args, { activityName: 'x', scores: null }),
      () => excelService.commitEvent(args, { activityName: 'x', scores: '甲:1' }),
      () => excelService.commitEvent(args, { activityName: 'x', scores: 42 }),
      () => excelService.commitEvent(args, { activityName: 'x', scores: [1, 2] }),
      () => excelService.commitEvent(args, { activityName: 'x', scores: { 甲: 0, 乙: '0' } }),
      () => excelService.commitEvent(args, { activityName: 'x' }),
      () => excelService.commitEvent(args, null),
      () => excelService.commitEvent(args, undefined),
      () => excelService.commitEvent(args, '活动名'),
      () => excelService.commitEvent(args, 123),
      () => excelService.commitEvent(args, { activityName: 123, scores: { 甲: 1 } }),
      () => excelService.commitEvent(args, { activityName: {}, scores: { 甲: 1 } }),
      () => excelService.commitEvent(args, { activityName: null, scores: { 甲: 1 } }),
      () => excelService.commitEvent(args, { activityName: '   ', scores: { 甲: 1 } }),
      () => excelService.applyIncrement(args, null),
      () => excelService.applyIncrement(args, { targetCol: '3abc', deltas: { 甲: 1 } }),
      () => excelService.applyIncrement(args, { targetCol: [3], deltas: { 甲: 1 } }),
      () => excelService.applyIncrement(args, { targetCol: true, deltas: { 甲: 1 } }),
      () => excelService.applyIncrement(args, { targetCol: 1, deltas: { 甲: 1 } }), // 汇总列不允许累加
      () => excelService.applyIncrement(args, { targetCol: 6, deltas: { 甲: 1 } }), // 姓名列不允许累加
      () => excelService.applyIncrement(args, { targetCol: 7, deltas: { 甲: 1 } }), // 空白分隔列不允许累加
      () => excelService.applyIncrement(args, { targetCol: 3, deltas: '甲:1' }),
      () => excelService.applyIncrement(args, { targetCol: 3, deltas: null }),
      () => excelService.applyIncrement(args, { targetCol: 3, deltas: [] }),
      () => excelService.applyEventEdit(args, null),
      () => excelService.applyEventEdit(args, { activityName: '怪参数活动', deltas: {} }),
      () => excelService.applyEventEdit(args, { activityName: '怪参数活动', deltas: { 甲: NaN } }),
      () => excelService.applyEventEdit(args, { activityName: 123, deltas: { 甲: 1 } }),
      () => excelService.applyEventEdit(args, { activityName: '不存在的活动', deltas: { 甲: 1 } }),
      () => excelService.deleteActivityColumn(args, null),
      () => excelService.deleteActivityColumn(args, { activityName: 123 }),
      () => excelService.deleteActivityColumn(args, '怪参数活动'),
      () => excelService.deleteActivityColumn(args, { activityName: '不存在的活动' })
    ]
    for (const [i, run] of cases.entries()) {
      const r = await run()
      assert(!r.ok, `第 ${i + 1} 种错误参数不应被接受：${JSON.stringify(r)}`)
      assert(r.code && r.error, `第 ${i + 1} 种错误参数应返回错误码和说明：${JSON.stringify(r)}`)
    }
    assert.strictEqual(snapshot(args), before, '这些错误参数不应改动表格')
    assert.strictEqual(backupsOf('怪参数').length, n, '这些错误参数不应留备份')
    // targetCol 传数字字符串 '3'：等价于 3，可以接受
    const ok = await excelService.applyIncrement(args, { targetCol: '3', deltas: { 甲: 1 } })
    assert(ok.ok, ok.error)
    assert.notStrictEqual(snapshot(args), before)
    assert.strictEqual(backupsOf('怪参数').length, n + 1, '只有最后一次合法写入留了备份')
  })
  await t('表里没有的队员：整笔写入被拒绝，表不变', async () => {
    const file = path.join(tmp, '查无此人.xlsx')
    await makeSmall(file, [['甲', 1, null, null, null, 1]])
    assert((await excelService.commitEvent(file, { activityName: '已有活动', scores: { 甲: 1 } })).ok)
    const before = snapshot(file)
    const n = backupsOf('查无此人').length
    for (const r of await Promise.all([
      excelService.commitEvent(file, { activityName: '新活动', scores: { 甲: 1, 陌生人: 2 } }),
      excelService.applyIncrement(file, { targetCol: 2, deltas: { 陌生人: 2 } }),
      excelService.applyEventEdit(file, { activityName: '已有活动', deltas: { 陌生人: 2 } })
    ])) {
      assert(!r.ok && r.code === 'MEMBER_MISSING', JSON.stringify(r))
      assert.deepStrictEqual(r.data.missing, ['陌生人'])
    }
    assert.strictEqual(snapshot(file), before)
    assert.strictEqual(backupsOf('查无此人').length, n, '被拒绝的写入不留备份')
  })
  await t('路径不存在的各种调用都返回 NOT_FOUND', async () => {
    const missing = path.join(tmp, '不存在.xlsx')
    const rs = await Promise.all([
      excelService.readWorkbook(missing),
      excelService.commitEvent(missing, { activityName: 'x', scores: { 甲: 1 } }),
      excelService.applyIncrement(missing, { targetCol: 2, deltas: { 甲: 1 } }),
      excelService.applyEventEdit(missing, { activityName: 'x', deltas: { 甲: 1 } }),
      excelService.deleteActivityColumn(missing, { activityName: 'x' }),
      excelService.restoreBackup(missing, path.join(backupDir, 'x.xlsx')),
      excelService.readExternal(missing, 'count'),
      excelService.readWorkbook(undefined),
      excelService.readWorkbook(123)
    ])
    rs.forEach((r, i) => assert(!r.ok && r.code === 'NOT_FOUND', `第 ${i + 1} 个调用应返回 NOT_FOUND：${JSON.stringify(r)}`))
  })

  // ============ 6. 奇怪的表格 ============
  console.log('\n[6] 奇怪的表格')
  await t('汇总列里是文字 / 日期 / 错误值：改成算出来的数字并如实报告；日期格式一并换掉', async () => {
    const file = path.join(tmp, '汇总列是文字.xlsx')
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('总积分')
    ws.getRow(1).values = HEADERS
    ws.getRow(2).values = ['甲', 2, 1, null, null, '缺考']
    ws.getRow(3).values = ['乙', 1, null, null, null, new Date(2026, 0, 1)]
    ws.getRow(4).values = ['丙', 1, null, null, null, null]
    ws.getRow(4).getCell(6).value = { error: '#N/A' }
    ws.getRow(5).values = ['丁', null, null, null, null, '缺考'] // 没有任何分数
    ws.getRow(6).values = ['戊', null, null, null, null, null] // 汇总本来就是空白
    await wb.xlsx.writeFile(file)
    // 写入前：日期格式的汇总格在程序眼里读不出数值
    const rd0 = await excelService.readWorkbook(file)
    assert.strictEqual(rd0.data.members[1].f, null)
    const r = await excelService.applyIncrement(file, { targetCol: 2, deltas: { 丙: 1 } })
    assert(r.ok, r.error)
    assert.deepStrictEqual(r.data.summaryFixed.map(x => [x.name, x.to]), [['甲', 3], ['乙', 1], ['丙', 2], ['丁', 0]])
    assert.strictEqual(await cell(file, 2, 6), 3, '文字 → 数字')
    assert.strictEqual(await cell(file, 3, 6), 1, '日期 → 数字（读回来是数字而不是日期）')
    assert.strictEqual(await cell(file, 4, 6), 2, '错误值 → 数字')
    assert.strictEqual(await cell(file, 5, 6), 0, '文字 → 0（没有任何分数）')
    assert.strictEqual(await cell(file, 6, 6), null, '原来空白、算出来是 0：保持空白')
    const ws2 = await open(file)
    assert.strictEqual(ws2.getRow(3).getCell(6).numFmt || 'General', 'General', '日期格式的格子换成常规格式')
    // 再写一次：不会再把这几行重复报告成"原汇总与明细对不上"
    const again = await excelService.applyIncrement(file, { targetCol: 2, deltas: { 丙: 1 } })
    assert(again.ok, again.error)
    assert.deepStrictEqual(again.data.summaryFixed, [])
    const rd = await excelService.readWorkbook(file)
    assert.deepStrictEqual(rd.data.members.map(m => m.f), [3, 1, 3, 0, null])
  })
  await t('没有表头的表：照样能读、能写，新活动列落在第 8 列', async () => {
    const file = path.join(tmp, '没有表头.xlsx')
    await makeSmall(file, [])
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file)
    wb.worksheets[0].getRow(1).values = []
    wb.worksheets[0].getRow(2).values = ['甲', 1, null, null, null, null]
    await wb.xlsx.writeFile(file)
    const rd = await excelService.readWorkbook(file)
    assert(rd.ok, rd.error)
    assert.deepStrictEqual(rd.data.members.map(m => m.name), ['甲'])
    assert.deepStrictEqual(rd.data.activityColumns, [])
    const r = await excelService.commitEvent(file, { activityName: '首次活动', scores: { 甲: 2 } })
    assert(r.ok, r.error)
    assert.strictEqual(r.data.column, 8)
    assert.strictEqual(await cell(file, 1, 7), null)
    assert.strictEqual(await cell(file, 2, 8), 2)
    assert.strictEqual(await cell(file, 2, 6), 3)
  })
  await t('两行合一的合并表头：表头第二行不会被误当成队员，合并保留，读、改、新建都正常', async () => {
    const file = path.join(tmp, '合并表头.xlsx')
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Sheet1')
    ws.getRow(1).values = ['姓名', '夜训周训', '升降旗', '后勤', '综办', '汇总', null, '国庆出旗']
    ws.getRow(3).values = ['甲', 1, null, null, null, 1]
    for (const col of ['A', 'B', 'C', 'D', 'E', 'F', 'H']) ws.mergeCells(`${col}1:${col}2`)
    await wb.xlsx.writeFile(file)
    const rd = await excelService.readWorkbook(file)
    assert(rd.ok, rd.error)
    assert.deepStrictEqual(rd.data.headers.slice(0, 8).map(h => h || ''), ['姓名', '夜训周训', '升降旗', '后勤', '综办', '汇总', '', '国庆出旗'])
    assert.deepStrictEqual(rd.data.members.map(m => [m.name, m.row]), [['甲', 3]], '合并表头的第 2 行不应被误认成队员')
    assert.deepStrictEqual(rd.data.activityColumns.map(ac => ac.name), ['国庆出旗'])
    const edit = await excelService.applyEventEdit(file, { activityName: '国庆出旗', deltas: { 甲: 2 } })
    assert(edit.ok, edit.error)
    assert.strictEqual(await cell(file, 3, 8), 2)
    assert.strictEqual(await cell(file, 3, 6), 3)
    const created = await excelService.commitEvent(file, { activityName: '合并表头新活动', scores: { 甲: 1 } })
    assert(created.ok, created.error)
    assert.strictEqual(created.data.column, 9)
    assert.strictEqual(await cell(file, 1, 9), '合并表头新活动')
    assert.strictEqual(await cell(file, 3, 9), 1)
    assert.strictEqual(await cell(file, 3, 6), 4)
    const ws2 = await open(file)
    assert.deepStrictEqual(ws2.model.merges.slice().sort(), ['A1:A2', 'B1:B2', 'C1:C2', 'D1:D2', 'E1:E2', 'F1:F2', 'H1:H2'], '合并单元格应全部保留')
    // 撤销新建后表头里的"国庆出旗"回到第 8 列
    const undone = await excelService.deleteActivityColumn(file, { activityName: '合并表头新活动' })
    assert(undone.ok, undone.error)
    assert.deepStrictEqual(undone.data.summaryFixed, [])
    assert.strictEqual(await cell(file, 1, 8), '国庆出旗')
    assert.strictEqual(await cell(file, 3, 6), 3)
    assert.deepStrictEqual((await open(file)).model.merges.slice().sort(), ['A1:A2', 'B1:B2', 'C1:C2', 'D1:D2', 'E1:E2', 'F1:F2', 'H1:H2'])
  })
  await t('届别行的几种写法都能认出来，且不计入队员', async () => {
    const file = path.join(tmp, '届别写法.xlsx')
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('总积分')
    ws.getRow(1).values = HEADERS
    ;['--30届--', '-- 29 届 --', '--28届--\t', '--27届--', '-- 第 26 届 --'].forEach((text, i) => {
      ws.getRow(i * 2 + 2).getCell(1).value = text
      ws.getRow(i * 2 + 3).values = [`队员${i}`, 1, null, null, null, 1]
    })
    await wb.xlsx.writeFile(file)
    const rd = await excelService.readWorkbook(file)
    assert(rd.ok, rd.error)
    assert.deepStrictEqual(rd.data.members.map(m => [m.name, m.generation]), [['队员0', 30], ['队员1', 29], ['队员2', 28], ['队员3', 27], ['队员4', 26]])
  })
  await t('空文件、损坏的文件、不是工作簿的压缩包、没有工作表的文件、文件夹：都返回错误，不崩溃', async () => {
    const empty = path.join(tmp, '空文件.xlsx')
    fs.writeFileSync(empty, '')
    const garbage = path.join(tmp, '乱码.xlsx')
    fs.writeFileSync(garbage, Buffer.from('这不是一个 Excel 文件'.repeat(50)))
    const notWb = path.join(tmp, '不是工作簿.xlsx')
    const zip = new JSZip()
    zip.file('hello.txt', 'hello')
    fs.writeFileSync(notWb, await zip.generateAsync({ type: 'nodebuffer' }))
    const noSheet = path.join(tmp, '没有工作表.xlsx')
    await new ExcelJS.Workbook().xlsx.writeFile(noSheet)
    const folder = path.join(tmp, '我是文件夹.xlsx')
    fs.mkdirSync(folder)
    const bad = [empty, garbage, notWb, noSheet, folder]
    for (const [i, file] of bad.entries()) {
      const rd = await excelService.readWorkbook(file)
      assert(!rd.ok, `第 ${i + 1} 个坏文件不应被读成成功：${file}`)
      assert(rd.error, '应带说明文字')
      const wr = await excelService.commitEvent(file, { activityName: 'x', scores: { 甲: 1 } })
      assert(!wr.ok, `第 ${i + 1} 个坏文件不应被写成功：${file}`)
      const ex = await excelService.readExternal(file, 'count')
      assert(!ex.ok, `第 ${i + 1} 个坏文件不应被当成导入表：${file}`)
    }
    console.log('      各坏文件的报错：')
    for (const file of bad) {
      const rd = await excelService.readWorkbook(file)
      console.log(`        ${path.basename(file)} → ${rd.code}：${rd.error.slice(0, 90)}`)
    }
  })

  // ============ 7. 写入失败不留痕 ============
  console.log('\n[7] 写入失败不留痕迹')
  await t('备份目录建不出来（同级有个同名文件叫 .backups）：写入失败，表格原样、不留半成品', async () => {
    const dir = fs.mkdtempSync(path.join(tmp, '备份目录是文件-'))
    const file = path.join(dir, '总积分.xlsx')
    await makeSmall(file, [['甲', 1, null, null, null, 1]])
    fs.writeFileSync(path.join(dir, '.backups'), '我是一个普通文件')
    const before = snapshot(file)
    const r = await excelService.commitEvent(file, { activityName: '写不进去的活动', scores: { 甲: 1 } })
    assert(!r.ok, '应当写入失败')
    assert(r.error, '应带说明')
    assert.strictEqual(snapshot(file), before, '表格不应有任何改动')
    assert.deepStrictEqual(fs.readdirSync(dir).filter(f => f !== '.backups'), ['总积分.xlsx'], '不应留下临时文件')
    console.log(`      报错：${r.error.slice(0, 100)}`)
  })

  console.log(`\n${passed} 项测试通过${failed ? `，${failed} 项失败` : ''}`)
  if (process.exitCode) {
    console.log(`临时目录保留供排查: ${tmp}`)
  } else {
    fs.rmSync(tmp, { recursive: true, force: true })
    console.log('临时目录已清理')
  }
})().catch(e => { console.error(e); process.exit(1) })
