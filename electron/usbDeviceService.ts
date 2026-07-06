import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { UsbDeviceCandidate } from '../src/shared/types'

const execFileAsync = promisify(execFile)

interface SystemProfilerUsbNode {
  _name?: string
  manufacturer?: string
  serial_num?: string
  vendor_id?: string
  product_id?: string
  bcd_device?: string
  Media?: unknown
  _items?: SystemProfilerUsbNode[]
}

interface SystemProfilerUsbPayload {
  SPUSBDataType?: SystemProfilerUsbNode[]
}

interface WindowsPnpDevice {
  FriendlyName?: string
  InstanceId?: string
  Manufacturer?: string
  Class?: string
  Status?: string
}

const CAMERA_KEYWORDS = [
  'insta360',
  'arashi',
  'luna',
  'ptp',
  'mtp',
  'still image',
  'digital still camera',
]

function isAppleInternalDevice(name: string, manufacturer: string, busName: string): boolean {
  const text = `${name} ${manufacturer} ${busName}`.toLowerCase()
  return text.includes('apple') || text.includes('built-in') || text.includes('internal')
}

function matchesCameraDevice(name: string, manufacturer: string, busName: string, searchText: string): boolean {
  if (CAMERA_KEYWORDS.some((keyword) => searchText.includes(keyword))) return true
  if (!searchText.includes('camera')) return false
  return !isAppleInternalDevice(name, manufacturer, busName)
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function flattenUsbNodes(nodes: SystemProfilerUsbNode[] | undefined, busName = ''): UsbDeviceCandidate[] {
  if (!nodes?.length) return []

  const result: UsbDeviceCandidate[] = []
  for (const node of nodes) {
    const name = normalizeText(node._name)
    const manufacturer = normalizeText(node.manufacturer)
    const serialNumber = normalizeText(node.serial_num)
    const vendorId = normalizeText(node.vendor_id)
    const productId = normalizeText(node.product_id)
    const productVersion = normalizeText(node.bcd_device)
    const currentBusName = name && !vendorId && !productId ? name : busName
    const searchText = [
      name,
      manufacturer,
      serialNumber,
      vendorId,
      productId,
      currentBusName,
      node.Media ? 'media' : '',
    ].join(' ').toLowerCase()

    if (name && (vendorId || productId || manufacturer)) {
      const matched = matchesCameraDevice(name, manufacturer, currentBusName, searchText)
      if (matched) {
        result.push({
          id: `${vendorId || 'unknown'}:${productId || 'unknown'}:${serialNumber || name}`,
          name,
          manufacturer,
          serialNumber,
          vendorId,
          productId,
          productVersion,
          busName: currentBusName,
          transport: 'usb',
          matched,
          source: 'system_profiler',
        })
      }
    }

    result.push(...flattenUsbNodes(node._items, currentBusName))
  }
  return result
}

function uniqueDevices(devices: UsbDeviceCandidate[]): UsbDeviceCandidate[] {
  const seen = new Set<string>()
  return devices.filter((device) => {
    const key = `${device.vendorId}:${device.productId}:${device.serialNumber}:${device.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function scanMacUsbDevices(): Promise<UsbDeviceCandidate[]> {
  const { stdout } = await execFileAsync('/usr/sbin/system_profiler', ['SPUSBDataType', '-json'], {
    maxBuffer: 8 * 1024 * 1024,
    timeout: 15_000,
  })
  const payload = JSON.parse(stdout) as SystemProfilerUsbPayload
  return uniqueDevices(flattenUsbNodes(payload.SPUSBDataType))
}

function parseWindowsVidPid(instanceId: string): { vendorId?: string; productId?: string; serialNumber?: string } {
  const vid = instanceId.match(/VID_([0-9A-F]{4})/i)?.[1]
  const pid = instanceId.match(/PID_([0-9A-F]{4})/i)?.[1]
  const parts = instanceId.split('\\')
  const serialNumber = parts.length > 2 ? parts[parts.length - 1] : undefined
  return {
    vendorId: vid ? `0x${vid.toLowerCase()}` : undefined,
    productId: pid ? `0x${pid.toLowerCase()}` : undefined,
    serialNumber,
  }
}

function normalizeWindowsPnpPayload(stdout: string): WindowsPnpDevice[] {
  const text = stdout.trim()
  if (!text) return []
  const parsed = JSON.parse(text) as WindowsPnpDevice | WindowsPnpDevice[]
  return Array.isArray(parsed) ? parsed : [parsed]
}

function windowsPnpDeviceToCandidate(device: WindowsPnpDevice): UsbDeviceCandidate | null {
  const name = normalizeText(device.FriendlyName)
  const instanceId = normalizeText(device.InstanceId)
  const manufacturer = normalizeText(device.Manufacturer)
  const deviceClass = normalizeText(device.Class)
  const status = normalizeText(device.Status)
  if (!name || !instanceId) return null

  const searchText = [name, manufacturer, deviceClass, instanceId, status].join(' ').toLowerCase()
  const isLikelyUsbTransport = instanceId.toUpperCase().startsWith('USB') || searchText.includes('mtp') || searchText.includes('ptp')
  if (!isLikelyUsbTransport) return null
  if (!matchesCameraDevice(name, manufacturer, deviceClass, searchText)) return null

  const ids = parseWindowsVidPid(instanceId)
  return {
    id: instanceId,
    name,
    manufacturer,
    serialNumber: ids.serialNumber,
    vendorId: ids.vendorId,
    productId: ids.productId,
    busName: deviceClass,
    transport: 'usb',
    matched: true,
    source: 'powershell',
  }
}

async function scanWindowsUsbDevices(): Promise<UsbDeviceCandidate[]> {
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$classes = @("Camera", "Image", "WPD", "USB")',
    '$devices = Get-PnpDevice -PresentOnly | Where-Object {',
    '  $name = [string]$_.FriendlyName',
    '  $id = [string]$_.InstanceId',
    '  $class = [string]$_.Class',
    '  $text = "$name $id $class"',
    '  $id -like "USB*" -or $classes -contains $class -or $text -match "Insta360|Luna|PTP|MTP|Still Image|Digital Still Camera|Camera"',
    '} | Select-Object FriendlyName,InstanceId,Manufacturer,Class,Status',
    '$devices | ConvertTo-Json -Compress',
  ].join('; ')

  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ], {
    maxBuffer: 8 * 1024 * 1024,
    timeout: 15_000,
    windowsHide: true,
  })

  return uniqueDevices(
    normalizeWindowsPnpPayload(stdout)
      .map(windowsPnpDeviceToCandidate)
      .filter((device): device is UsbDeviceCandidate => Boolean(device)),
  )
}

export async function scanUsbDevices(): Promise<UsbDeviceCandidate[]> {
  if (process.platform === 'darwin') return scanMacUsbDevices()
  if (process.platform === 'win32') return scanWindowsUsbDevices()
  return []
}
