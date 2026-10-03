import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
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
  const location = useLocation()
  const isLivePreviewWindow = location.pathname === '/live-preview-window'

  useEffect(() => {
    if (isLivePreviewWindow) return
    // 预取所有水印图片的磁盘绝对路径，供 Rust 渲染层使用
    preloadWatermarkPaths(style => window.luna.getWatermarkPath(style, 'image'))
    void preloadBorderLogoPaths()
  }, [isLivePreviewWindow])

  if (isLivePreviewWindow) return <LivePreviewWindow />

  return (
    <AppProvider>
      <DeviceConnectionProvider>
        <StartupReadySignal />
        <ToastProvider>
          <HotUpdateStartupDialog />
          <AppRoutes />
        </ToastProvider>
      </DeviceConnectionProvider>
    </AppProvider>
  )
}

export default App
