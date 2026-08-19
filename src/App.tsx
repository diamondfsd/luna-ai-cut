import { useEffect, useState } from 'react'
import { AppProvider } from './context/AppContext'
import { DeviceConnectionProvider } from './context/DeviceConnectionContext'
import { AppRoutes } from './routes/AppRoutes'
import { AssistantPage } from './pages/AssistantPage'
import { ToastProvider } from './ui'
import { preloadWatermarkPaths } from './shared/watermarkAssets'
import { preloadBorderLogoPaths } from './workspace/border/logoAssets'
import './styles/app-layout.css'
import type { DeepSeekHarnessContext } from './shared/types'

function App() {
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantContext, setAssistantContext] = useState<DeepSeekHarnessContext | undefined>()

  useEffect(() => {
    // 预取所有水印图片的磁盘绝对路径，供 WebGPU 合成层使用
    preloadWatermarkPaths(style => window.luna.getWatermarkPath(style, 'image'))
    void preloadBorderLogoPaths()
  }, [])

  useEffect(() => {
    const removeOpenListener = window.luna.deepseekHarness.onOpenRequested((context) => {
      setAssistantContext(context)
      setAssistantOpen(true)
    })
    return removeOpenListener
  }, [])

  return (
    <AppProvider>
      <DeviceConnectionProvider>
        <ToastProvider>
          <div className={`app-layout${assistantOpen ? ' app-layout--assistant-open' : ''}`}>
            <div className="app-layout__main">
              <AppRoutes
                onOpenAssistant={() => setAssistantOpen(true)}
              />
            </div>
            {assistantOpen && (
              <AssistantPage
                context={assistantContext}
                onClose={() => setAssistantOpen(false)}
              />
            )}
          </div>
        </ToastProvider>
      </DeviceConnectionProvider>
    </AppProvider>
  )
}

export default App
