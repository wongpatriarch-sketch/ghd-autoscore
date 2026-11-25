import React, { useEffect, useState } from 'react'
import logoUrl from '../assets/logo.png'
import { api } from '../lib/api.js'
import { Modal, Spinner, Badge } from '../components/ui.jsx'
import { IconFolder, IconHistory } from '../components/icons.jsx'
import { fmtTime } from '../lib/utils.js'

export default function ProjectHub ({ onOpened, showAlert, loading }) {
  const [recent, setRecent] = useState([])
  const [showNew, setShowNew] = useState(false)
  const [busy, setBusy] = useState(false)

  const refreshRecent = async () => {
    const res = await api.listRecent()
    if (res.ok) setRecent(res.data || [])
  }
  useEffect(() => { refreshRecent() }, [])

  const openProject = async (configPath) => {
    setBusy(true)
    const res = await api.openProject(configPath)
    setBusy(false)
    if (!res.ok) {
      showAlert(res.error || '项目打开失败')
      refreshRecent() // 打不开时表格可能已被移走，刷新一下"是否失效"的标记
      return
    }
    onOpened(res.data)
  }

  const removeRecent = async (configPath, e) => {
    e.stopPropagation()
    await api.removeRecent(configPath)
    refreshRecent()
  }

  return (
    <div className="h-full flex flex-col">
      {/* 顶栏 */}
      <header className="flex items-center gap-3 px-8 py-5 border-b border-white/[0.06]">
        <img src={logoUrl} alt="logo" className="w-9 h-9 rounded-lg" />
        <div>
          <div className="text-sm font-semibold text-zinc-100 tracking-wide">国护积分管理</div>
          <div className="text-[11px] text-zinc-500">Guard of Honor · AutoScore</div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 py-10 grid grid-cols-[1fr_1.4fr] gap-8">
          {/* 左：核心入口 */}
          <div className="space-y-5">
            <div>
              <h1 className="text-2xl font-bold text-zinc-50 leading-snug">欢迎回来</h1>
              <p className="text-sm text-zinc-500 mt-1.5">以项目工程为单位，管理你的国旗护卫队积分数据。</p>
            </div>

            <button
              onClick={() => setShowNew(true)}
              className="w-full card p-6 text-left group hover:border-accent/40 transition cursor-pointer"
            >
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent text-xl group-hover:scale-105 transition">＋</div>
                <div>
                  <div className="font-semibold text-zinc-100">新建项目</div>
                  <div className="text-xs text-zinc-500 mt-0.5">创建工程文件，关联或初始化主积分表格</div>
                </div>
              </div>
            </button>

            <button
              onClick={async () => {
                const r = await api.openProjectFileDialog()
                if (r.ok && r.data) openProject(r.data)
              }}
              className="w-full card p-6 text-left group hover:border-white/25 transition cursor-pointer"
            >
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-white/[0.06] border border-white/10 flex items-center justify-center text-zinc-300 group-hover:scale-105 transition"><IconFolder className="w-5 h-5" /></div>
                <div>
                  <div className="font-semibold text-zinc-100">打开项目</div>
                  <div className="text-xs text-zinc-500 mt-0.5">打开本软件保存的 .json 项目文件</div>
                </div>
              </div>
            </button>

            {busy && <div className="pt-2"><Spinner text="正在载入项目…" /></div>}
          </div>

          {/* 右：最近项目 */}
          <div className="card p-6 flex flex-col min-h-[420px]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-zinc-300">最近项目</h2>
              <Badge tone="zinc">{recent.length}</Badge>
            </div>
            <div className="flex-1 overflow-y-auto -mx-2 px-2">
              {recent.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-zinc-600 text-sm gap-2 py-16">
                  <IconHistory className="w-8 h-8 opacity-50" />
                  暂无最近项目
                </div>
              )}
              <div className="space-y-2.5">
                {recent.map(item => {
                  const invalid = item.valid === false
                  return (
                    <div
                      key={item.configPath}
                      onClick={() => !invalid && !busy && openProject(item.configPath)}
                      className={`rounded-xl border p-4 transition group ${
                        invalid
                          ? 'border-white/[0.05] bg-white/[0.015] opacity-55 cursor-not-allowed'
                          : 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.07] hover:border-white/20 cursor-pointer'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-zinc-100 truncate flex items-center gap-2">
                            {item.projectName}
                            {invalid && <Badge tone="red">失效</Badge>}
                          </div>
                          <div className="text-[11px] text-zinc-500 truncate mt-1" title={item.excelPath}>
                            表格：{item.excelPath}
                          </div>
                          <div className="text-[11px] text-zinc-600 mt-0.5">最后打开：{fmtTime(item.lastOpened)}</div>
                        </div>
                        <button
                          onClick={(e) => removeRecent(item.configPath, e)}
                          title="从列表清除"
                          className="shrink-0 text-zinc-600 hover:text-red-400 transition px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100"
                        >✕</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      <NewProjectModal
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreated={(cfg) => { setShowNew(false); onOpened(cfg) }}
        showAlert={showAlert}
      />
      {loading && (
        <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm flex items-center justify-center">
          <div className="glass-strong rounded-2xl px-8 py-6"><Spinner text="正在读取主表格数据…" /></div>
        </div>
      )}
    </div>
  )
}

function NewProjectModal ({ open, onClose, onCreated, showAlert }) {
  const [name, setName] = useState('')
  const [mode, setMode] = useState('existing') // existing | template
  const [excelPath, setExcelPath] = useState('')
  const [templateDir, setTemplateDir] = useState('')
  const [templateName, setTemplateName] = useState('')
  const [configPath, setConfigPath] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName(''); setMode('existing'); setExcelPath(''); setTemplateDir(''); setTemplateName(''); setConfigPath(''); setBusy(false)
    }
  }, [open])

  // 新表格的文件名：没单独填时就沿用项目名称（完整路径由主进程拼接，这里只做展示）
  const templateFileName = (templateName.trim() || name.trim()).replace(/\.[xX][lL][sS][xX]?$/, '')

  const pickConfigPath = async () => {
    const r = await api.saveProjectFileDialog(name || '未命名项目')
    if (r.ok && r.data) setConfigPath(r.data)
  }

  const submit = async () => {
    if (!name.trim()) { showAlert('请输入项目名称', '信息不完整'); return }
    if (mode === 'existing' && !excelPath) { showAlert('请选择要关联的 Excel 表格', '信息不完整'); return }
    if (mode === 'template' && (!templateDir || !templateFileName)) { showAlert('请选择新表格的保存文件夹，并填写表格文件名', '信息不完整'); return }
    if (!configPath) { showAlert('请选择项目工程配置文件（.json）的保存位置', '信息不完整'); return }
    setBusy(true)
    const res = await api.createProject({
      projectName: name.trim(),
      mode,
      excelPath: mode === 'existing' ? excelPath : undefined,
      templateDir: mode === 'template' ? templateDir : undefined,
      templateName: mode === 'template' ? templateFileName : undefined,
      configPath
    })
    setBusy(false)
    if (!res.ok) {
      showAlert(res.error || '项目创建失败')
      return
    }
    onCreated(res.data)
  }

  return (
    <Modal open={open} onClose={busy ? undefined : onClose} title="新建项目" width="max-w-xl" dismissable={!busy}>
      <div className="space-y-5">
        <div>
          <label className="label">项目名称 *</label>
          <input className="input" placeholder="如：2026秋季集训积分" value={name} onChange={e => setName(e.target.value)} />
        </div>

        <div>
          <label className="label">主数据表格（总积分 .xlsx）*</label>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <button
              onClick={() => setMode('existing')}
              className={`rounded-xl border p-3.5 text-left transition ${mode === 'existing' ? 'border-accent/50 bg-accent/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'}`}
            >
              <div className="text-sm font-medium text-zinc-100">关联已有表格</div>
              <div className="text-[11px] text-zinc-500 mt-1">直接绑定本地已有的总积分表</div>
            </button>
            <button
              onClick={() => setMode('template')}
              className={`rounded-xl border p-3.5 text-left transition ${mode === 'template' ? 'border-accent/50 bg-accent/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'}`}
            >
              <div className="text-sm font-medium text-zinc-100">按模板初始化新建</div>
              <div className="text-[11px] text-zinc-500 mt-1">生成一张和正式积分表同格式的空表并绑定</div>
            </button>
          </div>

          {mode === 'existing'
            ? (
              <div className="flex gap-2">
                <input className="input flex-1" readOnly placeholder="点击右侧按钮选择 .xlsx 文件" value={excelPath} />
                <button className="btn-ghost shrink-0" onClick={async () => {
                  const r = await api.openExcelDialog()
                  if (r.ok && r.data) setExcelPath(r.data)
                }}>选择文件</button>
              </div>
              )
            : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input className="input flex-1" readOnly placeholder="选择保存文件夹" value={templateDir} />
                  <button className="btn-ghost shrink-0" onClick={async () => {
                    const r = await api.selectDirectoryDialog()
                    if (r.ok && r.data) setTemplateDir(r.data)
                  }}>选择文件夹</button>
                </div>
                <input className="input" placeholder="新表格文件名（留空则与项目同名）" value={templateName} onChange={e => setTemplateName(e.target.value)} />
                {templateDir && templateFileName && <div className="text-[11px] text-zinc-500 break-all">将在所选文件夹中创建：{templateFileName}.xlsx</div>}
                <div className="text-[11px] text-zinc-600 leading-relaxed">
                  表头、列宽、冻结窗格与届别行（--30届-- 至 --26届--）均与正式积分表一致，第 7 列留作空白分隔列；队员名单请在 Excel 里照常填写。
                </div>
              </div>
              )}
        </div>

        <div>
          <label className="label">项目工程配置文件（.json）保存位置 *</label>
          <div className="flex gap-2">
            <input className="input flex-1" readOnly placeholder="点击右侧按钮选择保存位置" value={configPath} />
            <button className="btn-ghost shrink-0" onClick={pickConfigPath}>浏览…</button>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>取消</button>
          <button className="btn-primary" onClick={submit} disabled={busy}>
            {busy ? '创建中…' : '创建并进入项目'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
