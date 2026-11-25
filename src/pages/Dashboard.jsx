import React, { useMemo, useState } from 'react'
import { Badge, Empty } from '../components/ui.jsx'
import { round4 } from '../lib/utils.js'

// ---------- 列宽（px）。名次列的宽度同时是"姓名列吸左"的偏移量，两处必须一致 ----------
const RANK_W = 96
const NAME_MIN_W = 88
// 活动列统一宽度：正好放得下主表里最常见的两行表头（上一行活动名、下一行括号里的说明）；
// 更长的名称在列内自动折行。如果不限宽度，一行十几二十个字的表头会把整张表撑到三千多像素宽
const ACTIVITY_W = 160
const SUMMARY_W = 112

// 吸顶 / 吸左 / 吸右的单元格必须是不透明底色，否则滚动时下面的文字会透出来，所以这里用实色。
// 普通行用 surface-800（视觉上和卡片底色一致）；负分行用带一点红的实色。
const NEG_BG = { backgroundColor: '#2e2c33' }
const NEG_TEXT = 'text-red-400'

// 固定列的公共类名：位置由调用处补充（left-0 / top-0 / right-0）。
// 姓名列右侧、汇总列左侧各带一条细分界线：横向滚动时让人看得出哪一部分是钉住不动的。
const STICKY_CELL = 'td sticky z-20 border-b border-white/[0.04] bg-surface-800 hover:bg-surface-700'
const TH = 'th bg-surface-800 border-b border-white/[0.08] whitespace-nowrap'
// 活动列表头用这一组：允许折行（不带"不换行"），所以不能和 TH 合并成一个类名
const TH_WRAP = 'th bg-surface-800 border-b border-white/[0.08] leading-snug'
const TD = 'td border-b border-white/[0.04]'

