/* 项目生命周期测试（mock electron.app）：node tests/project.test.cjs */
const assert = require('assert')
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

  await t('锁：acquire 后 check 占用，release 后释放', async () => {
    const acq = lockService.acquire(excelPath, '2026秋季集训', configPath)
    assert(acq.ok, JSON.stringify(acq))
    const chk = lockService.check(excelPath)
    assert(chk.ok) // 本进程持有，视为可用
    lockService.release(excelPath)
    assert(!fs.existsSync(path.join(tmp, `.~总积分.xlsx.lock`)))
  })

  await t('saveProject 持久化 history 并更新 updatedAt', async () => {
    const opened = projectService.openProject(configPath).data
    opened.history.push({
      batchId: 'B1', timestamp: new Date().toISOString(), type: 'flag',
      objectKey: 'flag::B1', label: '升降旗导入', details: { 张三: 1.5 },
      meta: { rate: 0.5, targetCol: 3 }
    })
    const saved = projectService.saveProject(configPath, opened)
    assert(saved.ok, saved.error)
    const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    assert.strictEqual(onDisk.history.length, 1)
    assert(onDisk.updatedAt >= opened.createdAt)
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

  await t('openProject 对缺失 Excel 报 EXCEL_MISSING', async () => {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    cfg.excelPath = path.join(tmp, '不存在.xlsx')
    const p2 = path.join(tmp, 'broken.json')
    fs.writeFileSync(p2, JSON.stringify(cfg))
    const r = projectService.openProject(p2)
    assert(!r.ok && r.code === 'EXCEL_MISSING', JSON.stringify(r))
  })

  console.log(`\n${passed} 项测试通过${process.exitCode ? '（存在失败项）' : ''}`)
})().catch(e => { console.error(e); process.exit(1) })
