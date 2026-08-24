import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'

import { DEFAULT_DEVICE, deviceDefinitionFor, deviceDefinitions } from '../../devices/definitions/deviceDefaults'
import { getSettings, saveSettings } from '../../storage/settingsService'
import type { AppSettings, MockServerConfig, MockServerStatus } from '../../../src/shared/types'

interface MockProcessRecord {
  child: ChildProcessWithoutNullStreams
  status: MockServerStatus
}

const mockProcesses = new Map<string, MockProcessRecord>()
const mockStatuses = new Map<string, MockServerStatus>()

function normalizePort(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value !== undefined && value > 0 && value < 65536 ? value : fallback
}

function mockServerScriptPath(dji: boolean): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, dji ? 'dji_mock_server' : 'luna_mock_server', 'server.mjs')
  }
  return path.join(process.env.APP_ROOT, dji ? 'dji_mock_server' : 'luna_mock_server', 'server.mjs')
}

function defaultMockConfig(deviceId: string): MockServerConfig {
  const device = deviceDefinitionFor(deviceId)
  return {
    rootDir: '',
    host: device.mock.host,
    httpPort: normalizePort(device.mock.httpPort, 18080),
    tcpPort: normalizePort(device.mock.tcpPort, device.controlPort),
    udpPort: normalizePort(device.mock.udpPort, device.protocol === 'dji' ? 19004 : 19001),
    rateMbps: device.mock.rateMbps > 0 ? device.mock.rateMbps : 30,
  }
}

function mockConfigFor(settings: AppSettings, deviceId: string): MockServerConfig {
  const configured = settings.mockServers?.[deviceId]
  const defaults = defaultMockConfig(deviceId)
  const isActiveDevice = settings.activeDeviceId === deviceId
  const legacy: Partial<MockServerConfig> = isActiveDevice
    ? {
        rootDir: settings.mockMediaDir,
        host: settings.mockHost,
        httpPort: settings.mockHttpPort,
        tcpPort: settings.mockTcpPort,
        rateMbps: settings.mockRateMbps,
      }
    : {}
  return {
    ...defaults,
    ...legacy,
    ...configured,
    rootDir: configured?.rootDir ?? legacy.rootDir ?? defaults.rootDir,
    host: configured?.host ?? legacy.host ?? defaults.host,
    httpPort: normalizePort(configured?.httpPort ?? legacy.httpPort, defaults.httpPort),
    tcpPort: normalizePort(configured?.tcpPort ?? legacy.tcpPort, defaults.tcpPort),
    udpPort: normalizePort(configured?.udpPort, defaults.udpPort),
    rateMbps: configured?.rateMbps && configured.rateMbps > 0
      ? configured.rateMbps
      : legacy.rateMbps && legacy.rateMbps > 0
        ? legacy.rateMbps
        : defaults.rateMbps,
  }
}

function statusFor(settings: AppSettings, deviceId: string, message?: string): MockServerStatus {
  const device = deviceDefinitionFor(deviceId)
  const config = mockConfigFor(settings, deviceId)
  const processRecord = mockProcesses.get(deviceId)
  const cached = mockStatuses.get(deviceId)
  return {
    deviceId,
    deviceName: device.name,
    running: Boolean(processRecord && !processRecord.child.killed),
    rootDir: config.rootDir,
    host: config.host,
    httpPort: config.httpPort,
    tcpPort: config.tcpPort,
    udpPort: config.udpPort,
    rateMbps: config.rateMbps,
    cameraHost: `${config.host}:${config.httpPort}`,
    message: message ?? cached?.message ?? (processRecord ? 'Mock Server 运行中' : 'Mock Server 未启动'),
  }
}

async function persistMockConfig(settings: AppSettings, deviceId: string, config: MockServerConfig): Promise<AppSettings> {
  const mockServers = { ...(settings.mockServers ?? {}), [deviceId]: config }
  const legacy = settings.activeDeviceId === deviceId
    ? {
        mockMediaDir: config.rootDir,
        mockHost: config.host,
        mockHttpPort: config.httpPort,
        mockTcpPort: config.tcpPort,
        mockRateMbps: config.rateMbps,
      }
    : {}
  return saveSettings({ mockServers, ...legacy })
}

export async function getMockServerStatuses(): Promise<MockServerStatus[]> {
  const settings = await getSettings()
  return deviceDefinitions().map((device) => statusFor(settings, device.id))
}

