import React, { useEffect } from 'react'
import { IconAlert, IconCheck } from './icons.jsx'

export function Modal ({ open, onClose, title, children, width = 'max-w-2xl', dismissable = true }) {
  useEffect(() => {
    if (!open || !dismissable) return undefined
    const h = (e) => { if (e.key === 'Escape') onClose && onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, dismissable, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => dismissable && onClose && onClose()}
      />
      <div className={`relative w-full ${width} glass-strong rounded-2xl overflow-hidden`}>
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
            <h3 className="text-base font-semibold text-zinc-100">{title}</h3>
            {dismissable && (
              <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 transition text-lg leading-none px-1">✕</button>
            )}
          </div>
        )}
        <div className="px-6 py-5 max-h-[70vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

// 阻断式提示（EBUSY / 占用 / 严重错误）
export function AlertModal ({ open, title = '操作被阻断', message, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title={title} width="max-w-md" dismissable>
      <div className="flex gap-3">
        <div className="w-10 h-10 shrink-0 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-400">
          <IconAlert className="w-5 h-5" />
        </div>
        <p className="text-sm text-zinc-300 leading-relaxed pt-2">{message}</p>
      </div>
      <div className="mt-5 flex justify-end">
        <button className="btn-primary" onClick={onClose}>我知道了</button>
      </div>
    </Modal>
  )
}

export function ConfirmModal ({ open, title, message, confirmText = '确认', danger = false, onConfirm, onCancel }) {
  return (
    <Modal open={open} onClose={onCancel} title={title} width="max-w-md">
      <p className="text-sm text-zinc-300 leading-relaxed">{message}</p>
      <div className="mt-5 flex justify-end gap-3">
        <button className="btn-ghost" onClick={onCancel}>取消</button>
        <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm}>{confirmText}</button>
      </div>
    </Modal>
  )
}

export function Badge ({ tone = 'zinc', children }) {
  const tones = {
    zinc: 'bg-white/[0.07] border-white/10 text-zinc-300',
    green: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
    red: 'bg-red-500/15 border-red-500/30 text-red-300',
    amber: 'bg-amber-500/15 border-amber-500/30 text-amber-300',
    blue: 'bg-sky-500/15 border-sky-500/30 text-sky-300'
  }
  return (
    // whitespace-nowrap：徽标里的字不许折行（姓名列较窄时"同名待核对"曾被挤成两行，把整行撑高）
    <span className={`inline-flex items-center whitespace-nowrap px-2 py-0.5 rounded-md border text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  )
}

export function Empty ({ text = '暂无数据' }) {
  return (
    <div className="py-16 text-center text-sm text-zinc-500">{text}</div>
  )
}

export function Spinner ({ text = '处理中…' }) {
  return (
    <div className="flex items-center gap-3 text-sm text-zinc-400">
      <span className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
      {text}
    </div>
  )
}

// 右上角的非阻断提示：写入成功、自动纠正了哪些行等。几秒后自动消失，不打断当前操作。
// tone: 'ok' 普通成功 | 'warn' 成功但有需要知道的情况（例如原汇总被纠正）
export function Toasts ({ items }) {
  if (!items || !items.length) return null
  return (
    <div className="fixed top-16 right-6 z-40 flex flex-col gap-2 w-[380px] max-w-[calc(100vw-3rem)]">
      {items.map(t => (
        <div
          key={t.id}
          className={`glass-strong rounded-xl px-4 py-3 flex gap-2.5 ${t.tone === 'warn' ? 'border-amber-500/40' : 'border-emerald-500/30'}`}
        >
          <span className={`shrink-0 mt-0.5 ${t.tone === 'warn' ? 'text-amber-300' : 'text-emerald-300'}`}>
            {t.tone === 'warn' ? <IconAlert className="w-4 h-4" /> : <IconCheck className="w-4 h-4" />}
          </span>
          <span className="text-xs leading-relaxed text-zinc-200">{t.message}</span>
        </div>
      ))}
    </div>
  )
}
