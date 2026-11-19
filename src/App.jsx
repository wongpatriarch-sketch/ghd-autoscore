import React, { useCallback, useEffect, useState } from 'react'
import ProjectHub from './pages/ProjectHub.jsx'
import Workspace from './components/Workspace.jsx'
import { AlertModal } from './components/ui.jsx'
import { api } from './lib/api.js'

export default function App () {
  const [projectConfig, setProjectConfig] = useState(null)
  const [excelData, setExcelData] = useState(null)
  const [alert, setAlert] = useState(null)
  const [loading, setLoading] = useState(false)

  const showAlert = useCallback((message, title = '操作被阻断') => {
    setAlert({ message, title })
  }, [])

  const reloadExcel = useCallback(async (cfg) => {
    const target = cfg || projectConfig
    if (!target) return null
    const res = await api.readExcel(target.excelPath)
    if (!res.ok) {
      showAlert(res.error || '读取主表失败')
      return null
    }
    setExcelData(res.data)
    return res.data
  }, [projectConfig, showAlert])

  const enterWorkspace = useCallback(async (cfg) => {
    setLoading(true)
    const data = await reloadExcel(cfg)
    setLoading(false)
    if (!data) return
    setProjectConfig(cfg)
  }, [reloadExcel])

  const closeProject = useCallback(async () => {
    if (projectConfig) await api.closeProject(projectConfig.excelPath)
    setProjectConfig(null)
    setExcelData(null)
  }, [projectConfig])

  // 持久化项目配置（含 history / locks / settings）
  const updateConfig = useCallback(async (mutator) => {
    if (!projectConfig) return null
    const next = typeof mutator === 'function' ? mutator(structuredClone(projectConfig)) : mutator
    const res = await api.saveProject(next.configPath, next)
    if (!res.ok) {
      showAlert(res.error || '项目配置保存失败')
      return null
    }
    setProjectConfig(res.data)
    return res.data
  }, [projectConfig, showAlert])

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
            updateConfig={updateConfig}
            showAlert={showAlert}
          />
          )}
      <AlertModal
        open={!!alert}
        title={alert?.title}
        message={alert?.message}
        onClose={() => setAlert(null)}
      />
    </div>
  )
}
