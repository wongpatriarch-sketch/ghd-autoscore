import React, { useMemo, useState } from 'react'
import { Modal, Badge } from '../components/ui.jsx'
import { makeBatchId, round1 } from '../lib/utils.js'
import { api } from '../lib/api.js'

const KINDS = {
  daily: { title: '日常训练考勤导入', targetCol: 2, colName: 'B 列（夜训周训）', mode: 'count', valueHeader: '总次数' },
  flag: { title: '升降旗考勤导入', targetCol: 3, colName: 'C 列（升降旗）', mode: 'count', valueHeader: '总次数' },
  department: { title: '部门积分导入', targetCol: 4, colName: 'D/E 列', mode: 'sandwich', valueHeader: '总积分' }
}

export default function BatchImport (ctx) {
  const { cfg } = ctx
  const [wizard, setWizard] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)

  const startImport = async (kind) => {
    const r = await api.openImportFileDialog()
    if (!r.ok || !r.data) return
    setBusy(true)
    const res = await api.readExternal(r.data, KINDS[kind].mode)
    setBusy(false)
    if (!res.ok) {
      ctx.showAlert(res.error || '导入文件解析失败')
      return
    }
    if (!res.data.entries.length) {
      ctx.showAlert('导入文件中没有解析到任何有效数据行（姓名列为空）')
      return
    }
    setWizard({
      kind,
      step: 'config',
      filePath: r.data,
      fileName: res.data.fileName,
      entries: res.data.entries,
      config: kind === 'flag'
        ? { rate: 0.5 }
        : kind === 'daily'
          ? { perSession: cfg.settings?.dailyTrainingScore ?? 1.0 }
          : { department: null },
      resolutions: {}
    })
  }

  const lockInfo = {
    logistics: cfg.locks?.is_logistics_imported,
    comprehensive: cfg.locks?.is_comprehensive_imported
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="text-xs text-zinc-500">
        统合外部表格导入与解析的通用向导。所有写入均为「预读 → 内存结算 → 预览确认 → 原子写回（含滚动备份）」，并生成可撤销的原子事务。
      </div>

      <div className="grid grid-cols-3 gap-4">
        <ImportCard
          icon="🌙"
          title="日常训练考勤"
          desc={`导入「姓名 / 总次数」考勤表，增量累加至 B 列（夜训周训）与 F 列（汇总）。当前单次训练分值：${cfg.settings?.dailyTrainingScore ?? 1} 分。`}
          onClick={() => startImport('daily')}
          busy={busy}
        />
        <ImportCard
          icon="🚩"
          title="升降旗考勤"
          desc="导入「姓名 / 总次数」考勤表，按日常（0.5 分/次）或节假日（1.0 分/次）倍率结算，增量累加至 C 列与 F 列。"
          onClick={() => startImport('flag')}
          busy={busy}
        />
        <ImportCard
          icon="🏢"
          title="部门专职积分"
          desc="导入后勤或综办统计表（首列姓名、尾列总积分，中间列自适应忽略），单次互斥：每个项目生命周期内每个部门仅可导入一次。"
          onClick={() => startImport('department')}
          busy={busy}
        />
      </div>

      {/* 部门互斥锁状态 */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-zinc-200 mb-3">部门积分互斥锁状态</h3>
        <div className="grid grid-cols-2 gap-4">
          <DeptLock name="后勤部（D 列）" locked={lockInfo.logistics} />
          <DeptLock name="综办部（E 列）" locked={lockInfo.comprehensive} />
        </div>
        <div className="text-[11px] text-zinc-500 mt-3">
          已导入的部门入口将锁定。如需修改，请前往【历史流水与撤销】撤销上一次操作后重新导入（撤销将自动重置锁）。
        </div>
      </div>

      {done && (
        <div className="fixed bottom-6 right-6 z-40 glass-strong rounded-xl px-5 py-4 max-w-sm border-emerald-500/30">
          <div className="text-sm text-emerald-300 font-medium">✓ {done.title}</div>
          <div className="text-[11px] text-zinc-400 mt-1.5 leading-relaxed">{done.text}</div>
          <button className="absolute top-2 right-3 text-zinc-500 hover:text-zinc-200 text-xs" onClick={() => setDone(null)}>✕</button>
        </div>
      )}

      {wizard && wizard.step === 'config' && (
        <ConfigModal
          wizard={wizard}
          lockInfo={lockInfo}
          update={(patch) => setWizard(w => ({ ...w, config: { ...w.config, ...patch } }))}
          onClose={() => setWizard(null)}
          onNext={() => setWizard(w => ({ ...w, step: 'preview' }))}
        />
      )}
      {wizard && wizard.step === 'preview' && (
        <PreviewModal
          wizard={wizard}
          busy={busy}
          roster={ctx.excel?.members || []}
          duplicateNames={ctx.excel?.duplicateNames || []}
          onClose={() => setWizard(null)}
          onBack={w => setWizard({ ...w, step: 'config' })}
          setWizard={setWizard}
          onDone={(title, text) => { setWizard(null); setDone({ title, text }) }}
          ctx={ctx}
        />
      )}
    </div>
  )
}