// 把主表表头按换行拆成几行文字：Excel 里为了排版加的换行（活动名一行、说明一行），界面上照原样换行
const headerLines = (name) => {
  const lines = String(name || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  return lines.length ? lines : ['（未命名）']
}

// initialMode：初始的排名方式（界面里不传，默认按届数分组；测试用它直接渲染"全局排名"的样子）
export default function Dashboard ({ excel, initialMode }) {
  const [mode, setMode] = useState(initialMode === 'global' ? 'global' : 'generation') // generation：按届数分组排名 | global：按总积分全局排名
  const [activityView, setActivityView] = useState('split') // split：每个活动一列 | merged：所有活动合成一列

  const activityColumns = excel?.activityColumns || []
  const merged = activityView === 'merged' && activityColumns.length > 0

  // 只读内存渲染：剔除 A 列或 F 汇总为空的占位行；绝不写回 Excel
  const validMembers = useMemo(() => {
    if (!excel) return []
    return excel.members.filter(m => m.name && m.f !== null && m.f !== undefined)
  }, [excel])

  const stats = useMemo(() => {
    const totals = validMembers.map(m => m.f)
    return {
      total: validMembers.length,
      avg: totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0,
      negative: totals.filter(f => f < 0).length,
      activities: activityColumns.length
    }
  }, [validMembers, activityColumns])

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
  // 固定 8 列：名次 / 姓名 / 届别 / 四项明细 / 汇总；再加上活动列（合并视图下最多 1 列）
  const colCount = 8 + (merged ? 1 : activityColumns.length)
  // B~E 四个明细列的表头文字照抄主表（主表写的是"后勤部"就显示"后勤部"），主表里没写时用默认名称
  const headerOf = (col, fallback) => (excel.headers && excel.headers[col - 1]) || fallback

  // 一个队员所有活动的合计；一项活动分都没有时返回 null（显示为空，而不是 0）
  // 活动分按列号取（m.extras 的键是列号），两列重名时也各取各的
  const activityTotal = (m) => {
    const values = activityColumns.map(col => m.extras?.[col.col])
    if (!values.some(v => v !== null && v !== undefined)) return null
    return round4(values.reduce((sum, v) => sum + (v || 0), 0))
  }

  const renderRow = (m, rankNode) => {
    const negative = m.f < 0
    // 负分行的固定列用实色内联样式（内联样式优先级高于 hover 类，悬停时底色不会变回普通色）
    const stickyStyle = negative ? NEG_BG : undefined
    return (
      <tr key={`${m.row}-${m.name}`} className={negative ? 'bg-[#2e2c33] hover:bg-[#38353d]' : 'hover:bg-white/[0.03]'}>
        <td
          className={`${STICKY_CELL} left-0 font-mono text-zinc-200 ${negative ? 'border-l-2 border-l-red-500' : ''}`}
          style={{ width: RANK_W, minWidth: RANK_W, ...stickyStyle }}
        >{rankNode}</td>
        <td className={`${STICKY_CELL} border-r border-white/[0.08] whitespace-nowrap`} style={{ left: RANK_W, minWidth: NAME_MIN_W, ...stickyStyle }}>
          <span className={`font-medium ${negative ? `${NEG_TEXT} font-bold` : 'text-zinc-100'}`}>{m.name}</span>
          {dupSet.has(m.name) && <span className="ml-2"><Badge tone="amber">同名待核对</Badge></span>}
        </td>
        <td className={`${TD} whitespace-nowrap text-zinc-400`}>{m.generation ? `${m.generation}届` : '—'}</td>
        <NumCell value={m.b} />
        <NumCell value={m.c} />
        <NumCell value={m.d} />
        <NumCell value={m.e} />
        {merged
          ? <NumCell value={activityTotal(m)} strong />
          : activityColumns.map(col => (
            <NumCell key={col.col} value={m.extras?.[col.col]} width={ACTIVITY_W} />
          ))}
        <td
          className={`td sticky right-0 z-20 border-b border-white/[0.04] border-l border-l-white/[0.08] text-right font-mono font-bold ${negative ? NEG_TEXT : 'bg-surface-800 hover:bg-surface-700 text-zinc-50'}`}
          style={{ width: SUMMARY_W, minWidth: SUMMARY_W, ...stickyStyle }}
        >{fmt(m.f)}</td>
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

      {/* 视图切换 */}
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[{ value: 'generation', label: '按届数分组排名' }, { value: 'global', label: '按总积分全局排名' }]}
        />
        {activityColumns.length > 0 && (
          <Segmented
            value={merged ? 'merged' : 'split'}
            onChange={setActivityView}
            options={[{ value: 'split', label: '活动分列' }, { value: 'merged', label: '活动合并' }]}
          />
        )}
      </div>

      <div className="text-[11px] text-zinc-500 -mt-2 leading-relaxed">
        排名和活动列都是只读视图，不会改动 Excel；原表格的物理行排版（按届别排列）保持不变。
        「活动分列」逐个显示主表里每个活动的得分，「活动合并」只显示这些得分的合计。
      </div>

      {/* 榜单：可横向滚动；表头吸顶，名次和姓名吸左，汇总分吸右 */}
      <div className="card overflow-auto max-h-[calc(100vh-330px)]">
        <table className="w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className={`${TH} sticky top-0 left-0 z-30`} style={{ width: RANK_W, minWidth: RANK_W }}>名次</th>
              <th className={`${TH} sticky top-0 z-30 border-r border-white/[0.08]`} style={{ left: RANK_W, minWidth: NAME_MIN_W }}>姓名</th>
              <th className={`${TH} sticky top-0 z-10`}>届别</th>
              <th className={`${TH} sticky top-0 z-10 text-right`}>{headerOf(2, '夜训周训')}</th>
              <th className={`${TH} sticky top-0 z-10 text-right`}>{headerOf(3, '升降旗')}</th>
              <th className={`${TH} sticky top-0 z-10 text-right`}>{headerOf(4, '后勤')}</th>
              <th className={`${TH} sticky top-0 z-10 text-right`}>{headerOf(5, '综办')}</th>
              {merged
                ? <th className={`${TH} sticky top-0 z-10 text-right`} style={{ minWidth: ACTIVITY_W }}>活动合计</th>
                : activityColumns.map(col => (
                  // 表头按 Excel 里的换行分两行显示；完整名称同时放在悬停提示里
                  <th key={col.col} className={`${TH_WRAP} sticky top-0 z-10`} style={{ width: ACTIVITY_W, minWidth: ACTIVITY_W }} title={col.name}>
                    {headerLines(col.name).map((line, i) => <React.Fragment key={i}>{i > 0 && <br />}{line}</React.Fragment>)}
                  </th>
                ))}
              <th className={`${TH} sticky top-0 right-0 z-30 text-right border-l border-white/[0.08]`} style={{ width: SUMMARY_W, minWidth: SUMMARY_W }}>汇总总分</th>
            </tr>
          </thead>
          <tbody>
            {mode === 'global'
              ? globalSorted.map((m, i) => renderRow(m, i + 1))
              : byGeneration.map(group => (
                <React.Fragment key={group.generation}>
                  <tr>
                    <td colSpan={colCount} className="px-3 py-2 bg-white/[0.03] border-y border-white/[0.08]">
                      <span className="text-xs font-bold text-zinc-300 tracking-widest">
                        {group.generation ? `—— ${group.generation} 届 ——` : '—— 未标注届别 ——'}
                      </span>
                      <span className="ml-3 text-[10px] text-zinc-500">{group.members.length} 人</span>
                    </td>
                  </tr>
                  {group.members.map((m, i) => renderRow(m, (
                    <>
                      <span className="font-mono text-zinc-100">{i + 1}</span>
                      <span className="ml-1.5 text-[10px] text-zinc-500 whitespace-nowrap">/ 全局第 {globalRank[m.row]}</span>
                    </>
                  )))}
                </React.Fragment>
              ))}
            {validMembers.length === 0 && (
              <tr><td colSpan={colCount}><Empty text="暂无有效队员数据（A 列姓名与 F 列汇总均非空的行才会展示）" /></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// 右对齐的数字单元格；空值显示为「—」并压暗
function NumCell ({ value, strong = false, width }) {
  const empty = value === null || value === undefined
  return (
    <td
      className={`${TD} text-right font-mono ${empty ? 'text-zinc-600' : strong ? 'text-zinc-100 font-semibold' : 'text-zinc-300'}`}
      style={width ? { width, minWidth: width } : undefined}
    >
      {empty ? '—' : fmt(value)}
    </td>
  )
}

// 分段切换按钮组
function Segmented ({ value, onChange, options }) {
  return (
    <div className="card p-1.5 inline-flex gap-1.5">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-4 py-2 rounded-xl text-[13px] transition ${
            value === opt.value
              ? 'bg-accent/20 border border-accent/40 text-zinc-50 font-medium'
              : 'border border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >{opt.label}</button>
      ))}
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

// 界面上最多显示 2 位小数（分数都是 0.5 的倍数，足够了）
function fmt (v) {
  if (v === null || v === undefined) return '—'
  return String(Math.round(Number(v) * 100) / 100)
}
