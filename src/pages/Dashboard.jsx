import React, { useMemo, useState } from 'react'
import { Badge, Empty } from '../components/ui.jsx'

const NEG_ROW_STYLE = { backgroundColor: 'rgba(255,230,230,0.10)' }

export default function Dashboard ({ excel }) {
  const [mode, setMode] = useState('generation') // generation | global

  // 只读内存渲染：剔除 A 列或 F 汇总为空的占位行；绝不写回 Excel
  const validMembers = useMemo(() => {
    if (!excel) return []
    return excel.members.filter(m => m.name && m.f !== null && m.f !== undefined)
  }, [excel])

  const stats = useMemo(() => {
    const fs = validMembers.map(m => m.f)
    return {
      total: validMembers.length,
      avg: fs.length ? fs.reduce((a, b) => a + b, 0) / fs.length : 0,
      negative: fs.filter(f => f < 0).length,
      activities: excel?.activityColumns?.length || 0
    }
  }, [validMembers, excel])

  const globalRank = useMemo(() => {
    const sorted = [...validMembers].sort((a, b) => b.f - a.f)
    const map = {}
    sorted.forEach((m, i) => { map[m.row] = i + 1 })
    return map
  }, [validMembers])

  const byGeneration = useMemo(() => {
    const groups = {}
    for (const m of validMembers) {
      const g = m.generation ?? 0
      if (!groups[g]) groups[g] = []
      groups[g].push(m)
    }
    const keys = Object.keys(groups).map(Number).sort((a, b) => b - a)
    return keys.map(g => ({
      generation: g,
      members: groups[g].sort((a, b) => b.f - a.f)
    }))
  }, [validMembers])

  const globalSorted = useMemo(() => [...validMembers].sort((a, b) => b.f - a.f), [validMembers])

  if (!excel) return <Empty text="主表数据尚未加载" />

  const dupSet = new Set(excel.duplicateNames || [])

  const renderRow = (m, rank) => {
    const negative = m.f < 0
    return (
      <tr
        key={`${m.row}-${m.name}`}
        className={`border-b border-white/[0.04] transition hover:bg-white/[0.03] ${negative ? 'border-l-2 border-l-red-500' : ''}`}
        style={negative ? NEG_ROW_STYLE : undefined}
      >
        <td className="td w-14 text-zinc-500 font-mono">{rank}</td>
        <td className="td">
          <span className={`font-medium ${negative ? 'text-red-400 font-bold' : 'text-zinc-100'}`}>{m.name}</span>
          {dupSet.has(m.name) && <span className="ml-2"><Badge tone="amber">同名待核对</Badge></span>}
        </td>
        <td className="td text-zinc-400 w-20">{m.generation ? `${m.generation}届` : '—'}</td>
        <td className="td text-zinc-400 w-24 text-right font-mono">{fmt(m.b)}</td>
        <td className="td text-zinc-400 w-24 text-right font-mono">{fmt(m.c)}</td>
        <td className="td text-zinc-400 w-24 text-right font-mono">{fmt(m.d)}</td>
        <td className="td text-zinc-400 w-24 text-right font-mono">{fmt(m.e)}</td>
        <td className={`td w-28 text-right font-mono font-bold ${negative ? 'text-red-400' : 'text-zinc-50'}`}>{fmt(m.f)}</td>
      </tr>
    )
  }

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      {/* 统计卡片 */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="在册有效队员" value={stats.total} />
        <StatCard label="平均汇总分" value={stats.avg.toFixed(2)} />
        <StatCard label="负分预警" value={stats.negative} tone={stats.negative > 0 ? 'red' : 'zinc'} />
        <StatCard label="活动列数" value={stats.activities} />
      </div>

      {/* 排序模式切换 */}
      <div className="card p-2 inline-flex gap-1.5">
        <button
          onClick={() => setMode('generation')}
          className={`px-4 py-2 rounded-xl text-[13px] transition ${mode === 'generation' ? 'bg-accent/20 border border-accent/40 text-zinc-50 font-medium' : 'border border-transparent text-zinc-400 hover:text-zinc-200'}`}
        >按届数分组排名</button>
        <button
          onClick={() => setMode('global')}
          className={`px-4 py-2 rounded-xl text-[13px] transition ${mode === 'global' ? 'bg-accent/20 border border-accent/40 text-zinc-50 font-medium' : 'border border-transparent text-zinc-400 hover:text-zinc-200'}`}
        >按总积分全局排名</button>
      </div>

      <div className="text-[11px] text-zinc-500 -mt-2">
        排名为内存只读视图，原 Excel 表格的物理行排版（按届别排列）永久保持不变。
      </div>

      {/* 榜单 */}
      <div className="card overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-white/[0.08] bg-white/[0.02]">
              <th className="th w-14">名次</th>
              <th className="th">姓名</th>
              <th className="th w-20">届别</th>
              <th className="th w-24 text-right">夜训周训</th>
              <th className="th w-24 text-right">升降旗</th>
              <th className="th w-24 text-right">后勤部</th>
              <th className="th w-24 text-right">综办部</th>
              <th className="th w-28 text-right">汇总总分</th>
            </tr>
          </thead>
          <tbody>
            {mode === 'global'
              ? globalSorted.map((m, i) => renderRow(m, i + 1))
              : byGeneration.map(group => (
                <React.Fragment key={group.generation}>
                  <tr>
                    <td colSpan={8} className="px-3 py-2 bg-white/[0.03] border-y border-white/[0.08]">
                      <span className="text-xs font-bold text-zinc-300 tracking-widest">
                        {group.generation ? `—— ${group.generation} 届 ——` : '—— 未标注届别 ——'}
                      </span>
                      <span className="ml-3 text-[10px] text-zinc-500">{group.members.length} 人</span>
                    </td>
                  </tr>
                  {group.members.map((m, i) => renderRow(m, `${i + 1} / 全局#${globalRank[m.row]}`))}
                </React.Fragment>
                ))}
            {validMembers.length === 0 && (
              <tr><td colSpan={8}><Empty text="暂无有效队员数据（A 列姓名与 F 列汇总均非空的行才会展示）" /></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatCard ({ label, value, tone = 'zinc' }) {
  return (
    <div className="card p-5">
      <div className="text-[11px] text-zinc-500 tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1.5 font-mono ${tone === 'red' ? 'text-red-400' : 'text-zinc-50'}`}>{value}</div>
    </div>
  )
}

function fmt (v) {
  if (v === null || v === undefined) return '—'
  return String(Math.round(Number(v) * 100) / 100)
}
