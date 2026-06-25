import { MonitorCog } from 'lucide-react'
import { NavLink } from 'react-router-dom'

import type { ConnectionStatus, DeviceDefinition } from '../shared/types'
import { HelpDialog } from './HelpDialog'
import '../styles/nav.css'

interface AppNavProps {
  activeDevice?: DeviceDefinition
  connection: ConnectionStatus | null
  sourceMode: 'demo' | 'camera'
}

export function AppNav({ activeDevice, connection, sourceMode }: AppNavProps) {
  const connected = Boolean(connection?.httpOk && connection.controlOk)
  const deviceName = connection?.deviceName ?? activeDevice?.name ?? '设备'
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
          <NavLink to="/settings" className={({ isActive }) => (isActive ? 'active' : '')}>
            设置
          </NavLink>
          {import.meta.env.DEV && (
            <NavLink to="/ble-debug" className={({ isActive }) => (isActive ? 'active' : '')}>
              调试
            </NavLink>
          )}
        </div>
        <div className="nav-status">
          <span className={connected ? 'status-dot ok' : 'status-dot'} />
          <span>{statusText}</span>
          <button className="nav-icon-button" onClick={() => window.luna.openWifiSettings()} title="打开 Wi-Fi 设置">
            <MonitorCog size={15} />
          </button>
          <HelpDialog />
        </div>
      </div>
    </nav>
  )
}