export async function getMockServerStatus(deviceId?: string): Promise<MockServerStatus> {
  const settings = await getSettings()
  return statusFor(settings, deviceId ?? settings.activeDeviceId ?? DEFAULT_DEVICE.id)
}

export function mockTcpPortForHost(host: string): number | null {
  for (const record of mockProcesses.values()) {
    if (record.status.cameraHost === host) return record.status.tcpPort
  }
  return null
}

export function mockUdpPortForHost(host: string): number | null {
  for (const record of mockProcesses.values()) {
    if (record.status.cameraHost === host) return record.status.udpPort
  }
  return null
}

async function stopOneMockServer(deviceId: string, settings: AppSettings): Promise<MockServerStatus> {
  const processRecord = mockProcesses.get(deviceId)
  if (processRecord && processRecord.child.exitCode === null) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1500)
      processRecord.child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      processRecord.child.kill('SIGTERM')
    })
  }
  mockProcesses.delete(deviceId)
  const status = statusFor(settings, deviceId, 'Mock Server 已停止')
  mockStatuses.set(deviceId, status)
  return status
}

export async function stopMockServer(deviceId?: string): Promise<MockServerStatus> {
  const settings = await getSettings()
  const targetIds = deviceId ? [deviceId] : [...mockProcesses.keys()]
  await Promise.all(targetIds.map((id) => stopOneMockServer(id, settings)))
  return statusFor(settings, deviceId ?? settings.activeDeviceId ?? DEFAULT_DEVICE.id, 'Mock Server 已停止')
}

export async function startMockServer(deviceId?: string, partial?: Partial<AppSettings>): Promise<MockServerStatus> {
  if (partial) await saveSettings(partial)
  const initialSettings = await getSettings()
  const targetDeviceId = deviceId ?? initialSettings.activeDeviceId ?? DEFAULT_DEVICE.id
  await stopMockServer(targetDeviceId)
  const settings = await getSettings()
  const config = mockConfigFor(settings, targetDeviceId)
  const persistedSettings = await persistMockConfig(settings, targetDeviceId, config)
  const device = deviceDefinitionFor(targetDeviceId)
  const startingStatus = statusFor(persistedSettings, targetDeviceId, 'Mock Server 启动中')

  if (!startingStatus.rootDir) {
    mockStatuses.set(targetDeviceId, { ...startingStatus, running: false, message: '请先为该设备选择 Mock 素材目录' })
    throw new Error('请先为该设备选择 Mock 素材目录')
  }

  const child = spawn(process.execPath, [
    mockServerScriptPath(device.protocol === 'dji'),
    '--root', startingStatus.rootDir,
    '--host', startingStatus.host,
    '--http-port', String(startingStatus.httpPort),
    '--tcp-port', String(startingStatus.tcpPort),
    '--udp-port', String(startingStatus.udpPort),
    '--rate-mbps', String(startingStatus.rateMbps),
    ...(device.protocol === 'dji' ? ['--model', device.mock.model || 'pocket4'] : []),
  ])
  const runningStatus = { ...startingStatus, running: true, message: 'Mock Server 运行中' }
  mockProcesses.set(targetDeviceId, { child, status: runningStatus })
  mockStatuses.set(targetDeviceId, runningStatus)

  child.stdout.on('data', (chunk) => console.log(`[mock-server:${targetDeviceId}] ${String(chunk).trimEnd()}`))
  child.stderr.on('data', (chunk) => console.error(`[mock-server:${targetDeviceId}] ${String(chunk).trimEnd()}`))
  child.on('exit', (code, signal) => {
    if (mockProcesses.get(targetDeviceId)?.child !== child) return
    mockProcesses.delete(targetDeviceId)
    mockStatuses.set(targetDeviceId, { ...runningStatus, running: false, message: `Mock Server 已退出：${signal ?? code ?? 'unknown'}` })
  })
  child.on('error', (error) => {
    if (mockProcesses.get(targetDeviceId)?.child !== child) return
    mockProcesses.delete(targetDeviceId)
    mockStatuses.set(targetDeviceId, { ...runningStatus, running: false, message: `Mock Server 启动失败：${error.message}` })
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

  await saveSettings({
    developerMode: true,
    ...(persistedSettings.activeDeviceId === targetDeviceId ? { cameraHost: runningStatus.cameraHost } : {}),
  })
  return runningStatus
}

export function defaultControlPort(): number {
  return DEFAULT_DEVICE.controlPort
}
