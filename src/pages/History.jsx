import React, { useMemo, useState } from 'react'
import { Modal, Badge, ConfirmModal, Empty } from '../components/ui.jsx'
import { computeStatusMap, currentScoresOf, TYPE_LABELS } from '../lib/historyStack.js'
import { fmtTime, makeBatchId, round1 } from '../lib/utils.js'
import { api } from '../lib/api.js'

export default function HistoryCenter ({ cfg, excel, reloadExcel, updateConfig, showAlert }) {
  const [expanded, setExpanded] = useState(null)
  const [confirmUndo, setConfirmUndo] = useState(null)
  const [editRec, setEditRec] = useState(null)
  const [busy, setBusy] = useState(false)

  const history = cfg.history || []
  const statusMap = useMemo(() => computeStatusMap(history), [history])
  const ordered = useMemo(() => [...history].reverse(), [history])

  const markUndone = async (record, extraMutate) => {
    const saved = await updateConfig(c => {
      const rec = c.history.find(r => r.batchId === record.batchId)
      if (rec) rec.status = 'undone'
      if (extraMutate) extraMutate(c)
      return c
    })
    return !!saved
  }

  const performUndo = async (record) => {
    setBusy(true)
    setConfirmUndo(null)
    let res
    const deltas = record.details || {}
    const neg = Object.fromEntries(Object.entries(deltas).map(([k, v]) => [k, round1(-v)]))

    if (record.type === 'event_create') {
      // 撤销初次创建：F 反向扣减 + 物理删除活动列
      res = await api.deleteActivityColumn(cfg.excelPath, { activityName: record.label, deltas })
    } else if (record.type === 'event_edit') {
      // 撤销修改：反向差值扣减，恢复上一版本
      res = await api.applyEventEdit(cfg.excelPath, { activityName: record.label, deltas: neg })
    } else {
      // 考勤/部门：目标列与 F 列反向扣减
      const targetCol = record.meta?.targetCol || (record.type === 'daily' ? 2 : record.type === 'flag' ? 3 : 4)
      res = await api.applyIncrement(cfg.excelPath, { targetCol, deltas: neg })
    }

    if (!res.ok) {
      setBusy(false)
      showAlert(res.error || '撤销写入失败')
      return
    }

    const ok = await markUndone(record, c => {
      if (record.type === 'department' && record.meta?.department) {
        c.locks = c.locks || {}
        if (record.meta.department === 'logistics') c.locks.is_logistics_imported = false
        else c.locks.is_comprehensive_imported = false
      }
    })
    setBusy(false)
    if (ok) await reloadExcel()
  }

  const statusBadge = (s) => {
    if (s === 'active') return <Badge tone="green">活跃</Badge>
    if (s === 'locked') return <Badge tone="zinc">🔒 锁定</Badge>
    return <Badge tone="red">已撤销</Badge>
  }

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="text-xs text-zinc-500 leading-relaxed">
        同一操作对象（如某次大型活动）的所有操作构成线性版本栈：仅栈顶最新记录为【活跃】可修改/撤销，其下历史记录自动【锁定】；栈顶被撤销后，上一级自动解锁成为新栈顶。
      </div>

      <div className="card overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-white/[0.08] bg-white/[0.02]">
              <th className="th w-10"></th>
              <th className="th">操作时间</th>
              <th className="th">操作类型</th>
              <th className="th">操作对象 / 关联活动</th>
              <th className="th text-right">涉及总人数</th>
              <th className="th">状态</th>
              <th className="th text-right w-44">操作</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map(rec => {
              const st = statusMap[rec.batchId] || 'active'
              const isEvent = rec.type === 'event_create' || rec.type === 'event_edit'
              const isOpen = expanded === rec.batchId
              return (
                <React.Fragment key={rec.batchId}>
                  <tr className={`border-b border-white/[0.04] hover:bg-white/[0.03] transition ${st === 'undone' ? 'opacity-50' : ''}`}>
                    <td className="td">
                      <button
                        onClick={() => setExpanded(isOpen ? null : rec.batchId)}
                        className="text-zinc-500 hover:text-zinc-200 transition text-xs"
                      >{isOpen ? '▼' : '▶'}</button>
                    </td>
                    <td className="td font-mono text-xs text-zinc-400">{fmtTime(rec.timestamp)}</td>
                    <td className="td">
                      <span className="text-zinc-200">{TYPE_LABELS[rec.type] || rec.type}</span>
                      {rec.meta?.fileName && <div className="text-[10px] text-zinc-500 mt-0.5">源文件：{rec.meta.fileName}</div>}
                    </td>
                    <td className="td text-zinc-300">
                      {rec.label}
                      {rec.meta?.rate !== undefined && <span className="ml-2"><Badge tone="blue">倍率 ×{rec.meta.rate}</Badge></span>}
                      {rec.meta?.perSession !== undefined && <span className="ml-2"><Badge tone="blue">{rec.meta.perSession} 分/次</Badge></span>}
                    </td>
                    <td className="td text-right font-mono text-zinc-300">{rec.meta?.memberCount ?? Object.keys(rec.details || {}).length}</td>
                    <td className="td">{statusBadge(st)}</td>
                    <td className="td text-right">
                      <div className="inline-flex gap-2">
                        {isEvent && st === 'active' && (
                          <button className="btn-ghost !px-3 !py-1.5 text-xs" disabled={busy} onClick={() => setEditRec(rec)}>修改</button>
                        )}
                        <button
                          className="btn-danger !px-3 !py-1.5 text-xs"
                          disabled={busy || st !== 'active'}
                          title={st === 'locked' ? '仅栈顶（最新）记录可撤销' : ''}
                          onClick={() => setConfirmUndo(rec)}
                        >撤销</button>
                      </div>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-white/[0.04] bg-white/[0.02]">
                      <td></td>
                      <td colSpan={6} className="px-3 py-3">
                        <div className="text-[11px] text-zinc-500 mb-2">
                          批次号：<span className="font-mono">{rec.batchId}</span> · 来源：{rec.meta?.source || '—'}
                          {rec.meta?.headCoaches && <> · 主教官：{rec.meta.headCoaches.join('、')}</>}
                          {rec.meta?.trainingCount !== undefined && <> · 训练 {rec.meta.trainingCount} 次 / 彩排 {rec.meta.rehearsalCount} 次 / 正式时长 {rec.meta.formalHours}h</>}
                        </div>
                        <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                          {Object.entries(rec.details || {}).map(([n, v]) => (
                            <span key={n} className={`text-[11px] px-2 py-1 rounded-md border font-mono ${v >= 0 ? 'border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-300' : 'border-red-500/20 bg-red-500/[0.07] text-red-300'}`}>
                              {n} {v >= 0 ? '+' : ''}{round1(v)}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
            {ordered.length === 0 && <tr><td colSpan={7}><Empty text="暂无历史流水记录" /></td></tr>}
          </tbody>
        </table>
      </div>

      <ConfirmModal
        open={!!confirmUndo}
        title="确认撤销该批次？"
        danger
        confirmText="确认撤销"
        message={confirmUndo
          ? `将执行反向数据回滚：${confirmUndo.type === 'event_create' ? `从 F 列扣除全部分值，并在 Excel 中物理删除「${confirmUndo.label}」整列（右侧列自动左移）。` : confirmUndo.type === 'event_edit' ? `在「${confirmUndo.label}」活动列与 F 列执行反向差值扣减，恢复到上一版本状态。` : `在对应列与 F 列反向扣除本批次全部分值。`}${confirmUndo.type === 'department' ? '同时释放对应部门的互斥锁，入口将重新点亮。' : ''} 撤销前会自动滚动备份 Excel。`
          : ''}
        onCancel={() => setConfirmUndo(null)}
        onConfirm={() => performUndo(confirmUndo)}
      />

      {editRec && (
        <EditRecordModal
          record={editRec}
          history={history}
          roster={excel?.members || []}
          duplicateNames={excel?.duplicateNames || []}
          cfg={cfg}
          busy={busy}
          setBusy={setBusy}
          showAlert={showAlert}
          onClose={() => setEditRec(null)}
          onDone={async () => { setEditRec(null); await reloadExcel() }}
          updateConfig={updateConfig}
        />
      )}
    </div>
  )
}

// ---------- 操作 A：部分修改（差值运算 Delta Update） ----------
function EditRecordModal ({ record, history, roster, duplicateNames, cfg, busy, setBusy, showAlert, onClose, onDone, updateConfig }) {
  // 自动加载该活动所有成员当时的积分情况（含历次修改累加）
  const baseScores = useMemo(() => currentScoresOf(history, record.objectKey), [history, record])
  const [values, setValues] = useState(() => Object.fromEntries(Object.entries(baseScores).map(([k, v]) => [k, v])))
  const [addName, setAddName] = useState('')
  const [addScore, setAddScore] = useState(1)

  const dupSet = new Set(duplicateNames)
  const rosterNames = roster.map(m => m.name)
  const notIncluded = rosterNames.filter(n => !(n in values))

  const addMember = () => {
    if (!addName || addName in values) return
    setValues(v => ({ ...v, [addName]: round1(Number(addScore) || 0) }))
    setAddName('')
  }

  const submit = async () => {
    setBusy(true)
    // 差值 = 新分数 - 旧分数
    const deltas = {}
    for (const [name, val] of Object.entries(values)) {
      const d = round1((Number(val) || 0) - (baseScores[name] || 0))
      if (d !== 0) deltas[name] = d
    }
    if (!Object.keys(deltas).length) {
      setBusy(false)
      showAlert('没有检测到任何分数变动', '无变动')
      return
    }
    const res = await api.applyEventEdit(cfg.excelPath, { activityName: record.label, deltas })
    if (!res.ok) {
      setBusy(false)
      showAlert(res.error || '写入失败')
      return
    }
    const editRecord = {
      batchId: makeBatchId(),
      timestamp: new Date().toISOString(),
      type: 'event_edit',
      objectKey: record.objectKey,
      label: record.label,
      details: deltas,
      meta: {
        source: `修改自批次 ${record.batchId}`,
        memberCount: Object.keys(deltas).length,
        baseBatchId: record.batchId
      }
    }
    const saved = await updateConfig(c => { c.history.push(editRecord); return c })
    setBusy(false)
    if (saved) onDone()
  }

  return (
    <Modal open onClose={busy ? undefined : onClose} title={`部分修改 · ${record.label}`} width="max-w-2xl" dismissable={!busy}>
      <div className="text-xs text-zinc-500 mb-4 leading-relaxed">
        已加载该活动所有成员当时的积分情况。直接修改分数后提交，程序将按「差值 = 新分数 − 旧分数」在 Excel 活动列与 F 列增量累加，并作为一条全新的修改记录追加到历史（原记录即刻锁定）。
      </div>
      <div className="rounded-xl border border-white/[0.08] overflow-hidden max-h-[42vh] overflow-y-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-surface-800">
            <tr className="border-b border-white/[0.08]">
              <th className="th">姓名</th>
              <th className="th text-right w-28">原分数</th>
              <th className="th text-right w-32">新分数</th>
              <th className="th text-right w-24">差值</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(values).sort().map(name => {
              const oldV = baseScores[name] || 0
              const newV = Number(values[name]) || 0
              const d = round1(newV - oldV)
              return (
                <tr key={name} className="border-b border-white/[0.04]">
                  <td className="td">
                    {name}
                    {dupSet.has(name) && <span className="ml-2"><Badge tone="amber">同名待核对</Badge></span>}
                  </td>
                  <td className="td text-right font-mono text-zinc-400">{round1(oldV)}</td>
                  <td className="td text-right">
                    <input
                      type="number" step="0.5" className="input !py-1 !text-right font-mono w-24 ml-auto"
                      value={values[name]}
                      onChange={e => setValues(v => ({ ...v, [name]: e.target.value }))}
                    />
                  </td>
                  <td className={`td text-right font-mono font-bold ${d > 0 ? 'text-emerald-300' : d < 0 ? 'text-red-300' : 'text-zinc-600'}`}>
                    {d === 0 ? '—' : `${d > 0 ? '+' : ''}${d}`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-end gap-2">
        <div className="flex-1">
          <label className="label">补充遗漏成员（可选）</label>
          <select className="input" value={addName} onChange={e => setAddName(e.target.value)}>
            <option value="">— 选择花名册中未包含的队员 —</option>
            {notIncluded.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="w-28">
          <label className="label">分数</label>
          <input type="number" step="0.5" className="input" value={addScore} onChange={e => setAddScore(e.target.value)} />
        </div>
        <button className="btn-ghost shrink-0" onClick={addMember} disabled={!addName}>添加</button>
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <button className="btn-ghost" onClick={onClose} disabled={busy}>取消</button>
        <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? '写入中…' : '提交差值修改'}</button>
      </div>
    </Modal>
  )
}
