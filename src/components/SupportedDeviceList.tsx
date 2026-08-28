import type { DeviceDefinition } from '../shared/types'
import { Button } from '../ui'
import './SupportedDeviceList.css'

interface SupportedDeviceListProps {
  activeDevice?: DeviceDefinition
  devices: DeviceDefinition[]
  disabled?: boolean
  onSelect: (deviceId: string) => Promise<void>
}

function supportedDevices(devices: DeviceDefinition[]): DeviceDefinition[] {
  return devices.filter((device) => device.connectionSupported !== false && (device.protocol === 'insta360' || device.protocol === 'go-ultra' || device.protocol === 'dji'))
}

export function SupportedDeviceList({ activeDevice, devices, disabled = false, onSelect }: SupportedDeviceListProps) {
  const options = supportedDevices(devices)

  return (
    <section className="supported-device-list" aria-label="支持的设备">
      <div className="supported-device-list-header">
        <div>
          <p>设备</p>
          <span>选择要连接的相机</span>
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
              <span className="supported-device-copy">
                <strong>{device.name}</strong>
              </span>
            </Button>
          )
        })}
      </div>
    </section>
  )
}
