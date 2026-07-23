import { useMemo, useState } from 'react'

import type { AppSettings, DeviceDefinition, MockServerStatus } from '../shared/types'
import { SegmentedControl } from '../ui'
import { BluetoothTab } from './BluetoothTab'
import { DeveloperTab } from './DeveloperTab'
import { WifiTab } from './WifiTab'
import '../styles/bluetooth-debug.css'

interface DevPageProps {
  activeDevice?: DeviceDefinition
  settings: AppSettings | null
  setSettings: (updater: AppSettings | ((current: AppSettings | null) => AppSettings | null)) => void
  developerMode: boolean
  mockServerStatus: MockServerStatus | null
  startMockServer: (settings?: Partial<AppSettings>) => Promise<void>
  stopMockServer: () => Promise<void>
  chooseMockMediaDir: () => Promise<void>
  openDirectory: (targetPath: string | null | undefined) => void
}

type DebugTab = 'developer' | 'bluetooth' | 'wifi'

export function DevPage({
  activeDevice,
  settings,
  setSettings,
  developerMode,
  mockServerStatus,
  startMockServer,
  stopMockServer,
  chooseMockMediaDir,
  openDirectory,
}: DevPageProps) {
  const [activeTab, setActiveTab] = useState<DebugTab>('developer')

  const deviceName = activeDevice?.name ?? '当前设备'
  const configSummary = useMemo(() => {
    const bluetooth = activeDevice?.bluetooth
    if (!bluetooth) return '未配置 BLE 占位参数'
    return `${bluetooth.namePrefixes.join(' / ') || '任意设备'} · ${bluetooth.serviceUuid}`
  }, [activeDevice])

  return (
    <section className="ble-debug-surface">
      <div className="ble-debug-header">
        <div>
          <h1>调试工具</h1>
          <p>{deviceName} · {configSummary}</p>
        </div>
        <div className="debug-header-tools">
          <SegmentedControl
            ariaLabel="调试类型"
            className="debug-tabs"
            options={[
              { value: 'developer', label: '开发者' },
              { value: 'bluetooth', label: '蓝牙' },
              { value: 'wifi', label: 'Wi-Fi' },
            ]}
            value={activeTab}
            onChange={setActiveTab}
          />
          <span className="ble-status ble-status-idle">仅用于开发调试，打包版本不显示</span>
        </div>
      </div>

      {activeTab === 'bluetooth' && (
        <BluetoothTab activeDevice={activeDevice} />
      )}

      {activeTab === 'wifi' && (
        <WifiTab activeDevice={activeDevice} />
      )}

      {activeTab === 'developer' && (
        <DeveloperTab
          activeDevice={activeDevice}
          settings={settings}
          setSettings={setSettings}
          developerMode={developerMode}
          mockServerStatus={mockServerStatus}
          startMockServer={startMockServer}
          stopMockServer={stopMockServer}
          chooseMockMediaDir={chooseMockMediaDir}
          openDirectory={openDirectory}
        />
      )}
    </section>
  )
}
