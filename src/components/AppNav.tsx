import { useCallback, useState, type MouseEvent } from 'react'
import { Camera, MonitorCog, Unplug } from 'lucide-react'
import { NavLink } from 'react-router-dom'

import type { CameraConnectionMode, ConnectionStatus, DeviceDefinition } from '../shared/types'
import { useExportProgress } from '../context/ExportProgressContext'
import { ExportProgressModal } from './ExportProgressModal'
import { HelpDialog } from './HelpDialog'
import { SendToPhoneDialog } from './SendToPhoneDialog'
import { CameraLivePreviewDialog } from './CameraLivePreviewDialog'
import { IconButton, Tooltip } from '../ui'
import { logger } from '../lib/rendererLogger'
import '../styles/nav.css'

interface AppNavProps {
  activeDevice?: DeviceDefinition
  connection: ConnectionStatus | null
  sourceMode: CameraConnectionMode
  onChangeConnection?: () => Promise<void>
}

export function AppNav({ activeDevice, connection, sourceMode, onChangeConnection }: AppNavProps) {
  const { exportProgress } = useExportProgress()
  const [previewOpen, setPreviewOpen] = useState(false)
  const isMac = window.navigator.platform.includes('Mac')
  const connected = Boolean(connection?.httpOk && connection.controlOk)
  const deviceName = connection?.deviceInfo?.deviceName ?? connection?.deviceName ?? activeDevice?.name ?? '设备'
  const statusText = connected
    ? `已${sourceMode === 'wired' ? '有线' : '无线'}连接 ${deviceName}`
    : `${deviceName} 未连接`
  const handleNavigationClick = useCallback((event: MouseEvent<HTMLAnchorElement>, target: string) => {
    const link = event.currentTarget
    const rect = link.getBoundingClientRect()
    const hit = document.elementFromPoint(event.clientX, event.clientY)
    const hitLink = hit?.closest('a')
    logger.info('[导航诊断] 顶部导航点击', {
      target,
      currentHash: window.location.hash,
      defaultPrevented: event.defaultPrevented,
      button: event.button,
      point: { x: event.clientX, y: event.clientY },
      linkRect: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      hitElement: hit ? `${hit.tagName.toLowerCase()}${hit.className ? `.${String(hit.className).replace(/\s+/g, '.')}` : ''}` : null,
      hitLink: hitLink?.getAttribute('href') ?? null,
    })
  }, [])

  return (
    <nav className={`global-nav${isMac ? ' global-nav-macos' : ''}`}>
      <div className="nav-inner">
        <div className="nav-links">
          <NavLink to="/library" onClick={(event) => handleNavigationClick(event, '/library')} className={({ isActive }) => (isActive ? 'active' : '')}>
            设备媒体库
          </NavLink>
          <NavLink to="/local-resources" onClick={(event) => handleNavigationClick(event, '/local-resources')} className={({ isActive }) => (isActive ? 'active' : '')}>
            本地资源
          </NavLink>
          <NavLink to="/ai-selection" onClick={(event) => handleNavigationClick(event, '/ai-selection')} className={({ isActive }) => (isActive ? 'active' : '')}>
            AI 选片
          </NavLink>
          <NavLink to="/workspace" onClick={(event) => handleNavigationClick(event, '/workspace')} className={({ isActive }) => (isActive ? 'active' : '')}>
            工作台
          </NavLink>
          <NavLink to="/settings" onClick={(event) => handleNavigationClick(event, '/settings')} className={({ isActive }) => (isActive ? 'active' : '')}>
            设置
          </NavLink>
          {(import.meta.env.DEV) && (
            <NavLink to="/ble-debug" onClick={(event) => handleNavigationClick(event, '/ble-debug')} className={({ isActive }) => (isActive ? 'active' : '')}>
              调试
            </NavLink>
          )}
          {/*
          {(import.meta.env.DEV || hiddenDevMode) && (
            <NavLink to="/device-debug" className={({ isActive }) => (isActive ? 'active' : '')}>
              设备调试
            </NavLink>
          )} */}
        </div>
        <div className="nav-status">
          <span className={connected ? 'status-dot ok' : 'status-dot'} />
          <span>{statusText}</span>
          {connected && (
            <Tooltip content="打开相机预览">
              <IconButton
                variant="ghost"
                size="mini"
                icon={<Camera size={15} />}
                aria-label="打开相机预览"
                title="打开相机预览"
                onClick={() => setPreviewOpen(true)}
              />
            </Tooltip>
          )}
          {sourceMode === 'wireless' && (
            <button className="nav-icon-button" onClick={() => window.luna.openWifiSettings()} title="打开 Wi-Fi 设置">
              <MonitorCog size={15} />
            </button>
          )}
          {connected && onChangeConnection && (
            <button className="nav-icon-button" onClick={() => void onChangeConnection()} title="更换连接方式">
              <Unplug size={15} />
            </button>
          )}
          <ExportProgressModal
            exportProgress={exportProgress}
            onRevealFile={(path) => void window.luna.revealFile(path)}
          />
          <SendToPhoneDialog />
          <HelpDialog />
          <CameraLivePreviewDialog
            open={previewOpen}
            connected={connected}
            deviceId={activeDevice?.id}
            host={connection?.host}
            mode={sourceMode}
            onOpenChange={setPreviewOpen}
          />
        </div>
      </div>
    </nav>
  )
}
