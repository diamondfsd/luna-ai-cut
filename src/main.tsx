import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.tsx'
import { initRendererLogger } from './lib/rendererLogger'
import './index.css'
import './styles/variables.css'
import './styles/utilities.css'
import './styles/workspace.css'
import './styles/workspace-crop.css'
import './styles/workspace-color.css'
import './styles/workspace-sidebar.css'
import './ui/styles.css'
import './styles/responsive.css'

// 尽早初始化渲染进程日志系统，以捕获所有 console 输出
initRendererLogger()

document.title = `Luna AI Cut v${__APP_VERSION__}`

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
)

// ipcRenderer 未在 contextBridge 中暴露，此监听无意义
// 如有需要请通过 window.luna / window.deviceDebug API 通信
