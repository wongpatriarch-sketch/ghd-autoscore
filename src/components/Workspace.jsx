import React, { useState } from 'react'
import logoUrl from '../assets/logo.png'
import Dashboard from '../pages/Dashboard.jsx'
import EventScoring from '../pages/EventScoring.jsx'
import BatchImport from '../pages/BatchImport.jsx'
import HistoryCenter from '../pages/History.jsx'
import { Badge } from './ui.jsx'
import { IconChart, IconMedal, IconImport, IconHistory, IconRefresh, IconAlert } from './icons.jsx'

const NAV = [
  { key: 'dashboard', label: '仪表盘与排名', icon: IconChart },
  { key: 'event', label: '活动积分结算', icon: IconMedal },
  { key: 'import', label: '批量数据导入', icon: IconImport },
  { key: 'history', label: '历史流水与撤销', icon: IconHistory }
]

export default function Workspace ({ cfg, excel, onClose, reloadExcel, recordAfterWrite, notifyWritten, showAlert }) {
  const [tab, setTab] = useState('dashboard')

  // 各页面共用的上下文
  // - recordAfterWrite：写 Excel 成功后登记历史；登记失败会自动回滚 Excel
  // - notifyWritten：写入成功后的右上角提示
  const ctx = { cfg, excel, reloadExcel, recordAfterWrite, notifyWritten, showAlert }

  return (
    <div className="h-full flex">
      {/* 侧边导航 */}
      <aside className="w-60 shrink-0 border-r border-white/[0.06] bg-surface-850/60 backdrop-blur-xl flex flex-col">
        <div className="flex items-center gap-3 px-5 py-5">
          <img src={logoUrl} alt="logo" className="w-8 h-8 rounded-lg" />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-zinc-100 truncate" title={cfg.projectName}>{cfg.projectName}</div>
            <div className="text-[10px] text-zinc-500 truncate" title={cfg.excelPath}>{cfg.excelPath}</div>
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-1 mt-2">
          {NAV.map(item => {
            const Icon = item.icon
            const active = tab === item.key
            return (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className={`w-full flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13px] transition text-left ${
                  active
                    ? 'bg-accent/15 border border-accent/30 text-zinc-50 font-medium'
                    : 'border border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.05]'
                }`}
              >
                <Icon className="w-[18px] h-[18px] shrink-0" />
                {item.label}
              </button>
            )
          })}
        </nav>

        <div className="p-4 border-t border-white/[0.06]">
          <button onClick={onClose} className="w-full btn-ghost text-xs py-2">关闭项目并释放锁定</button>
        </div>
      </aside>

      {/* 主区域 */}
      <main className="flex-1 min-w-0 flex flex-col">
        <header className="flex items-center justify-between gap-3 px-8 py-4 border-b border-white/[0.06]">
          {/* 标题和两个锁徽标不折行、不被压缩；空间不够时让右边的表格路径省略（鼠标悬停能看到完整路径） */}
          <div className="flex items-center gap-3 shrink-0">
            <h1 className="text-base font-semibold text-zinc-100 whitespace-nowrap">{NAV.find(n => n.key === tab)?.label}</h1>
            {cfg.locks?.is_logistics_imported && <Badge tone="blue">后勤已导入</Badge>}
            {cfg.locks?.is_comprehensive_imported && <Badge tone="blue">综办已导入</Badge>}
          </div>
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-[11px] text-zinc-500 truncate min-w-0" title={cfg.excelPath}>绑定表格：{cfg.excelPath}</span>
            <button onClick={() => reloadExcel()} className="btn-ghost shrink-0 whitespace-nowrap text-xs py-1.5 px-3">
              <IconRefresh className="w-3.5 h-3.5" />刷新数据
            </button>
          </div>
        </header>

        {excel?.duplicateNames?.length > 0 && (
          <div className="mx-8 mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-300 flex items-start gap-2">
            <IconAlert className="w-4 h-4 shrink-0 mt-px" />
            <span>检测到主表存在同名队员：<b>{excel.duplicateNames.join('、')}</b>。涉及修改与预览的环节会标注出来，请务必人工核对。</span>
          </div>
        )}
        {excel?.duplicateColumns?.length > 0 && (
          <div className="mx-8 mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-300 flex items-start gap-2">
            <IconAlert className="w-4 h-4 shrink-0 mt-px" />
            <span>
              活动列里有重名的列：<b>{excel.duplicateColumns.join('、')}</b>。榜单按列显示各自的分数，但按活动名修改分数时只会改到排在前面的那一列，建议在 Excel 里把它们改成不同的名称。
            </span>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto px-8 py-6">
          {tab === 'dashboard' && <Dashboard {...ctx} />}
          {tab === 'event' && <EventScoring {...ctx} />}
          {tab === 'import' && <BatchImport {...ctx} />}
          {tab === 'history' && <HistoryCenter {...ctx} />}
        </div>
      </main>
    </div>
  )
}
