import React, { useMemo, useState } from 'react'
import { Modal, Badge } from '../components/ui.jsx'
import { parseNames, makeBatchId, round1 } from '../lib/utils.js'
import { api } from '../lib/api.js'

const HOURS_OPTIONS = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0]
let cardSeq = 1
const newCard = () => ({ id: cardSeq++, hours: 1.0, coaches: '', participants: '' })

export default function EventScoring ({ cfg, excel, reloadExcel, updateConfig, showAlert }) {
  const [activityName, setActivityName] = useState('')
  const [headCoaches, setHeadCoaches] = useState('')
  const [trainings, setTrainings] = useState([])
  const [rehearsals, setRehearsals] = useState([newCard()])
  const [formal, setFormal] = useState({ hours: 1.0, participants: '', stageCrew: '' })

  const [unknownModal, setUnknownModal] = useState(null) // { names: [], resolutions: {} }
  const [preview, setPreview] = useState(null) // { rows, scores }
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')

  const roster = useMemo(() => (excel?.members || []).map(m => m.name), [excel])
  const rosterSet = useMemo(() => new Set(roster), [roster])
  const dupSet = useMemo(() => new Set(excel?.duplicateNames || []), [excel])

  const setTraining = (id, patch) => setTrainings(ts => ts.map(t => t.id === id ? { ...t, ...patch } : t))
  const setRehearsal = (id, patch) => setRehearsals(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r))

  // 汇总本次表单涉及的所有人名（含来源标签）
  const collectAllNames = () => {
    const items = [] // { name, source }
    const push = (text, source) => parseNames(text).forEach(n => items.push({ name: n, source }))
    push(headCoaches, '主教官')
    trainings.forEach((t, i) => { push(t.coaches, `训练${i + 1}教官`); push(t.participants, `训练${i + 1}参训`) })
    rehearsals.forEach((r, i) => { push(r.coaches, `彩排${i + 1}教官`); push(r.participants, `彩排${i + 1}参训`) })
    push(formal.participants, '正式参加')
    push(formal.stageCrew, '正式场务')
    return items
  }

  const validate = () => {
    setFormError('')
    const trimmed = activityName.trim()
    if (!trimmed) return '请填写活动名称（将作为 Excel 新列表头）'
    if (excel?.headers?.slice(0, 6)?.includes(trimmed)) {
      return `「${trimmed}」与主表前 6 列固定列名冲突，不能用作活动名称`
    }
    const heads = parseNames(headCoaches)
    if (heads.length < 1 || heads.length > 5) return '主教官需填写 1~5 位人名，不能为空'
    if (trainings.some(t => !parseNames(t.coaches).length && !parseNames(t.participants).length)) return '存在完全空的训练卡片，请补充名单或删除该卡片'
    if (rehearsals.some(r => !parseNames(r.coaches).length && !parseNames(r.participants).length)) return '存在完全空的彩排卡片，请补充名单或删除该卡片'
    if (!parseNames(formal.participants).length) return '正式活动「参加」名单不能为空'
    if (excel?.activityColumns?.some(c => c.name === trimmed)) return `主表中已存在同名活动列「${trimmed}」，请更换活动名称`
    return ''
  }

  // 计算积分（resolutions: 未知名 -> null 忽略 / 字符串映射）
  const computeScores = (resolutions = {}) => {
    const resolve = (name) => {
      if (rosterSet.has(name)) return name
      const r = resolutions[name]
      return r ? r : null // 未处理或忽略 -> null
    }
    const parts = {} // name -> { head, training, rehearsal, formal, stage }
    const add = (rawName, key, val) => {
      const name = resolve(rawName)
      if (!name) return
      if (!parts[name]) parts[name] = { head: 0, training: 0, rehearsal: 0, formal: 0, stage: 0 }
      parts[name][key] = round1(parts[name][key] + val)
    }
    parseNames(headCoaches).forEach(n => add(n, 'head', 2.0))
    trainings.forEach(t => {
      parseNames(t.coaches).forEach(n => add(n, 'training', t.hours))
      parseNames(t.participants).forEach(n => add(n, 'training', t.hours))
    })
    rehearsals.forEach(r => {
      parseNames(r.coaches).forEach(n => add(n, 'rehearsal', r.hours))
      parseNames(r.participants).forEach(n => add(n, 'rehearsal', r.hours))
    })
    parseNames(formal.participants).forEach(n => add(n, 'formal', formal.hours))
    parseNames(formal.stageCrew).forEach(n => add(n, 'stage', 0.5))

    const rows = Object.entries(parts).map(([name, p]) => {
      const total = round1(p.head + p.training + p.rehearsal + p.formal + p.stage)
      return { name, ...p, total, duplicate: dupSet.has(name) }
    }).sort((a, b) => b.total - a.total)
    const scores = {}
    rows.forEach(r => { if (r.total) scores[r.name] = r.total })
    return { rows, scores }
  }

  const onGeneratePreview = () => {
    const err = validate()
    if (err) { setFormError(err); return }
    const items = collectAllNames()
    const unknown = [...new Set(items.map(i => i.name).filter(n => !rosterSet.has(n)))]
    if (unknown.length) {
      setUnknownModal({
        names: unknown,
        sources: unknown.map(n => items.filter(i => i.name === n).map(i => i.source).join(' / ')),
        resolutions: Object.fromEntries(unknown.map(n => [n, 'ignore']))
      })
      return
    }
    setPreview(computeScores({}))
  }

  const confirmUnknown = () => {
    const resolutions = {}
    for (const [n, v] of Object.entries(unknownModal.resolutions)) {
      resolutions[n] = v === 'ignore' ? null : v
    }
    setUnknownModal(null)
    setPreview(computeScores(resolutions))
  }

  const onCommit = async () => {
    setBusy(true)
    const res = await api.commitEvent(cfg.excelPath, { activityName: activityName.trim(), scores: preview.scores })
    if (!res.ok) {
      setBusy(false)
      showAlert(res.error || '写入失败')
      return
    }
    const record = {
      batchId: makeBatchId(),
      timestamp: new Date().toISOString(),
      type: 'event_create',
      objectKey: `event::${activityName.trim()}`,
      label: activityName.trim(),
      details: preview.scores,
      meta: {
        source: '活动积分结算引擎',
        headCoaches: parseNames(headCoaches),
        trainingCount: trainings.length,
        rehearsalCount: rehearsals.length,
        formalHours: formal.hours,
        memberCount: Object.keys(preview.scores).length
      }
    }
    const saved = await updateConfig(c => { c.history.push(record); return c })
    setBusy(false)
    if (!saved) return
    await reloadExcel()
    setPreview(null)
    setActivityName(''); setHeadCoaches('')
    setTrainings([]); setRehearsals([newCard()])
    setFormal({ hours: 1.0, participants: '', stageCrew: '' })
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5 pb-24">
      {/* 全局表头信息 */}
      <section className="card p-6">
        <h2 className="text-sm font-semibold text-zinc-200 mb-4">全局表头信息</h2>
        <div className="grid grid-cols-2 gap-5">
          <div>
            <label className="label">活动名称 *（将作为 Excel 新建列的表头）</label>
            <input className="input" placeholder="如：国庆出旗" value={activityName} onChange={e => setActivityName(e.target.value)} />
          </div>
          <div>
            <label className="label">主教官 *（1~5 位，用逗号/顿号/空格分隔，每人 +2.0 分）</label>
            <input className="input" placeholder="如：张三，李四" value={headCoaches} onChange={e => setHeadCoaches(e.target.value)} />
            <div className="text-[11px] text-zinc-500 mt-1.5">
              已识别 {parseNames(headCoaches).length} 位：{parseNames(headCoaches).join('、') || '—'}
            </div>
          </div>
        </div>
        {formError && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-300">⚠ {formError}</div>
        )}
      </section>

      {/* 训练卡片 */}
      <CardSection
        title="训练环节"
        hint="按训练时长计分：1 小时 = 1.0 分。可全部删空（该活动无单独训练）。"
        count={trainings.length}
        onAdd={() => setTrainings(t => [...t, newCard()])}
      >
        {trainings.map((t, i) => (
          <ScoreCard
            key={t.id}
            index={i + 1}
            unitLabel={`第 ${i + 1} 次训练`}
            hours={t.hours}
            coaches={t.coaches}
            participants={t.participants}
            participantLabel="参训"
            onHours={v => setTraining(t.id, { hours: v })}
            onCoaches={v => setTraining(t.id, { coaches: v })}
            onParticipants={v => setTraining(t.id, { participants: v })}
            onRemove={() => setTrainings(ts => ts.filter(x => x.id !== t.id))}
          />
        ))}
        {trainings.length === 0 && <div className="text-xs text-zinc-600 py-3 text-center">暂无训练卡片，点击右上角 ＋ 新增</div>}
      </CardSection>

      {/* 彩排卡片 */}
      <CardSection
        title="彩排环节"
        hint="按彩排时长计分：1 小时 = 1.0 分。至少保留 1 张彩排卡片。"
        count={rehearsals.length}
        onAdd={() => setRehearsals(r => [...r, newCard()])}
      >
        {rehearsals.map((r, i) => (
          <ScoreCard
            key={r.id}
            index={i + 1}
            unitLabel={`第 ${i + 1} 次彩排`}
            hours={r.hours}
            coaches={r.coaches}
            participants={r.participants}
            participantLabel="参训"
            onHours={v => setRehearsal(r.id, { hours: v })}
            onCoaches={v => setRehearsal(r.id, { coaches: v })}
            onParticipants={v => setRehearsal(r.id, { participants: v })}
            onRemove={rehearsals.length > 1 ? () => setRehearsals(rs => rs.filter(x => x.id !== r.id)) : null}
          />
        ))}
      </CardSection>

      {/* 正式活动卡片（单例） */}
      <CardSection title="正式出旗环节（单例，不可增删）" hint="参加人员按活动时长计分；场务人员固定 +0.5 分（与时长无关）。">
        <div className="card p-5 space-y-4">
          <div className="flex items-center gap-4">
            <span className="text-xs font-semibold text-zinc-300">正式活动</span>
            <HoursSelect value={formal.hours} onChange={v => setFormal(f => ({ ...f, hours: v }))} label="活动时长" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">参加 *（长文本人名串）</label>
              <textarea className="input min-h-[72px] resize-y" placeholder="支持逗号、顿号、空格、换行分隔" value={formal.participants} onChange={e => setFormal(f => ({ ...f, participants: e.target.value }))} />
              <NameChips names={parseNames(formal.participants)} rosterSet={rosterSet} />
            </div>
            <div>
              <label className="label">场务（可为空，每人固定 +0.5 分）</label>
              <textarea className="input min-h-[72px] resize-y" placeholder="支持逗号、顿号、空格、换行分隔" value={formal.stageCrew} onChange={e => setFormal(f => ({ ...f, stageCrew: e.target.value }))} />
              <NameChips names={parseNames(formal.stageCrew)} rosterSet={rosterSet} />
            </div>
          </div>
        </div>
      </CardSection>

      {/* 底部操作栏 */}
      <div className="fixed bottom-0 left-60 right-0 px-8 py-4 bg-surface-900/85 backdrop-blur-xl border-t border-white/[0.06] z-30">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="text-xs text-zinc-500">
            训练 {trainings.length} 张 · 彩排 {rehearsals.length} 张 · 正式 1 张
          </div>
          <button className="btn-primary px-6" onClick={onGeneratePreview} disabled={busy}>生成预览</button>
        </div>
      </div>

      {/* 未知名预警（黄色） */}
      {unknownModal && (
        <Modal open onClose={() => setUnknownModal(null)} title="名单校验预警" width="max-w-xl">
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300 mb-4">
            检测到以下人名未在名单库中，请选择【忽略该人员】或【修正为人名库中的队员】。
          </div>
          <div className="space-y-3">
            {unknownModal.names.map((n, i) => (
              <div key={n} className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-amber-200">{n}</div>
                  <div className="text-[11px] text-zinc-500 truncate">来源：{unknownModal.sources[i]}</div>
                </div>
                <select
                  className="input w-56 !py-1.5"
                  value={unknownModal.resolutions[n]}
                  onChange={e => setUnknownModal(m => ({ ...m, resolutions: { ...m.resolutions, [n]: e.target.value } }))}
                >
                  <option value="ignore">忽略该人员</option>
                  {roster.map(rn => <option key={rn} value={rn}>修正为：{rn}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="mt-5 flex justify-end gap-3">
            <button className="btn-ghost" onClick={() => setUnknownModal(null)}>返回修改</button>
            <button className="btn-primary" onClick={confirmUnknown}>确认并继续</button>
          </div>
        </Modal>
      )}

      {/* 预览确认 */}
      {preview && (
        <Modal open onClose={busy ? undefined : () => setPreview(null)} title={`结算预览 · ${activityName.trim()}`} width="max-w-3xl" dismissable={!busy}>
          <div className="text-xs text-zinc-500 mb-3">
            共 {preview.rows.length} 人。确认后将在主表最右侧追加「{activityName.trim()}」列，并同步 F 列汇总（写入前自动滚动备份）。
          </div>
          <div className="rounded-xl border border-white/[0.08] overflow-hidden max-h-[46vh] overflow-y-auto">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-surface-800">
                <tr className="border-b border-white/[0.08]">
                  <th className="th">姓名</th>
                  <th className="th text-right">主教官</th>
                  <th className="th text-right">训练</th>
                  <th className="th text-right">彩排</th>
                  <th className="th text-right">正式</th>
                  <th className="th text-right">场务</th>
                  <th className="th text-right">合计</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map(r => (
                  <tr key={r.name} className="border-b border-white/[0.04]">
                    <td className="td">
                      {r.name}
                      {r.duplicate && <span className="ml-2"><Badge tone="amber">同名待核对</Badge></span>}
                    </td>
                    <td className="td text-right font-mono text-zinc-400">{r.head || '—'}</td>
                    <td className="td text-right font-mono text-zinc-400">{r.training || '—'}</td>
                    <td className="td text-right font-mono text-zinc-400">{r.rehearsal || '—'}</td>
                    <td className="td text-right font-mono text-zinc-400">{r.formal || '—'}</td>
                    <td className="td text-right font-mono text-zinc-400">{r.stage || '—'}</td>
                    <td className="td text-right font-mono font-bold text-zinc-50">+{r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-5 flex justify-end gap-3">
            <button className="btn-ghost" onClick={() => setPreview(null)} disabled={busy}>返回修改</button>
            <button className="btn-primary" onClick={onCommit} disabled={busy}>{busy ? '写入中…' : '确认写入 Excel'}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function CardSection ({ title, hint, count, onAdd, children }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-200">{title}{count !== undefined && <span className="ml-2 text-zinc-500 font-normal">（{count} 张）</span>}</h2>
          {hint && <div className="text-[11px] text-zinc-500 mt-0.5">{hint}</div>}
        </div>
        {onAdd && (
          <button onClick={onAdd} className="btn-ghost !px-3 !py-1.5 text-base leading-none" title="新增卡片">＋</button>
        )}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function ScoreCard ({ unitLabel, hours, coaches, participants, participantLabel, onHours, onCoaches, onParticipants, onRemove }) {
  return (
    <div className="card p-5 relative group">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-semibold text-zinc-300">{unitLabel}</span>
        <div className="flex items-center gap-3">
          <HoursSelect value={hours} onChange={onHours} />
          {onRemove && (
            <button onClick={onRemove} className="w-7 h-7 rounded-lg border border-white/10 bg-white/[0.05] text-zinc-400 hover:text-red-400 hover:border-red-500/40 transition text-sm leading-none" title="删除本卡片">－</button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">教官</label>
          <textarea className="input min-h-[64px] resize-y" placeholder="人名串，支持逗号、顿号、空格、换行分隔" value={coaches} onChange={e => onCoaches(e.target.value)} />
        </div>
        <div>
          <label className="label">{participantLabel}</label>
          <textarea className="input min-h-[64px] resize-y" placeholder="人名串，支持逗号、顿号、空格、换行分隔" value={participants} onChange={e => onParticipants(e.target.value)} />
        </div>
      </div>
    </div>
  )
}

function HoursSelect ({ value, onChange, label = '时长' }) {
  return (
    <label className="flex items-center gap-2 text-xs text-zinc-400">
      {label}
      <select className="input !w-24 !py-1.5" value={value} onChange={e => onChange(parseFloat(e.target.value))}>
        {HOURS_OPTIONS.map(h => <option key={h} value={h}>{h.toFixed(1)} 小时</option>)}
      </select>
    </label>
  )
}

function NameChips ({ names, rosterSet }) {
  if (!names.length) return null
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {names.map(n => (
        <span key={n} className={`text-[10px] px-1.5 py-0.5 rounded border ${rosterSet.has(n) ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}`}>
          {n}{rosterSet.has(n) ? '' : ' ?'}
        </span>
      ))}
    </div>
  )
}
