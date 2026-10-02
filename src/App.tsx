import { AgentChatProvider } from './components/agent-chat/AgentChatProvider'
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AppProvider } from './context/AppContext'
import { DeviceConnectionProvider } from './context/DeviceConnectionContext'
import { AppRoutes } from './routes/AppRoutes'
import { ToastProvider } from './ui'
import { preloadWatermarkPaths } from './shared/watermarkAssets'
import { preloadBorderLogoPaths } from './workspace/border/logoAssets'
import { HotUpdateStartupDialog } from './components/HotUpdateStartupDialog'
import { LivePreviewWindow } from './pages/LivePreviewWindow'
import { StartupReadySignal } from './components/StartupReadySignal'

function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const isLivePreviewWindow = location.pathname === '/live-preview-window'

  useEffect(() => {
    if (isLivePreviewWindow) return
    // 预取所有水印图片的磁盘绝对路径，供 Rust 渲染层使用
    preloadWatermarkPaths(style => window.luna.getWatermarkPath(style, 'image'))
    void preloadBorderLogoPaths()
  }, [isLivePreviewWindow])

  useEffect(() => {
    if (isLivePreviewWindow) return
    return window.luna.aiEditor.agent.onActivate(() => {
      if (window.location.hash !== '#/ai-editor') navigate('/ai-editor')
    })
  }, [navigate, isLivePreviewWindow])

  useEffect(() => {
    if (isLivePreviewWindow) return
    return window.luna.aiEditor.onOpenProject(projectId => {
      navigate('/ai-editor', { state: { projectId } })
    })
  }, [navigate, isLivePreviewWindow])

  if (isLivePreviewWindow) return <LivePreviewWindow />

  return (
    <AppProvider>
      <DeviceConnectionProvider>
        <StartupReadySignal />
        <ToastProvider>
          <AgentChatProvider>
            <HotUpdateStartupDialog />
            <AppRoutes />
          </AgentChatProvider>
        </ToastProvider>
      </DeviceConnectionProvider>
    </AppProvider>
  )
}

export default App
