import { MonitorCog } from 'lucide-react'
import { NavLink } from 'react-router-dom'

import type { ConnectionStatus, DeviceDefinition } from '../shared/types'
import { useApp } from '../context/AppContext'
import { ExportProgressModal } from './ExportProgressModal'
import { HelpDialog } from './HelpDialog'
import { WorkspaceModeHeader, type CreativeModeId, type WorkspaceMode } from '../workspace/components/WorkspaceModeHeader'
import '../styles/nav.css'

interface AppNavProps {
  activeDevice?: DeviceDefinition
  connection: ConnectionStatus | null
  sourceMode: 'demo' | 'camera'
  showWorkspaceMode?: boolean
  workspaceMode?: WorkspaceMode
  creativeModeId?: CreativeModeId | null
  onModeChange?: (mode: WorkspaceMode) => void
  onCreativeModeChange?: (modeId: CreativeModeId | null) => void
}

export function AppNav({ activeDevice, connection, sourceMode, showWorkspaceMode, workspaceMode, creativeModeId, onModeChange, onCreativeModeChange }: AppNavProps) {
  const { exportProgress, hiddenDevMode } = useApp()
  const connected = Boolean(connection?.httpOk && connection.controlOk)
  const deviceName = connection?.deviceInfo?.deviceName ?? connection?.deviceName ?? activeDevice?.name ?? '设备'
  const statusText = connected
    ? `已连接 ${deviceName}`
    : connection?.message ?? (sourceMode === 'demo' ? `已连接 ${deviceName}（模拟）` : `${deviceName} 未连接`)

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
          <NavLink to="/workspace" className={({ isActive }) => (isActive ? 'active' : '')}>
            工作台
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? 'active' : '')}>
            设置
          </NavLink>
          {(import.meta.env.DEV || hiddenDevMode) && (
            <NavLink to="/ble-debug" className={({ isActive }) => (isActive ? 'active' : '')}>
              调试
            </NavLink>
          )}
          {(import.meta.env.DEV || hiddenDevMode) && (
            <NavLink to="/device-debug" className={({ isActive }) => (isActive ? 'active' : '')}>
              设备调试
            </NavLink>
          )}
        </div>
        {showWorkspaceMode && workspaceMode && onModeChange && onCreativeModeChange && (
          <div className="nav-center">
            <WorkspaceModeHeader
              variant="nav"
              mode={workspaceMode}
              creativeModeId={creativeModeId ?? null}
              onModeChange={onModeChange}
              onCreativeModeChange={onCreativeModeChange}
            />
          </div>
        )}
        <div className="nav-status">
          <span className={connected ? 'status-dot ok' : 'status-dot'} />
          <span>{statusText}</span>
          <button className="nav-icon-button" onClick={() => window.luna.openWifiSettings()} title="打开 Wi-Fi 设置">
            <MonitorCog size={15} />
          </button>
          <ExportProgressModal
            exportProgress={exportProgress}
            onRevealFile={(path) => void window.luna.revealFile(path)}
          />
          <HelpDialog />
        </div>
      </div>
    </nav>
  )
}
