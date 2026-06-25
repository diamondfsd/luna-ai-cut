import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'

import { DEFAULT_DEVICE, deviceDefinitionFor } from './deviceDefaults'
import { getSettings, saveSettings } from './settingsService'
import type { AppSettings, MockServerStatus } from '../src/shared/types'

let mockProcess: ChildProcessWithoutNullStreams | null = null
let mockStatus: MockServerStatus | null = null

function normalizePort(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value !== undefined && value > 0 && value < 65536 ? value : fallback
}

function mockServerScriptPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'luna_mock_server', 'server.mjs')
  }
  return path.join(process.env.APP_ROOT, 'luna_mock_server', 'server.mjs')
}

function currentMockStatus(settings: AppSettings, message?: string): MockServerStatus {
  const device = deviceDefinitionFor(settings.activeDeviceId)
  const host = settings.mockHost || device.mock.host
  const httpPort = normalizePort(settings.mockHttpPort, device.mock.httpPort)
  const tcpPort = normalizePort(settings.mockTcpPort, device.mock.tcpPort)
  const rateMbps = settings.mockRateMbps && settings.mockRateMbps > 0 ? settings.mockRateMbps : device.mock.rateMbps
  return {
    running: Boolean(mockProcess && !mockProcess.killed),
    rootDir: settings.mockMediaDir || '',
    host,
    httpPort,
    tcpPort,
    rateMbps,
    cameraHost: `${host}:${httpPort}`,
    message: message ?? (mockProcess && !mockProcess.killed ? 'Mock Server 运行中' : 'Mock Server 未启动'),
  }
}

export async function getMockStatus(): Promise<MockServerStatus> {
  return mockStatus ?? currentMockStatus(await getSettings())
}

export function mockTcpPortForHost(host: string): number | null {
  if (mockStatus?.cameraHost && host === mockStatus.cameraHost) return mockStatus.tcpPort
  return null
}

export async function stopMockServer(): Promise<MockServerStatus> {
  const settings = await getSettings()
  const child = mockProcess
  if (child && !child.killed) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1500)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      child.kill('SIGTERM')
    })
  }
  mockProcess = null
  mockStatus = currentMockStatus(settings, 'Mock Server 已停止')
  return mockStatus
}

export async function startMockServer(partial?: Partial<AppSettings>): Promise<MockServerStatus> {
  const settings = partial ? await saveSettings(partial) : await getSettings()
  await stopMockServer()

  const status = currentMockStatus(settings, 'Mock Server 启动中')
  if (!status.rootDir) {
    mockStatus = { ...status, running: false, message: '请先选择 Mock 素材目录' }
    throw new Error(mockStatus.message)
  }

  const child = spawn(process.execPath, [
    mockServerScriptPath(),
    '--root',
    status.rootDir,
    '--host',
    status.host,
    '--http-port',
    String(status.httpPort),
    '--tcp-port',
    String(status.tcpPort),
    '--rate-mbps',
    String(status.rateMbps),
  ])

  mockProcess = child
  mockStatus = { ...status, running: true, message: 'Mock Server 运行中' }

  child.stdout.on('data', (chunk) => {
    console.log(`[mock-server] ${String(chunk).trimEnd()}`)
  })
  child.stderr.on('data', (chunk) => {
    console.error(`[mock-server] ${String(chunk).trimEnd()}`)
  })
  child.on('exit', (code, signal) => {
    if (mockProcess === child) {
      mockProcess = null
      mockStatus = { ...mockStatus!, running: false, message: `Mock Server 已退出：${signal ?? code ?? 'unknown'}` }
    }
  })
  child.on('error', (error) => {
    if (mockProcess === child) {
      mockProcess = null
      mockStatus = { ...status, running: false, message: `Mock Server 启动失败：${error.message}` }
    }
  })

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, 500)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      reject(new Error(`Mock Server 启动失败：${signal ?? code ?? 'unknown'}`))
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })

  await saveSettings({ developerMode: true, cameraHost: status.cameraHost })
  return mockStatus
}

export function defaultControlPort(): number {
  return DEFAULT_DEVICE.controlPort
}
