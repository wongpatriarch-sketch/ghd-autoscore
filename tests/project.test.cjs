/* 项目生命周期测试（mock electron.app）：node tests/project.test.cjs
 * 全部使用临时目录，不接触任何真实项目文件。 */
const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const os = require('os')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ghd-proj-'))
const userData = path.join(tmp, 'userData')
fs.mkdirSync(userData, { recursive: true })

// 在 require projectService 之前注入 electron mock
const electronPath = require.resolve('electron')
require.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: { app: { getPath: () => userData } }
}

const projectService = require('../electron/services/projectService')
const excelService = require('../electron/services/excelService')
const lockService = require('../electron/services/lockService')

;(async () => {
  let passed = 0
  const t = async (name, fn) => {
    try { await fn(); passed++; console.log(`  ✓ ${name}`) } catch (e) {
      console.error(`  ✗ ${name}\n    ${e.message}`)
      process.exitCode = 1
    }
  }

  const excelPath = path.join(tmp, '总积分.xlsx')
  const configPath = path.join(tmp, '2026秋季集训.json')
  await excelService.createTemplate(excelPath)

  await t('createProject 生成配置（含 history/locks/settings）', async () => {
    const r = projectService.createProject({ projectName: '2026秋季集训', excelPath, configPath })
    assert(r.ok, r.error)
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    assert.strictEqual(cfg.projectName, '2026秋季集训')
    assert.deepStrictEqual(cfg.history, [])
    assert.strictEqual(cfg.locks.is_logistics_imported, false)
    assert(cfg.excelSignature)
  })

  await t('openProject 读取并校验签名', async () => {
    const r = projectService.openProject(configPath)
    assert(r.ok, r.error)
    assert.strictEqual(r.data.excelPath, path.resolve(excelPath))
  })

  await t('templateFilePath：目录 + 文件名 → 合法路径（补扩展名、去非法字符）', () => {
    const dir = path.join(tmp, '新文件夹')
    assert.strictEqual(projectService.templateFilePath(dir, '积分表'), path.join(dir, '积分表.xlsx'))
    assert.strictEqual(projectService.templateFilePath(dir, '积分表.XLSX'), path.join(dir, '积分表.xlsx'))
    assert.strictEqual(projectService.templateFilePath(dir, 'a:b/c*d?e"f<g>h|i'), path.join(dir, 'abcdefghi.xlsx'))
    assert.strictEqual(projectService.templateFilePath(dir, '   '), path.join(dir, '总积分表.xlsx'))
  })

  await t('openProject 对不是项目文件的 JSON 给出明确提示', () => {
    const old = path.join(tmp, 'old.ghd.json')
    fs.writeFileSync(old, JSON.stringify({ name: '旧版', path: 'C:/x.xlsx' }))
    const r = projectService.openProject(old)
    assert(!r.ok && r.code === 'BAD_CONFIG', JSON.stringify(r))
    assert(/不是本软件的项目文件/.test(r.error), r.error)

    const broken = path.join(tmp, 'broken.json')
    fs.writeFileSync(broken, '{ not json')
    const r2 = projectService.openProject(broken)
    assert(!r2.ok && r2.code === 'PARSE_FAIL', JSON.stringify(r2))
  })

  await t('锁：acquire 后 check 占用，release 后释放', async () => {
    const acq = lockService.acquire(excelPath, '2026秋季集训', configPath)
    assert(acq.ok, JSON.stringify(acq))
    const chk = lockService.check(excelPath)
    assert(chk.ok) // 本进程持有，视为可用
    lockService.release(excelPath)
    assert(!fs.existsSync(path.join(tmp, '.~总积分.xlsx.lock')))
  })

  await t('锁：残留的锁文件（对应进程已不存在）不阻塞', () => {
    const lp = path.join(tmp, '.~总积分.xlsx.lock')
    fs.writeFileSync(lp, JSON.stringify({ pid: 99999999, projectName: '早已退出的项目', excelPath }))
    try {
      const chk = lockService.check(excelPath)
      assert(chk.ok, JSON.stringify(chk))
    } finally {
      fs.unlinkSync(lp)
    }
  })

  await t('saveProject 持久化 history 并更新 updatedAt', async () => {
    const opened = projectService.openProject(configPath).data
    opened.history.push({
      batchId: 'B1', timestamp: new Date().toISOString(), type: 'flag',
      objectKey: 'flag::B1', label: '升降旗导入', details: { 张三: 1.5 },
      meta: { rate: 0.5, targetCol: 3 }
    })
    const saved = await projectService.saveProject(configPath, opened)
    assert(saved.ok, saved.error)
    const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    assert.strictEqual(onDisk.history.length, 1)
    assert(onDisk.updatedAt >= opened.createdAt)
  })

  await t('saveProject 失败时不留下临时文件', async () => {
    const bad = path.join(tmp, '不存在的目录', 'x.json')
    const r = await projectService.saveProject(bad, { projectName: 'x' })
    assert(!r.ok, '应失败')
    assert(!fs.existsSync(`${bad}.tmp-${process.pid}`), '不应留下临时文件')
  })

  await t('saveProject：路径不是字符串时直接拒绝，不在别处留下文件', async () => {
    const before = fs.readdirSync(process.cwd())
    for (const bad of [undefined, null, 123, '', '   ', { a: 1 }, ['x.json']]) {
      const r = await projectService.saveProject(bad, { projectName: 'x' })
      assert(!r.ok && r.code === 'BAD_PATH', JSON.stringify(bad))
      assert(/路径/.test(r.error), r.error)
    }
    assert.deepStrictEqual(fs.readdirSync(process.cwd()), before, '当前目录里不应多出任何文件')
    lockService.release(undefined) // 释放锁时传入不是路径的参数也不应抛异常
    lockService.release(123)
  })

  // 后面两个"替换文件"的测试在一份配置副本上做，免得改动了主配置、影响后面的最近项目测试
  const retryCfg = path.join(tmp, '重试保存.json')
  fs.copyFileSync(configPath, retryCfg)

  await t('saveProject：要保存的内容不是一份完整的配置时拒绝保存，不覆盖原来的项目文件', async () => {
    const before = fs.readFileSync(configPath, 'utf-8')
    for (const bad of [undefined, null, 'text', 123, [], { projectName: 'x' }, { ...JSON.parse(before), excelPath: '  ' }]) {
      const r = await projectService.saveProject(configPath, bad)
      assert(!r.ok && r.code === 'BAD_CONFIG', `传入 ${JSON.stringify(bad)} 时应拒绝：${JSON.stringify(r)}`)
      assert(/没有保存/.test(r.error), r.error)
    }
    assert.strictEqual(fs.readFileSync(configPath, 'utf-8'), before, '磁盘上的项目文件应原样不动')
    assert.deepStrictEqual(fs.readdirSync(tmp).filter(f => f.includes('.tmp-')), [], '不应留下临时文件')
  })

  await t('saveProject：替换文件时被"一闪而过"地占用（EPERM），稍等重试后保存成功', async () => {
    const realRename = fs.renameSync
    let fails = 2
    fs.renameSync = (a, b) => {
      if (fails > 0) { fails--; throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' }) }
      return realRename(a, b)
    }
    try {
      const opened = projectService.openProject(retryCfg).data
      opened.projectName = '重试后保存'
      const r = await projectService.saveProject(retryCfg, opened)
      assert(r.ok, r.error)
      assert.strictEqual(fails, 0, '应当重试到成功为止')
      assert.strictEqual(JSON.parse(fs.readFileSync(retryCfg, 'utf-8')).projectName, '重试后保存')
    } finally {
      fs.renameSync = realRename
    }
    assert.deepStrictEqual(fs.readdirSync(tmp).filter(f => f.includes('.tmp-')), [], '不应留下临时文件')
  })

  await t('saveProject：文件一直被占用时重试几次后放弃，报出"被占用"并且不留下临时文件', async () => {
    const realRename = fs.renameSync
    let calls = 0
    fs.renameSync = () => { calls++; throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' }) }
    try {
      const opened = projectService.openProject(retryCfg).data
      const r = await projectService.saveProject(retryCfg, opened)
      assert(!r.ok && r.code === 'EPERM', JSON.stringify(r))
      assert(/被其他程序占用/.test(r.error), r.error)
      assert(calls >= 3, `应当重试多次，实际调用了 ${calls} 次`)
    } finally {
      fs.renameSync = realRename
    }
    assert.deepStrictEqual(fs.readdirSync(tmp).filter(f => f.includes('.tmp-')), [], '不应留下临时文件')
    assert.strictEqual(JSON.parse(fs.readFileSync(retryCfg, 'utf-8')).projectName, '重试后保存', '保存失败时磁盘上的配置文件应保持原样')
  })

  await t('锁：表格是只读属性时，报"只读"而不是"被占用"', async () => {
    const ro = path.join(tmp, '只读表格.xlsx')
    await excelService.createTemplate(ro)
    fs.chmodSync(ro, 0o444) // Windows 上等于勾选"只读"属性
    try {
      const probe = lockService.probeWritable(ro)
      assert(!probe.ok && probe.reason === 'readonly', JSON.stringify(probe))
      const acq = lockService.acquire(ro, '只读项目', configPath)
      assert(!acq.ok && acq.reason === 'readonly', JSON.stringify(acq))
      const w = await excelService.applyIncrement(ro, { targetCol: 2, deltas: { 甲: 1 } })
      assert(!w.ok && w.code === 'EREADONLY', JSON.stringify(w))
      assert(/只读/.test(w.error), w.error)
    } finally {
      fs.chmodSync(ro, 0o666)
    }
    assert.strictEqual(lockService.probeWritable(ro).ok, true, '取消只读后应当可写')
  })

  await t('占用检测：被别的程序独占（EBUSY）、一闪而过的 EPERM 都报"被占用"；带只读属性或没有权限才报"只读"', async () => {
    const ro = path.join(tmp, '占用检测.xlsx')
    await excelService.createTemplate(ro)
    // 不真的去占用文件：把"打开"换成直接抛出指定的错误
    const realOpen = fs.openSync
    const fake = code => (p, flags, mode) => {
      if (p === ro) throw Object.assign(new Error(`fake ${code}`), { code })
      return realOpen(p, flags, mode)
    }
    try {
      fs.openSync = fake('EBUSY')
      assert.strictEqual(lockService.probeWritable(ro).reason, 'busy', 'Excel / WPS 开着表格时报 EBUSY')
      fs.openSync = fake('EPERM')
      assert.strictEqual(lockService.probeWritable(ro).reason, 'busy', '文件不是只读：EPERM 是杀毒软件 / 索引服务一闪而过的占用')
      fs.chmodSync(ro, 0o444)
      assert.strictEqual(lockService.probeWritable(ro).reason, 'readonly', '文件带只读属性：同样是 EPERM，报"只读"')
      fs.chmodSync(ro, 0o666)
      fs.openSync = fake('EACCES')
      assert.strictEqual(lockService.probeWritable(ro).reason, 'readonly', '没有写入权限：提示里也带着这一条')
      fs.openSync = fake('EISDIR')
      assert.strictEqual(lockService.probeWritable(ro).ok, true, '别的错误不下结论，留给后面的读写去报告')
    } finally {
      fs.openSync = realOpen
      fs.chmodSync(ro, 0o666)
    }
  })

  await t('最近项目：push/list/remove', async () => {
    const cfg = projectService.openProject(configPath).data
    projectService.pushRecent(cfg)
    let list = projectService.listRecent().data
    assert.strictEqual(list.length, 1)
    assert.strictEqual(list[0].projectName, '2026秋季集训')
    assert.strictEqual(list[0].valid, true)
    projectService.removeRecent(configPath)
    list = projectService.listRecent().data
    assert.strictEqual(list.length, 0)
  })

  await t('最近项目：表格在软件外面被移走后，valid 在读取时重新判断', () => {
    const cfg = projectService.openProject(configPath).data
    projectService.pushRecent(cfg)
    assert.strictEqual(projectService.listRecent().data[0].valid, true)
    fs.renameSync(excelPath, `${excelPath}.moved`)
    try {
      assert.strictEqual(projectService.listRecent().data[0].valid, false)
    } finally {
      fs.renameSync(`${excelPath}.moved`, excelPath)
    }
    assert.strictEqual(projectService.listRecent().data[0].valid, true)
    projectService.removeRecent(configPath)
  })

  await t('盘符大小写：路径统一成大写盘符；早期按小写盘符算出的签名也能通过（仅 Windows）', async () => {
    if (process.platform !== 'win32') return
    assert(/^[A-Z]:/.test(configPath), `测试用的临时路径应是大写盘符：${configPath}`)
    const lower = p => p.replace(/^[A-Z]:/, m => m.toLowerCase())
    const md5 = p => crypto.createHash('md5').update(p).digest('hex')

    // 1）新建项目时给的是小写盘符的路径：配置里记下的仍是大写盘符
    const dir = path.join(tmp, '大小写')
    fs.mkdirSync(dir, { recursive: true })
    const excel2 = path.join(dir, '积分表.xlsx')
    await excelService.createTemplate(excel2)
    const cfg2 = path.join(dir, '项目.json')
    const created = projectService.createProject({ projectName: '盘符大小写', excelPath: lower(excel2), configPath: lower(cfg2) })
    assert(created.ok, created.error)
    assert.strictEqual(created.data.excelPath, excel2, '表格路径应统一成大写盘符')
    assert.strictEqual(created.data.configPath, cfg2, '配置路径应统一成大写盘符')
    assert.strictEqual(created.data.excelSignature.split(':')[0], md5(excel2))

    // 2）用小写盘符打开同一个项目文件：正常打开，路径规范成大写
    const opened = projectService.openProject(lower(cfg2))
    assert(opened.ok, opened.error)
    assert.strictEqual(opened.data.excelPath, excel2)
    assert.strictEqual(opened.data.configPath, cfg2)

    // 3）模拟早期版本留下的项目文件：签名是按小写盘符的路径算的
    const cfg = JSON.parse(fs.readFileSync(cfg2, 'utf-8'))
    cfg.excelSignature = md5(lower(excel2))
    fs.writeFileSync(cfg2, JSON.stringify(cfg))
    const legacy = projectService.openProject(cfg2)
    assert(legacy.ok, `按小写盘符算出的签名应能通过：${legacy.error}`)

    // 4）签名对应的是别的表格：照样拦截
    cfg.excelSignature = md5(path.join(dir, '别的表格.xlsx'))
    fs.writeFileSync(cfg2, JSON.stringify(cfg))
    const bad = projectService.openProject(cfg2)
    assert(!bad.ok && bad.code === 'SIGNATURE_MISMATCH', JSON.stringify(bad))

    // 5）最近项目：同一个项目用两种盘符写法打开，只记一条；用小写盘符也能把它移除
    const base = projectService.openProject(configPath).data
    projectService.removeRecent(configPath)
    projectService.pushRecent(base)
    projectService.pushRecent({ ...base, configPath: lower(configPath), excelPath: lower(excelPath) })
    const list = projectService.listRecent().data
    assert.strictEqual(list.length, 1, '同一个项目的两种盘符写法只应记一条')
    assert.strictEqual(list[0].configPath, configPath)
    projectService.removeRecent(lower(configPath))
    assert.strictEqual(projectService.listRecent().data.length, 0, '用小写盘符也应能移除这条记录')
  })

  await t('openProject 对缺失 Excel 报 EXCEL_MISSING', async () => {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    cfg.excelPath = path.join(tmp, '不存在.xlsx')
    const p2 = path.join(tmp, 'broken.json')
    fs.writeFileSync(p2, JSON.stringify(cfg))
    const r = projectService.openProject(p2)
    assert(!r.ok && r.code === 'EXCEL_MISSING', JSON.stringify(r))
  })

  await t('openProject 对被手动改坏的配置补成合法形状（不让工作区一打开就报错）', () => {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    Object.assign(cfg, { projectName: 123, locks: 'x', settings: null, history: { a: 1 } })
    const p = path.join(tmp, '改坏的配置.json')
    fs.writeFileSync(p, JSON.stringify(cfg))
    const r = projectService.openProject(p)
    assert(r.ok, r.error)
    assert.strictEqual(r.data.projectName, '未命名项目')
    assert.deepStrictEqual(r.data.history, [])
    assert.strictEqual(r.data.settings.dailyTrainingScore, 1)
    assert.deepStrictEqual(r.data.locks, { is_logistics_imported: false, is_comprehensive_imported: false })
  })

  await t('单次训练分值被改成 0 / 文字时，打开项目后退回默认的 1 分', () => {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    for (const bad of [0, -1, 'abc']) {
      cfg.settings = { dailyTrainingScore: bad }
      const p = path.join(tmp, '分值改坏的配置.json')
      fs.writeFileSync(p, JSON.stringify(cfg))
      const r = projectService.openProject(p)
      assert(r.ok, r.error)
      assert.strictEqual(r.data.settings.dailyTrainingScore, 1, `存的是 ${JSON.stringify(bad)} 时应退回 1`)
    }
  })

  await t('最近项目文件被改坏时不崩溃，只丢弃字段不完整的条目', () => {
    fs.writeFileSync(path.join(userData, 'recent.json'), JSON.stringify([null, { projectName: '没有路径' }, 'x']))
    const list = projectService.listRecent()
    assert(list.ok)
    assert.deepStrictEqual(list.data, [])
    fs.writeFileSync(path.join(userData, 'recent.json'), '{ not json')
    assert.deepStrictEqual(projectService.listRecent().data, [])
  })

  console.log(`\n${passed} 项测试通过${process.exitCode ? '（存在失败项）' : ''}`)
  if (process.exitCode) {
    console.log(`临时目录保留供排查: ${tmp}`)
  } else {
    fs.rmSync(tmp, { recursive: true, force: true })
    console.log('临时目录已清理')
  }
})().catch(e => { console.error(e); process.exit(1) })
