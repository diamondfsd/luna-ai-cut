import { useEffect, useState } from 'react'
import { AppProvider } from './context/AppContext'
import { DeviceConnectionProvider } from './context/DeviceConnectionContext'
import { AppRoutes } from './routes/AppRoutes'
import { AssistantPage } from './pages/AssistantPage'
import { ToastProvider } from './ui'
import { preloadWatermarkPaths } from './shared/watermarkAssets'
import { preloadBorderLogoPaths } from './workspace/border/logoAssets'
import './styles/app-layout.css'

function App() {
  const [assistantOpen, setAssistantOpen] = useState(false)

  useEffect(() => {
    // 预取所有水印图片的磁盘绝对路径，供 WebGPU 合成层使用
    preloadWatermarkPaths(style => window.luna.getWatermarkPath(style, 'image'))
    void preloadBorderLogoPaths()
  }, [])
  return (
    <AppProvider>
      <DeviceConnectionProvider>
        <ToastProvider>
          <div className={`app-layout${assistantOpen ? ' app-layout--assistant-open' : ''}`}>
            <div className="app-layout__main">
              <AppRoutes onOpenAssistant={() => setAssistantOpen(true)} />
            </div>
            {assistantOpen && (
              <AssistantPage onClose={() => setAssistantOpen(false)} />
            )}
          </div>
        </ToastProvider>
      </DeviceConnectionProvider>
    </AppProvider>
  )
}

export default App
