const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { app } = require('electron')

// 规范化一个路径：转成绝对路径，并在 Windows 上把盘符统一写成大写。
// 同一个文件，不同来源写出的盘符大小写可能不一样（文件对话框一般给 E:\，手工输入或某些环境给 e:\，
// 而 Node 的 path.resolve 会原样保留）。路径要参与"特征签名"的计算，还要用来判断
// "最近项目"里的两条记录是不是同一个项目，所以必须先统一写法
function normalizePath (p) {
  if (!p) return ''
  const abs = path.resolve(String(p))
  return process.platform === 'win32' ? abs.replace(/^[a-z]:/, m => m.toUpperCase()) : abs
}

// 把盘符换成另一种大小写写法（E:\ ↔ e:\），用来核对旧项目文件里的签名
function flipDriveCase (p) {
  return String(p || '').replace(/^[a-zA-Z]:/, m => (m === m.toUpperCase() ? m.toLowerCase() : m.toUpperCase()))
}

function signatureOf (excelPath) {
  const abs = normalizePath(excelPath)
  let stat = null
  try { stat = fs.statSync(abs) } catch (_) {}
  return crypto.createHash('md5').update(abs).digest('hex') + (stat ? `:${stat.size}` : '')
}

function defaultConfig (projectName, excelPath, configPath) {
  const now = new Date().toISOString()
  return {
    version: 1,
    projectName,
    createdAt: now,
    updatedAt: now,
    configPath: normalizePath(configPath),
    excelPath: normalizePath(excelPath),
    excelSignature: signatureOf(excelPath),
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

// 新建项目用的表格路径 = 所选目录 + 文件名。
// 文件名里去掉 Windows 不允许的字符和自带的 .xlsx 后缀，再统一补上 .xlsx。
function templateFilePath (dir, name) {
  const stem = String(name || '')
    .replace(/\.[xX][lL][sS][xX]?$/, '')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
  return path.join(dir, `${stem || '总积分表'}.xlsx`)
}

function createProject ({ projectName, excelPath, configPath }) {
  const cfg = defaultConfig(projectName, excelPath, configPath)
  fs.writeFileSync(cfg.configPath, JSON.stringify(cfg, null, 2), 'utf-8')
  return { ok: true, data: cfg }
}

function openProject (configPath) {
  try {
    if (!fs.existsSync(configPath)) return { ok: false, code: 'NOT_FOUND', error: '项目配置文件不存在' }
    let cfg
    try {
      cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    } catch (e) {
      return { ok: false, code: 'PARSE_FAIL', error: `这个文件不是有效的项目文件（JSON 解析失败：${e.message}）` }
    }
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg) || typeof cfg.excelPath !== 'string' || !cfg.excelPath.trim()) {
      return {
        ok: false,
        code: 'BAD_CONFIG',
        error: '这不是本软件的项目文件。请选择由本软件创建的 .json 项目配置；旧版软件留下的 .ghd.json 文件不兼容，请重新新建项目并关联原来的积分表。'
      }
    }
    cfg.configPath = normalizePath(configPath)
    cfg.excelPath = normalizePath(cfg.excelPath)
    if (!fs.existsSync(cfg.excelPath)) {
      return { ok: false, code: 'EXCEL_MISSING', error: `绑定的 Excel 文件不存在：${cfg.excelPath}` }
    }
    // 校验签名（只看"路径哈希"这一部分）。
    // 早期版本的项目文件可能是按小写盘符算出来的签名，所以盘符两种写法的哈希只要有一个对得上就算通过
    const recorded = String(cfg.excelSignature || '')
    const sigHash = signatureOf(cfg.excelPath).split(':')[0]
    // 注意这里不能调用 signatureOf：它会把盘符改回大写，算出来就和 sigHash 一样了
    const altHash = crypto.createHash('md5').update(flipDriveCase(cfg.excelPath)).digest('hex')
    if (recorded && !recorded.startsWith(sigHash) && !recorded.startsWith(altHash)) {
      return { ok: false, code: 'SIGNATURE_MISMATCH', error: 'Excel 文件特征签名不匹配，该配置文件可能绑定了其他表格' }
    }
    // 配置文件是普通的 JSON，可能被人在软件外面手动改过。下面这几项界面会直接遍历或取属性，
    // 类型不对就会让整个工作区打不开（白屏），所以在这里统一补成合法的形状。
    const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v)
    cfg.projectName = typeof cfg.projectName === 'string' && cfg.projectName.trim() ? cfg.projectName : '未命名项目'
    cfg.locks = isPlainObject(cfg.locks) ? cfg.locks : { is_logistics_imported: false, is_comprehensive_imported: false }
    cfg.settings = isPlainObject(cfg.settings) ? cfg.settings : {}
    const perSession = Number(cfg.settings.dailyTrainingScore)
    if (!(Number.isFinite(perSession) && perSession > 0)) cfg.settings.dailyTrainingScore = 1.0
    cfg.history = Array.isArray(cfg.history) ? cfg.history.filter(isPlainObject) : []
    return { ok: true, data: cfg }
  } catch (e) {
    return { ok: false, code: 'OPEN_FAIL', error: `项目配置打开失败：${e.message}` }
  }
}

// 先写临时文件再改名替换，避免写一半时崩溃留下损坏的配置文件
function saveProject (configPath, cfg) {
  const target = normalizePath(configPath)
  const tmp = `${target}.tmp-${process.pid}`
  try {
    const out = { ...cfg, configPath: target, updatedAt: new Date().toISOString() }
    fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf-8')
    fs.renameSync(tmp, target)
    return { ok: true, data: out }
  } catch (e) {
    try { fs.unlinkSync(tmp) } catch (_) {}
    // Windows 上"文件被别的程序开着、不让替换"报的是 EPERM / EBUSY，光看英文原话看不懂是怎么回事
    const occupied = e.code === 'EPERM' || e.code === 'EBUSY'
    const reason = occupied ? '配置文件正被其他程序占用（可能在别的软件里开着），请先关闭它再重试' : e.message
    return { ok: false, code: e.code || 'SAVE_FAIL', error: `项目配置保存失败：${reason}` }
  }
}

// ---------- 最近项目 ----------
function recentFile () { return path.join(app.getPath('userData'), 'recent.json') }

function readRecentList () {
  try {
    const list = JSON.parse(fs.readFileSync(recentFile(), 'utf-8'))
    if (!Array.isArray(list)) return []
    // 只保留形状完整的条目：这个文件是普通 JSON，可能在软件外面被手动改过
    return list.filter(x => x && typeof x === 'object' && typeof x.configPath === 'string')
  } catch (_) { return [] }
}

function listRecent () {
  // 表格和配置文件可能在软件外面被移动或删除，所以"是否仍然有效"每次读取时现算
  const list = readRecentList().map(item => ({
    ...item,
    valid: !!(item.configPath && item.excelPath && fs.existsSync(item.configPath) && fs.existsSync(item.excelPath))
  }))
  return { ok: true, data: list }
}

function pushRecent (cfg) {
  let list = readRecentList()
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
  const list = readRecentList().filter(x => normalizePath(x.configPath) !== normalizePath(configPath))
  try { fs.writeFileSync(recentFile(), JSON.stringify(list, null, 2), 'utf-8') } catch (_) {}
  return { ok: true }
}

module.exports = { createProject, openProject, saveProject, pushRecent, listRecent, removeRecent, templateFilePath, normalizePath }