function ImportCard ({ icon, title, desc, onClick, busy }) {
  return (
    <button onClick={onClick} disabled={busy} className="card p-6 text-left hover:border-white/25 transition group disabled:opacity-50">
      <div className="w-11 h-11 rounded-xl bg-white/[0.06] border border-white/10 flex items-center justify-center text-xl mb-4 group-hover:scale-105 transition">{icon}</div>
      <div className="text-sm font-semibold text-zinc-100">{title}</div>
      <div className="text-[11px] text-zinc-500 mt-2 leading-relaxed">{desc}</div>
      <div className="text-xs text-accent mt-3 opacity-0 group-hover:opacity-100 transition">选择文件并导入 →</div>
    </button>
  )
}

function DeptLock ({ name, locked }) {
  return (
    <div className={`rounded-xl border px-4 py-3 flex items-center justify-between ${locked ? 'border-white/[0.06] bg-white/[0.02]' : 'border-emerald-500/25 bg-emerald-500/[0.06]'}`}>
      <span className={`text-sm ${locked ? 'text-zinc-500' : 'text-zinc-200'}`}>{name}</span>
      {locked
        ? <Badge tone="zinc">🔒 已导入锁定</Badge>
        : <Badge tone="green">开放</Badge>}
    </div>
  )
}

