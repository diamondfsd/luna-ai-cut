import { useEffect, useRef, useState } from 'react'
import { Bluetooth, Loader2, Radio, Send, Unplug } from 'lucide-react'

import type { BluetoothDeviceCandidate, DeviceDefinition } from '../shared/types'
import { Button, Input } from '../ui'

interface BluetoothTabProps {
  activeDevice?: DeviceDefinition
}

type BleStatus = 'idle' | 'scanning' | 'selected' | 'connected' | 'error'

function normalizeUuid(uuid: string): string {
  return uuid.trim().toLowerCase()
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '').replace(/^0x/i, '')
  if (!clean || clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) {
    throw new Error('请输入偶数长度的十六进制内容')
  }
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = Number.parseInt(clean.slice(i, i + 2), 16)
  }
  return bytes
}

function bytesToHex(value: DataView): string {
  return [...new Uint8Array(value.buffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join(' ')
}

export function BluetoothTab({ activeDevice }: BluetoothTabProps) {
  const [status, setStatus] = useState<BleStatus>('idle')
  const [candidates, setCandidates] = useState<BluetoothDeviceCandidate[]>([])
  const [selectedDevice, setSelectedDevice] = useState<BluetoothDevice | null>(null)
  const [serviceUuid, setServiceUuid] = useState(activeDevice?.bluetooth?.serviceUuid ?? '')
  const [writeUuid, setWriteUuid] = useState(activeDevice?.bluetooth?.writeCharacteristicUuid ?? '')
  const [notifyUuid, setNotifyUuid] = useState(activeDevice?.bluetooth?.notifyCharacteristicUuid ?? '')
  const [payloadHex, setPayloadHex] = useState(activeDevice?.bluetooth?.wakePayloadHex ?? '0802')
  const [logs, setLogs] = useState<string[]>([])
  const writeCharacteristicRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null)
  const scanCancelledRef = useRef(false)

  useEffect(() => {
    setServiceUuid(activeDevice?.bluetooth?.serviceUuid ?? '')
    setWriteUuid(activeDevice?.bluetooth?.writeCharacteristicUuid ?? '')
    setNotifyUuid(activeDevice?.bluetooth?.notifyCharacteristicUuid ?? '')
    setPayloadHex(activeDevice?.bluetooth?.wakePayloadHex ?? '0802')
  }, [activeDevice])

  function appendLog(line: string): void {
    setLogs((current) => [`${new Date().toLocaleTimeString()} ${line}`, ...current].slice(0, 80))
  }

  async function scanBluetooth(): Promise<void> {
    scanCancelledRef.current = false
    setStatus('scanning')
    setCandidates([])
    setSelectedDevice(null)
    appendLog('开始原生蓝牙扫描')
    try {
      const devices = await window.luna.scanBluetoothDevices(8000)
      if (scanCancelledRef.current) return
      setCandidates(devices)
      setStatus(devices.length > 0 ? 'selected' : 'idle')
      appendLog(`原生扫描完成：${devices.length} 个设备`)
    } catch (error) {
      if (scanCancelledRef.current) return
      setStatus('error')
      appendLog(`扫描失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function cancelScan(): Promise<void> {
    scanCancelledRef.current = true
    await window.luna.cancelBluetoothScan()
    setStatus('idle')
    appendLog('取消蓝牙扫描')
  }

  async function chooseCandidate(deviceId: string): Promise<void> {
    const candidate = candidates.find((c) => c.deviceId === deviceId)
    if (!candidate?.deviceName) {
      appendLog(`无法选择：设备无名称 (${deviceId})`)
      return
    }

    try {
      appendLog(`正在匹配 ${candidate.deviceName} ...`)
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ name: candidate.deviceName }],
      })
      setSelectedDevice(device)
      setStatus('selected')
      appendLog(`已选择设备 ${device.name || device.id}`)
    } catch (error) {
      appendLog(`选择设备失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function connectGatt(): Promise<void> {
    if (!selectedDevice?.gatt) {
      setStatus('error')
      return
    }

    try {
      setStatus('scanning')
      const server = await selectedDevice.gatt.connect()
      const service = await server.getPrimaryService(normalizeUuid(serviceUuid))
      const writeCharacteristic = await service.getCharacteristic(normalizeUuid(writeUuid))
      writeCharacteristicRef.current = writeCharacteristic

      if (notifyUuid) {
        const notifyCharacteristic = await service.getCharacteristic(normalizeUuid(notifyUuid))
        notifyCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
          const target = event.target as BluetoothRemoteGATTCharacteristic
          if (target.value) appendLog(`通知：${bytesToHex(target.value)}`)
        })
        await notifyCharacteristic.startNotifications()
      }

      setStatus('connected')
      appendLog('GATT 已连接')
    } catch (error) {
      setStatus('error')
      appendLog(`连接失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function sendPayload(hex = payloadHex): Promise<void> {
    if (!writeCharacteristicRef.current) {
      setStatus('error')
      return
    }

    try {
      const bytes = hexToBytes(hex)
      await writeCharacteristicRef.current.writeValue(bytes)
      appendLog(`发送：${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(' ')}`)
    } catch (error) {
      setStatus('error')
      appendLog(`发送失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function disconnect(): Promise<void> {
    selectedDevice?.gatt?.disconnect()
    writeCharacteristicRef.current = null
    setStatus('idle')
    appendLog('断开蓝牙')
  }

  return (
    <div className="ble-debug-grid">
      <section className="ble-debug-panel">
        <h2><Bluetooth size={17} /> 扫描</h2>
        <div className="ble-actions">
          <Button variant="primary" onClick={scanBluetooth} disabled={status === 'scanning'} icon={status === 'scanning' ? <Loader2 className="spin" size={16} /> : <Radio size={16} />}>
            扫描设备
          </Button>
          {status === 'scanning' && (
            <Button variant="danger" onClick={cancelScan}>
              取消扫描
            </Button>
          )}
        </div>
        <div className="ble-device-list">
          {candidates.length === 0 && <p>扫描后候选设备会显示在这里。</p>}
          {candidates.map((device) => (
            <button key={device.deviceId} type="button" onClick={() => void chooseCandidate(device.deviceId)}>
              <strong>{device.deviceName}</strong>
              <span>{device.deviceId}{typeof device.rssi === 'number' ? ` · ${device.rssi} dBm` : ''}</span>
              {device.localName && device.localName !== device.deviceName && <span className="ble-adv-data">localName: {device.localName}</span>}
              {device.serviceUuids && device.serviceUuids.length > 0 && <span className="ble-adv-data">services: {device.serviceUuids.join(', ')}</span>}
            </button>
          ))}
        </div>
      </section>

      <section className="ble-debug-panel">
        <h2><Unplug size={17} /> GATT</h2>
        <label>
          <span>Service UUID</span>
          <Input variant="compact" fullWidth value={serviceUuid} onChange={(event) => setServiceUuid(event.target.value)} />
        </label>
        <label>
          <span>Write Characteristic UUID</span>
          <Input variant="compact" fullWidth value={writeUuid} onChange={(event) => setWriteUuid(event.target.value)} />
        </label>
        <label>
          <span>Notify Characteristic UUID</span>
          <Input variant="compact" fullWidth value={notifyUuid} onChange={(event) => setNotifyUuid(event.target.value)} />
        </label>
        <div className="ble-actions">
          <Button variant="primary" onClick={connectGatt} disabled={!selectedDevice}>连接 GATT</Button>
          <Button variant="secondary" onClick={disconnect}>断开</Button>
        </div>
      </section>

      <section className="ble-debug-panel">
        <h2><Send size={17} /> 发送消息</h2>
        <label>
          <span>Hex Payload</span>
          <Input variant="compact" fullWidth value={payloadHex} onChange={(event) => setPayloadHex(event.target.value)} />
        </label>
        <div className="ble-actions">
          <Button variant="primary" onClick={() => void sendPayload()} disabled={status !== 'connected'} icon={<Send size={16} />}>
            发送
          </Button>
          <Button variant="secondary" onClick={() => void sendPayload(activeDevice?.bluetooth?.wakePayloadHex ?? payloadHex)} disabled={status !== 'connected'}>
            发送唤醒占位
          </Button>
        </div>
      </section>

      <section className="ble-debug-panel ble-debug-log">
        <h2>日志</h2>
        {logs.length === 0 && <p>暂无日志。</p>}
        {logs.map((line) => <code key={line}>{line}</code>)}
      </section>
    </div>
  )
}
