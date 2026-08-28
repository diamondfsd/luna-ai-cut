import { useState } from 'react'
import { Camera, MonitorCog, Unplug } from 'lucide-react'
import { NavLink } from 'react-router-dom'

import type { CameraConnectionMode, ConnectionStatus, DeviceDefinition } from '../shared/types'
import { useExportProgress } from '../context/ExportProgressContext'
import { ExportProgressModal } from './ExportProgressModal'
import { HelpDialog } from './HelpDialog'
import { SendToPhoneDialog } from './SendToPhoneDialog'
import { CameraLivePreviewDialog } from './CameraLivePreviewDialog'
import { IconButton, Tooltip } from '../ui'
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
  const connected = Boolean(connection?.httpOk && connection.controlOk)
  const deviceName = connection?.deviceInfo?.deviceName ?? connection?.deviceName ?? activeDevice?.name ?? '设备'
  const statusText = connected
    ? `已${sourceMode === 'wired' ? '有线' : '无线'}连接 ${deviceName}`
    : `${deviceName} 未连接`

  return (
    <nav className="global-nav">
      <div className="nav-inner">
        <div className="nav-links">
          <NavLink to="/library" className={({ isActive }) => (isActive ? 'active' : '')}>
            设备媒体库
          </NavLink>
          <NavLink to="/local-resources" className={({ isActive }) => (isActive ? 'active' : '')}>
            本地资源
          </NavLink>
          <NavLink to="/ai-selection" className={({ isActive }) => (isActive ? 'active' : '')}>
            AI 选片
          </NavLink>
          <NavLink to="/workspace" className={({ isActive }) => (isActive ? 'active' : '')}>
            工作台
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? 'active' : '')}>
            设置
          </NavLink>
          {(import.meta.env.DEV) && (
            <NavLink to="/ble-debug" className={({ isActive }) => (isActive ? 'active' : '')}>
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