// ---------- 步骤 1：场景配置 ----------
function ConfigModal ({ wizard, lockInfo, update, onClose, onNext }) {
  const { kind, config, entries, fileName } = wizard
  const set = update

  const canNext = kind === 'department' ? !!config.department : true

  return (
    <Modal open onClose={onClose} title={`${KINDS[kind].title} · 已解析 ${fileName}`} width="max-w-lg">
      <div className="text-xs text-zinc-500 mb-4">成功解析 {entries.length} 行有效数据（已过滤姓名为空的行，空数值按 0 处理）。</div>

      {kind === 'flag' && (
        <div className="space-y-3">
          <label className="label">请选择本次导入的积分倍率 *</label>
          {[
            { v: 0.5, name: '选项 A：日常升降旗', desc: '单次记 0.5 分' },
            { v: 1.0, name: '选项 B：节假日升降旗', desc: '单次记 1.0 分' }
          ].map(opt => (
            <button
              key={opt.v}
              onClick={() => set({ rate: opt.v })}
              className={`w-full rounded-xl border p-4 text-left transition ${config.rate === opt.v ? 'border-accent/50 bg-accent/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'}`}
            >
              <div className="text-sm font-medium text-zinc-100">{opt.name}</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">{opt.desc}</div>
            </button>
          ))}
          <div className="text-[11px] text-zinc-500">核算公式：本次新增得分 = 总次数 × {config.rate}</div>
        </div>
      )}

      {kind === 'daily' && (
        <div>
          <label className="label">单次训练分值（全局配置）*</label>
          <input
            type="number" step="0.5" min="0" className="input w-40"
            value={config.perSession}
            onChange={e => set({ perSession: parseFloat(e.target.value) || 0 })}
          />
          <div className="text-[11px] text-zinc-500 mt-2">核算公式：本次新增得分 = 总次数 × 单次分值。该配置将随项目保存，默认为 1 次 = 1 分。</div>
        </div>
      )}

      {kind === 'department' && (
        <div className="space-y-3">
          <label className="label">请选择导入归属 *</label>
          {[
            { v: 'logistics', name: '后勤部', desc: '写入 D 列（后勤部）', disabled: lockInfo.logistics },
            { v: 'comprehensive', name: '综办部', desc: '写入 E 列（综办部）', disabled: lockInfo.comprehensive }
          ].map(opt => (
            <button
              key={opt.v}
              disabled={opt.disabled}
              onClick={() => set({ department: opt.v })}
              className={`w-full rounded-xl border p-4 text-left transition ${
                opt.disabled
                  ? 'border-white/[0.05] bg-white/[0.015] opacity-45 cursor-not-allowed'
                  : config.department === opt.v ? 'border-accent/50 bg-accent/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
              }`}
            >
              <div className="text-sm font-medium text-zinc-100">{opt.name}</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                {opt.disabled ? '该部门积分已导入。如需修改，请前往【历史记录】撤销上一次操作后重新导入' : opt.desc}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="mt-6 flex justify-end gap-3">
        <button className="btn-ghost" onClick={onClose}>取消</button>
        <button
          className="btn-primary"
          disabled={!canNext || (kind === 'department' && ((config.department === 'logistics' && lockInfo.logistics) || (config.department === 'comprehensive' && lockInfo.comprehensive)))}
          onClick={() => onNext()}
        >下一步：生成预览</button>
      </div>
    </Modal>
  )
}

// ---------- 步骤 2：预览与异常名单处理 ----------
function PreviewModal ({ wizard, busy, roster, duplicateNames, onClose, onBack, setWizard, onDone, ctx }) {
  const { kind, entries, config, fileName } = wizard
  const [submitting, setSubmitting] = useState(false)

  const rosterSet = useMemo(() => new Set(roster.map(m => m.name)), [roster])
  const dupSet = useMemo(() => new Set(duplicateNames), [duplicateNames])

  const multiplier = kind === 'flag' ? config.rate : kind === 'daily' ? config.perSession : 1

  const unknown = useMemo(() => [...new Set(entries.map(e => e.name).filter(n => !rosterSet.has(n)))], [entries, rosterSet])

  const resolutions = wizard.resolutions || {}
  const setResolution = (name, v) => setWizard(w => ({ ...w, resolutions: { ...w.resolutions, [name]: v } }))

  // 内存结算：在册人员按姓名聚合，未在册异常人员保持独立以便随时修改映射
  const rows = useMemo(() => {
    const map = new Map()
    for (const e of entries) {
      const isKnown = rosterSet.has(e.name)
      let name = e.name
      let status = 'ok'
      if (!isKnown) {
        const r = resolutions[e.name]
        if (!r || r === 'ignore') {
          status = 'ignored'
        } else {
          name = r
          status = 'mapped'
        }
      }
      // 在册人员以其花名册名字聚合；未在册异常人员以原始 rawName 保持独立，防止映射后行被合并消失
      const key = isKnown ? `roster::${e.name}` : `unknown::${e.name}`
      if (!map.has(key)) {
        map.set(key, { rawName: e.name, name, count: 0, status, isKnown })
      }
      map.get(key).count = round1(map.get(key).count + e.count)
    }
    return [...map.values()].map(r => ({ ...r, delta: round1(r.count * multiplier) }))
      .sort((a, b) => (a.status === 'ignored' ? 1 : 0) - (b.status === 'ignored' ? 1 : 0) || b.delta - a.delta)
  }, [entries, rosterSet, resolutions, multiplier])

  const effective = rows.filter(r => r.status !== 'ignored' && r.delta !== 0)

  const targetColOf = () => {
    if (kind === 'daily') return 2
    if (kind === 'flag') return 3
    return config.department === 'logistics' ? 4 : 5
  }

  const typeLabel = () => {
    if (kind === 'flag') return config.rate === 0.5 ? '日常升降旗' : '节假日升降旗'
    if (kind === 'daily') return `日常训练（${multiplier} 分/次）`
    return config.department === 'logistics' ? '后勤部' : '综办部'
  }

  const submit = async () => {
    if (!effective.length) { ctx.showAlert('没有任何有效加分记录（全部被忽略或增量为 0）', '无法提交'); return }
    setSubmitting(true)
    const deltas = {}
    for (const r of effective) deltas[r.name] = round1((deltas[r.name] || 0) + r.delta)

    const targetCol = targetColOf()
    const res = await api.applyIncrement(ctx.cfg.excelPath, { targetCol, deltas })
    if (!res.ok) {
      setSubmitting(false)
      ctx.showAlert(res.error || '写入失败')
      return
    }

    const batchId = makeBatchId()
    const deptName = config.department === 'logistics' ? '后勤部' : '综办部'
    const record = {
      batchId,
      timestamp: new Date().toISOString(),
      type: kind === 'department' ? 'department' : kind,
      objectKey: kind === 'department' ? `department::${config.department}` : `${kind}::${batchId}`,
      label: kind === 'department' ? `${deptName}积分导入` : `${KINDS[kind].title}（${typeLabel()}）`,
      details: deltas,
      meta: {
        source: '批量数据导入引擎',
        fileName,
        filePath: wizard.filePath,
        targetCol,
        memberCount: Object.keys(deltas).length,
        ...(kind === 'flag' ? { rate: config.rate } : {}),
        ...(kind === 'daily' ? { perSession: config.perSession } : {}),
        ...(kind === 'department' ? { department: config.department } : {})
      }
    }
    const saved = await ctx.updateConfig(c => {
      c.history.push(record)
      if (kind === 'department') {
        c.locks = c.locks || {}
        if (config.department === 'logistics') c.locks.is_logistics_imported = true
        else c.locks.is_comprehensive_imported = true
      }
      if (kind === 'daily') {
        c.settings = c.settings || {}
        c.settings.dailyTrainingScore = config.perSession
      }
      return c
    })
    setSubmitting(false)
    if (!saved) return
    await ctx.reloadExcel()
    onDone(
      `导入成功 · ${Object.keys(deltas).length} 人`,
      `批次 ${batchId} 已作为原子事务写入项目历史。若不慎导入重复文件，请前往【历史流水与撤销】模块一键撤销本批次操作。`
    )
  }

  return (
    <Modal open onClose={(submitting || busy) ? undefined : onClose} title={`${KINDS[kind].title} · 预览确认`} width="max-w-3xl" dismissable={!submitting}>
      <div className="flex items-center gap-3 text-xs text-zinc-500 mb-3 flex-wrap">
        <span>文件：{fileName}</span>
        <Badge tone="blue">{typeLabel()}</Badge>
        <span>目标：{kind === 'department' ? (config.department === 'logistics' ? 'D 列（后勤部）' : 'E 列（综办部）') : KINDS[kind].colName} + F 列（汇总）· 增量累加，空单元格按 0 运算</span>
      </div>

      {unknown.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300 mb-3">
          ⚠ 检测到 {unknown.length} 个姓名未在主表花名册中，请在下表标黄行选择【忽略】或【映射到正确姓名】。
        </div>
      )}

      <div className="rounded-xl border border-white/[0.08] overflow-hidden max-h-[46vh] overflow-y-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-surface-800">
            <tr className="border-b border-white/[0.08]">
              <th className="th">姓名</th>
              <th className="th text-right">{kind === 'department' ? '总积分' : '总次数'}</th>
              <th className="th">类型</th>
              <th className="th text-right">本次加分</th>
              <th className="th w-52">异常处理</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.rawName || i} className={`border-b border-white/[0.04] ${!r.isKnown ? 'bg-amber-500/[0.08]' : ''}`}>
                <td className="td">
                  {r.status === 'mapped' ? (
                    <span className="flex items-center gap-1.5 flex-wrap">
                      <span className="line-through text-zinc-500 text-xs">{r.rawName}</span>
                      <span className="text-zinc-400 text-xs">➔</span>
                      <span className="text-emerald-300 font-medium">{r.name}</span>
                    </span>
                  ) : (
                    <span className={r.status === 'ignored' ? 'text-zinc-500 line-through' : 'text-zinc-100'}>{r.name}</span>
                  )}
                  {dupSet.has(r.name) && r.status !== 'ignored' && <span className="ml-2"><Badge tone="amber">同名待核对</Badge></span>}
                </td>
                <td className="td text-right font-mono text-zinc-300">{r.count}</td>
                <td className="td text-zinc-400">{typeLabel()}</td>
                <td className={`td text-right font-mono font-bold ${r.status === 'ignored' ? 'text-zinc-600' : 'text-emerald-300'}`}>
                  {r.status === 'ignored' ? '跳过' : `+${r.delta}`}
                </td>
                <td className="td">
                  {!r.isKnown
                    ? (
                      <select
                        className="input !py-1 !text-xs w-full"
                        value={resolutions[r.rawName] || 'ignore'}
                        onChange={e => setResolution(r.rawName, e.target.value)}
                      >
                        <option value="ignore">忽略该人员</option>
                        {roster.map(m => <option key={m.name} value={m.name}>映射到：{m.name}</option>)}
                      </select>
                      )
                    : <span className="text-[11px] text-zinc-600">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="text-xs text-zinc-500">
          实际写入 <b className="text-zinc-200">{new Set(effective.map(r => r.name)).size}</b> 人，合计 <b className="text-emerald-300">+{round1(effective.reduce((a, b) => a + b.delta, 0))}</b> 分
        </div>
        <div className="flex gap-3">
          <button className="btn-ghost" onClick={() => onBack(wizard)} disabled={submitting}>上一步</button>
          <button className="btn-ghost" onClick={onClose} disabled={submitting}>取消</button>
          <button className="btn-primary" onClick={submit} disabled={submitting}>{submitting ? '写入中…' : '确认导入并落盘'}</button>
        </div>
      </div>
    </Modal>
  )
}
