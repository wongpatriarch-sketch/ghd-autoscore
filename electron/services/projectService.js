const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { app } = require('electron')

function normalizePath (p) {
  if (!p) return ''
  let abs = path.resolve(p)
  if (process.platform === 'win32') {
    abs = abs.replace(/^[a-zA-Z]:/, m => m.toUpperCase())
  }
  return abs
}

function signatureOf (excelPath) {
  const abs = normalizePath(excelPath)
  let stat = null
  try { stat = fs.statSync(abs) } catch (_) {}
  return crypto.createHash('md5').update(abs).digest('hex') + (stat ? `:${stat.size}` : '')
}

function defaultConfig (projectName, excelPath, configPath) {
  const now = new Date().toISOString()
  const normExcel = normalizePath(excelPath)
  const normConfig = normalizePath(configPath)
  return {
    version: 1,
    projectName,
    createdAt: now,
    updatedAt: now,
    configPath: normConfig,
    excelPath: normExcel,
    excelSignature: signatureOf(normExcel),
    settings: {
      dailyTrainingScore: 1.0
    },
    locks: {
      is_logistics_imported: false,
      is_comprehensive_imported: false
    },
    history: []
  }
}

function createProject ({ projectName, excelPath, configPath }) {
  const cfg = defaultConfig(projectName, excelPath, configPath)
  fs.writeFileSync(cfg.configPath, JSON.stringify(cfg, null, 2), 'utf-8')
  return { ok: true, data: cfg }
}

function openProject (configPath) {
  try {
    const normConfig = normalizePath(configPath)
    if (!fs.existsSync(normConfig)) return { ok: false, code: 'NOT_FOUND', error: '项目配置文件不存在' }
    const cfg = JSON.parse(fs.readFileSync(normConfig, 'utf-8'))
    cfg.configPath = normConfig
    if (!cfg.excelPath) return { ok: false, code: 'BAD_CONFIG', error: '项目配置缺少 Excel 绑定路径' }
    cfg.excelPath = normalizePath(cfg.excelPath)
    if (!fs.existsSync(cfg.excelPath)) {
      return { ok: false, code: 'EXCEL_MISSING', error: `绑定的 Excel 文件不存在：${cfg.excelPath}` }
    }
    // 校验签名（路径哈希部分，支持 Windows 盘符大小写双向容错）
    const sigHash = signatureOf(cfg.excelPath).split(':')[0]
    const altPath = cfg.excelPath.replace(/^[a-zA-Z]:/, m => (m === m.toUpperCase() ? m.toLowerCase() : m.toUpperCase()))
    const altSigHash = crypto.createHash('md5').update(altPath).digest('hex')
    const matches = String(cfg.excelSignature).startsWith(sigHash) || String(cfg.excelSignature).startsWith(altSigHash)
    if (cfg.excelSignature && !matches) {
      return { ok: false, code: 'SIGNATURE_MISMATCH', error: 'Excel 文件特征签名不匹配，该配置文件可能绑定了其他表格' }
    }
    cfg.locks = cfg.locks || { is_logistics_imported: false, is_comprehensive_imported: false }
    cfg.settings = cfg.settings || { dailyTrainingScore: 1.0 }
    cfg.history = cfg.history || []
    return { ok: true, data: cfg }
  } catch (e) {
    return { ok: false, code: 'PARSE_FAIL', error: `项目配置解析失败：${e.message}` }
  }
}

function saveProject (configPath, cfg) {
  try {
    const normConfig = normalizePath(configPath)
    const out = { ...cfg, configPath: normConfig, updatedAt: new Date().toISOString() }
    const tmp = `${normConfig}.tmp-${process.pid}`
    fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf-8')
    fs.renameSync(tmp, normConfig)
    return { ok: true, data: out }
  } catch (e) {
    return { ok: false, code: 'SAVE_FAIL', error: `项目配置保存失败：${e.message}` }
  }
}

// ---------- 最近项目 ----------
function recentFile () { return path.join(app.getPath('userData'), 'recent.json') }

function listRecent () {
  try {
    const list = JSON.parse(fs.readFileSync(recentFile(), 'utf-8'))
    return { ok: true, data: list }
  } catch (_) { return { ok: true, data: [] } }
}

function pushRecent (cfg) {
  let list = []
  try { list = JSON.parse(fs.readFileSync(recentFile(), 'utf-8')) } catch (_) {}
  list = list.filter(x => normalizePath(x.configPath) !== normalizePath(cfg.configPath))
  list.unshift({
    projectName: cfg.projectName,
    configPath: normalizePath(cfg.configPath),
    excelPath: normalizePath(cfg.excelPath),
    lastOpened: new Date().toISOString(),
    valid: fs.existsSync(cfg.configPath) && fs.existsSync(cfg.excelPath)
  })
  list = list.slice(0, 12)
  try { fs.writeFileSync(recentFile(), JSON.stringify(list, null, 2), 'utf-8') } catch (_) {}
}

function removeRecent (configPath) {
  let list = []
  try { list = JSON.parse(fs.readFileSync(recentFile(), 'utf-8')) } catch (_) {}
  list = list.filter(x => normalizePath(x.configPath) !== normalizePath(configPath))
  try { fs.writeFileSync(recentFile(), JSON.stringify(list, null, 2), 'utf-8') } catch (_) {}
  return { ok: true }
}

module.exports = { createProject, openProject, saveProject, pushRecent, listRecent, removeRecent }
