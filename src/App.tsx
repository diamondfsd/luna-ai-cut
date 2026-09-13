import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppProvider } from './context/AppContext'
import { DeviceConnectionProvider } from './context/DeviceConnectionContext'
import { AppRoutes } from './routes/AppRoutes'
import { ToastProvider } from './ui'
import { preloadWatermarkPaths } from './shared/watermarkAssets'
import { preloadBorderLogoPaths } from './workspace/border/logoAssets'

function App() {
  const navigate = useNavigate()

  useEffect(() => {
    // 预取所有水印图片的磁盘绝对路径，供 Rust 渲染层使用
    preloadWatermarkPaths(style => window.luna.getWatermarkPath(style, 'image'))
    void preloadBorderLogoPaths()
  }, [])

  useEffect(() => window.luna.aiEditor.agent.onActivate(() => {
    if (window.location.hash !== '#/ai-editor') navigate('/ai-editor')
  }), [navigate])
  return (
    <AppProvider>
      <DeviceConnectionProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </DeviceConnectionProvider>
    </AppProvider>
  )
}

export default App
