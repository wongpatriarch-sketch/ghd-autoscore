import React, { useCallback, useEffect, useRef, useState } from 'react'
import ProjectHub from './pages/ProjectHub.jsx'
import Workspace from './components/Workspace.jsx'
import { AlertModal, Toasts } from './components/ui.jsx'
import { api } from './lib/api.js'
import { summaryNote } from './lib/utils.js'

let toastSeq = 0

export default function App () {
  const [projectConfig, setProjectConfig] = useState(null)
  const [excelData, setExcelData] = useState(null)
  const [alert, setAlert] = useState(null)
  const [toasts, setToasts] = useState([])
  const [loading, setLoading] = useState(false)

  // 始终指向最新的项目配置。"先写 Excel、再存配置"是异步的两步，
  // 中途界面可能已经刷新过，用 ref 取值才能保证拿到最新版本，而不是函数创建时的旧快照。
  const configRef = useRef(null)
  configRef.current = projectConfig

  // 阻断式提示：出错、被占用等必须让用户看到的情况
  const showAlert = useCallback((message, title = '操作被阻断') => {
    setAlert({ message, title })
  }, [])

  // 右上角的非阻断提示，几秒后自动消失
  const notify = useCallback((message, tone = 'ok') => {
    const id = ++toastSeq
    setToasts(list => [...list.slice(-2), { id, message, tone }]) // 最多同时显示 3 条
    const life = tone === 'warn' ? 14000 : 8000
    window.setTimeout(() => setToasts(list => list.filter(t => t.id !== id)), life)
  }, [])

  // 写入成功后的统一提示：base 说明这次做了什么；
  // 主进程若报告了"原汇总被纠正""有公式没算出结果"等情况，就追加说明并换成提醒色
  const notifyWritten = useCallback((res, base) => {
    const note = summaryNote(res && res.data)
    notify(note ? `${base}。${note}` : base, note ? 'warn' : 'ok')
  }, [notify])

  const reloadExcel = useCallback(async (cfg) => {
    // 参数必须是真的项目配置。"刷新数据"按钮写成 <button onClick={reloadExcel}> 时，
    // React 会把点击事件对象传进来，不能把它当成配置去读 excelPath（会读出 undefined，误报"表格不存在"）
    const target = cfg && typeof cfg.excelPath === 'string' ? cfg : configRef.current
    if (!target) return null
    const res = await api.readExcel(target.excelPath)
    if (!res.ok) {
      showAlert(res.error || '读取主表失败')
      return null
    }
    setExcelData(res.data)
    return res.data
  }, [showAlert])

  const enterWorkspace = useCallback(async (cfg) => {
    if (!cfg || typeof cfg.excelPath !== 'string') return
    setLoading(true)
    const data = await reloadExcel(cfg)
    setLoading(false)
    if (!data) {
      // 表格读不出来就不进工作区；主进程刚才为这个项目加的占用锁要一并放掉
      await api.closeProject(cfg.excelPath)
      return
    }
    setProjectConfig(cfg)
  }, [reloadExcel])

  const closeProject = useCallback(async () => {
    if (projectConfig) await api.closeProject(projectConfig.excelPath)
    setProjectConfig(null)
    setExcelData(null)
    setToasts([])
  }, [projectConfig])

  const saveConfig = useCallback(async (next) => {
    const res = await api.saveProject(next.configPath, next)
    if (res.ok) setProjectConfig(res.data)
    return res
  }, [])

  // 一次写入分两步落盘：
  //   ① 主进程修改 Excel，并返回"写入前"的备份路径；
  //   ② 这里把对应的历史记录存进项目配置。
  // 如果 ② 失败，就用 ① 留下的备份把 Excel 恢复成写入前的样子，
  // 保证"表格"和"历史"永远一致——不会出现表格改了、历史里却没有这一笔（之后撤销对不上账）的情况。
  // 返回保存后的配置；失败时（已提示用户并回滚）返回 null。
  const recordAfterWrite = useCallback(async (res, mutator) => {
    const current = configRef.current
    if (!current || !res || !res.ok) return null
    const next = mutator(structuredClone(current))
    const saved = await saveConfig(next)
    if (saved.ok) return saved.data

    // 主进程返回的错误里已经带着"项目配置保存失败：原因"，直接用，不要再套一层同样的字样
    const reason = saved.error || '项目配置保存失败（未知原因）'
    const backup = res.data && res.data.backup
    const rollback = backup ? await api.restoreBackup(current.excelPath, backup) : { ok: false, error: '主进程没有返回备份路径' }
    if (rollback.ok) {
      showAlert(`${reason}。本次对 Excel 的写入已经自动回滚，表格恢复到了写入前的状态，数据没有任何改变。`, '本次操作未生效')
    } else {
      showAlert(
        `${reason}，并且 Excel 自动回滚没有成功（${rollback.error || '未知原因'}）。` +
        `表格已经写入，但历史里没有这一笔。请关闭占用表格或配置文件的程序后手动处理。写入前的备份：${backup || '（无）'}`,
        '需要人工处理'
      )
    }
    await reloadExcel(current)
    return null
  }, [saveConfig, showAlert, reloadExcel])

  // 关闭前释放锁
  useEffect(() => {
    const handler = () => {
      if (projectConfig) api.closeProject(projectConfig.excelPath)
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [projectConfig])

  return (
    <div className="h-full">
      {!projectConfig
        ? <ProjectHub onOpened={enterWorkspace} showAlert={showAlert} loading={loading} />
        : (
          <Workspace
            cfg={projectConfig}
            excel={excelData}
            onClose={closeProject}
            reloadExcel={() => reloadExcel()}
            recordAfterWrite={recordAfterWrite}
            notifyWritten={notifyWritten}
            showAlert={showAlert}
          />
          )}
      <Toasts items={toasts} />
      <AlertModal
        open={!!alert}
        title={alert?.title}
        message={alert?.message}
        onClose={() => setAlert(null)}
      />
    </div>
  )
}
