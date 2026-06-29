import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.tsx'
import { initRendererLogger } from './lib/rendererLogger'
import './index.css'
import './styles/variables.css'
import './styles/utilities.css'
import './styles/workspace.css'
import './styles/workspace-color.css'
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

// Use contextBridge
window.ipcRenderer.on('main-process-message', (_event, message) => {
  console.log(message)
})
