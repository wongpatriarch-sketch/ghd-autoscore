import React from 'react'

// 统一风格的线性图标：24×24 画布、跟随文字颜色。
// 不用 emoji 是因为 emoji 在不同 Windows 版本和缩放比例下大小、基线都不一样，还是彩色的，和深色界面不搭。
function createIcon (name, children) {
  function Icon ({ className = 'w-4 h-4' }) {
    return (
      <svg
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {children}
      </svg>
    )
  }
  Icon.displayName = name
  return Icon
}

// 柱状图：仪表盘
export const IconChart = createIcon('IconChart', <>
  <path d="M3 3v18h18" />
  <path d="M18 17V9" />
  <path d="M13 17V5" />
  <path d="M8 17v-3" />
</>)

// 奖章：活动积分结算
export const IconMedal = createIcon('IconMedal', <>
  <circle cx="12" cy="8" r="6" />
  <path d="M15.48 12.89 17 22l-5-3-5 3 1.52-9.11" />
</>)

// 下载：批量数据导入
export const IconImport = createIcon('IconImport', <>
  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
  <path d="m7 10 5 5 5-5" />
  <path d="M12 15V3" />
</>)

// 时钟回溯：历史流水
export const IconHistory = createIcon('IconHistory', <>
  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
  <path d="M3 3v5h5" />
  <path d="M12 7v5l4 2" />
</>)

// 打开的文件夹：打开项目
export const IconFolder = createIcon('IconFolder', <>
  <path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6A2 2 0 0 1 18.45 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2" />
</>)

// 锁
export const IconLock = createIcon('IconLock', <>
  <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
</>)

// 月亮：日常训练
export const IconMoon = createIcon('IconMoon', <>
  <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
</>)

// 旗：升降旗
export const IconFlag = createIcon('IconFlag', <>
  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
  <path d="M4 22v-7" />
</>)

// 楼房：部门
export const IconBuilding = createIcon('IconBuilding', <>
  <rect width="16" height="20" x="4" y="2" rx="2" ry="2" />
  <path d="M9 22v-4h6v4" />
  <path d="M8 6h.01" />
  <path d="M16 6h.01" />
  <path d="M12 6h.01" />
  <path d="M12 10h.01" />
  <path d="M12 14h.01" />
  <path d="M16 10h.01" />
  <path d="M16 14h.01" />
  <path d="M8 10h.01" />
  <path d="M8 14h.01" />
</>)

// 双箭头循环：刷新
export const IconRefresh = createIcon('IconRefresh', <>
  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
  <path d="M21 3v5h-5" />
  <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
  <path d="M8 16H3v5" />
</>)

// 对勾：操作成功
export const IconCheck = createIcon('IconCheck', <>
  <path d="M20 6 9 17l-5-5" />
</>)

// 三角叹号：需要注意
export const IconAlert = createIcon('IconAlert', <>
  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
  <path d="M12 9v4" />
  <path d="M12 17h.01" />
</>)
