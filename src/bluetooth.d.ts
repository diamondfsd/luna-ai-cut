interface BluetoothLEScanFilter {
  name?: string
  namePrefix?: string
  services?: string[]
}

interface RequestDeviceOptions {
  acceptAllDevices?: boolean
  filters?: BluetoothLEScanFilter[]
  optionalServices?: string[]
}

interface BluetoothRemoteGATTServer {
  connected: boolean
  connect(): Promise<BluetoothRemoteGATTServer>
  disconnect(): void
  getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>
}

interface BluetoothRemoteGATTService {
  getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic>
}

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  value?: DataView
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>
  writeValue(value: Uint8Array): Promise<void>
}

interface BluetoothDevice {
  id: string
  name?: string
  gatt?: BluetoothRemoteGATTServer
}

interface Bluetooth {
  requestDevice(options: RequestDeviceOptions): Promise<BluetoothDevice>
}

interface Navigator {
  bluetooth: Bluetooth
}
