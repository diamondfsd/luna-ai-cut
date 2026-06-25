import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

import type { BluetoothDeviceCandidate } from '../src/shared/types'

const CORE_BLUETOOTH_SCANNER_PATH = path.join(process.env.APP_ROOT || process.cwd(), 'electron', 'bluetoothCoreScanner.swift')

/** Swift 扫描器返回的完整设备信息（比 BluetoothDeviceCandidate 多字段） */
interface ExtendedDeviceInfo extends BluetoothDeviceCandidate {
  localName?: string
  manufacturerData?: string
  manufacturerText?: string
  txPower?: number
  isConnectable?: boolean
}

interface NativeBluetoothScanResult {
  success: boolean
  message: string
  data?: ExtendedDeviceInfo[]
  code?: string
  raw?: unknown
}

let activeScanProcess: ChildProcessWithoutNullStreams | null = null

export function cancelBluetoothScan(): void {
  if (activeScanProcess && !activeScanProcess.killed) {
    activeScanProcess.kill('SIGTERM')
    activeScanProcess = null
  }
}

export async function scanBluetoothDevices(timeoutMs = 8000): Promise<NativeBluetoothScanResult> {
  if (process.platform !== 'darwin') {
    return { success: false, code: 'UNSUPPORTED_PLATFORM', message: `当前平台暂不支持原生蓝牙扫描：${process.platform}` }
  }
  if (!existsSync(CORE_BLUETOOTH_SCANNER_PATH)) {
    return { success: false, code: 'CORE_BLUETOOTH_SCANNER_NOT_FOUND', message: '未找到 CoreBluetooth scanner' }
  }

  // 取消之前的扫描
  cancelBluetoothScan()

  return new Promise<NativeBluetoothScanResult>((resolve) => {
    const child = spawn('swift', [CORE_BLUETOOTH_SCANNER_PATH, String(timeoutMs)], {
      windowsHide: true,
    })
    activeScanProcess = child

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data: Buffer) => { stdout += data.toString() })
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString() })

    const cleanup = () => {
      if (activeScanProcess === child) activeScanProcess = null
    }

    child.on('close', (_code, signal) => {
      cleanup()
      // 被 cancelBluetoothScan 主动终止
      if (signal === 'SIGTERM') {
        resolve({ success: false, code: 'CANCELLED', message: '扫描已取消' })
        return
      }

      const raw = `${stdout}${stderr ? `\n${stderr}` : ''}`.trim()
      const jsonStart = raw.indexOf('{')
      const jsonEnd = raw.lastIndexOf('}')
      if (jsonStart < 0 || jsonEnd < jsonStart) {
        resolve({ success: false, code: 'CORE_BLUETOOTH_INVALID_JSON', message: 'CoreBluetooth scanner 未返回 JSON', raw })
        return
      }
      const result = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as NativeBluetoothScanResult
      // 过滤掉未命名的设备（deviceName 为空或纯空白）
      if (result.data) {
        result.data = result.data.filter((d) => d.deviceName && d.deviceName.trim().length > 0)
      }
      resolve(result)
    })

    child.on('error', (error) => {
      cleanup()
      resolve({ success: false, code: 'CORE_BLUETOOTH_PROCESS_ERROR', message: error.message })
    })
  })
}
