import { Camera, Check, Wifi } from 'lucide-react'

import type { ConnectionStatus, DeviceDefinition } from '../shared/types'
import { Button } from '../ui'
import lunaIcon from '../../public/luna-icon.png'
import pocket4Character from '../assets/device-characters/pocket-4.svg'
import pocket4ProCharacter from '../assets/device-characters/pocket-4-pro.svg'
import './SupportedDeviceList.css'

interface SupportedDeviceListProps {
  activeDevice?: DeviceDefinition
  devices: DeviceDefinition[]
  connection: ConnectionStatus | null
  disabled?: boolean
  onSelect: (deviceId: string) => Promise<void>
}

function supportedDevices(devices: DeviceDefinition[]): DeviceDefinition[] {
  return devices.filter((device) => device.id === 'luna-ultra' || device.protocol === 'dji')
}

function deviceVisual(device: DeviceDefinition) {
  if (device.id === 'luna-ultra') {
    return <img src={lunaIcon} alt="" />
  }
  if (device.id === 'dji-pocket-4') {
    return <img className="supported-device-character" src={pocket4Character} alt="" />
  }
  if (device.id === 'dji-pocket-4-pro') {
    return <img className="supported-device-character" src={pocket4ProCharacter} alt="" />
  }
  return <Camera size={30} strokeWidth={1.6} />
}

export function SupportedDeviceList({ activeDevice, devices, connection, disabled = false, onSelect }: SupportedDeviceListProps) {
  const connected = Boolean(connection?.httpOk && connection.controlOk)
  const options = supportedDevices(devices)

  return (
    <section className="supported-device-list" aria-label="支持的设备">
      <div className="supported-device-list-header">
        <div>
          <p>支持的设备</p>
          <span>选择设备后开始连接</span>
        </div>
        <span className="supported-device-list-count">{options.length} 款</span>
      </div>
      <div className="supported-device-grid">
        {options.map((device) => {
          const selected = activeDevice?.id === device.id
          return (
            <Button
              key={device.id}
              variant="secondary"
              className={`supported-device-card ${selected ? 'selected' : ''}`}
              disabled={disabled}
              onClick={() => void onSelect(device.id)}
            >
              <span className={`supported-device-visual ${device.protocol === 'dji' ? 'dji' : 'insta360'}`}>
                {deviceVisual(device)}
              </span>
              <span className="supported-device-copy">
                <strong>{device.name}</strong>
                <small>{device.vendor}</small>
                <em>{selected && connected ? <><Check size={12} />当前连接</> : selected ? '待连接' : <><Wifi size={12} />支持连接</>}</em>
              </span>
            </Button>
          )
        })}
      </div>
    </section>
  )
}
