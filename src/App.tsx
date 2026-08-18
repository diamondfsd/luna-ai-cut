import { useEffect } from 'react'
import { AppProvider } from './context/AppContext'
import { DeviceConnectionProvider } from './context/DeviceConnectionContext'
import { AppRoutes } from './routes/AppRoutes'
import { ToastProvider } from './ui'
import { preloadWatermarkPaths } from './shared/watermarkAssets'
import { preloadBorderLogoPaths } from './workspace/border/logoAssets'

function App() {
  useEffect(() => {
    // 预取所有水印图片的磁盘绝对路径，供 WebGPU 合成层使用
    preloadWatermarkPaths(style => window.luna.getWatermarkPath(style, 'image'))
    void preloadBorderLogoPaths()
  }, [])
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
