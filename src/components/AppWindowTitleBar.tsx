import { Maximize2, Minus, X } from 'lucide-react'

import { IconButton } from '../ui'
import '../styles/app-window-titlebar.css'

export function AppWindowTitleBar() {
  return (
    <div className="app-window-titlebar" role="toolbar" aria-label="窗口控制">
      <div className="app-window-controls">
        <IconButton
          variant="ghost"
          size="mini"
          className="app-window-control app-window-control-close"
          icon={<X size={13} />}
          aria-label="关闭窗口"
          title="关闭窗口"
          onClick={() => void window.luna.closeWindow()}
        />
        <IconButton
          variant="ghost"
          size="mini"
          className="app-window-control"
          icon={<Minus size={13} />}
          aria-label="最小化窗口"
          title="最小化窗口"
          onClick={() => void window.luna.minimizeWindow()}
        />
        <IconButton
          variant="ghost"
          size="mini"
          className="app-window-control"
          icon={<Maximize2 size={12} />}
          aria-label="最大化窗口"
          title="最大化窗口"
          onClick={() => void window.luna.toggleMaximizeWindow()}
        />
      </div>
      <span className="app-window-title">Luna AI Cut v{__APP_VERSION__}</span>
    </div>
  )
}
