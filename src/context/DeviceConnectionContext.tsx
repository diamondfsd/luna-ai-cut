/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useApp } from './AppContext'
import { logger } from '../lib/rendererLogger'
import type { AppSettings, ConnectionStatus, DeviceConnectionPhase, DeviceDefinition, MockServerStatus } from '../shared/types'

interface DeviceConnectionContextValue {
  activeDevice: DeviceDefinition | undefined
  cameraLibraryMounted: boolean
  connectDevice: () => Promise<void>
  devices: DeviceDefinition[]
  devicePhase: DeviceConnectionPhase
  isConnected: boolean
  mockServerStatus: MockServerStatus | null
  chooseMockMediaDir: () => Promise<void>
  showDeviceConnect: boolean
  sourceMode: 'camera'
  startMockServer: (settings?: Partial<AppSettings>) => Promise<void>
  stopMockServer: () => Promise<void>
}

const DeviceConnectionCtx = createContext<DeviceConnectionContextValue | null>(null)

function firstDevice(devices: DeviceDefinition[]): DeviceDefinition | undefined {
  return devices[0]
}

function activeDeviceFor(settings: AppSettings | null, devices: DeviceDefinition[]): DeviceDefinition | undefined {
  return devices.find((device) => device.id === settings?.activeDeviceId) ?? firstDevice(devices)
}

function connectionTimeoutStatus(host: string): Promise<ConnectionStatus> {
  return new Promise((resolve) => {
    setTimeout(() => resolve({ host, httpOk: false, controlOk: false, message: '连接超时' }), 4000)
  })
}

function failedMockStatus(settings: AppSettings, activeDevice: DeviceDefinition | undefined, message: string): MockServerStatus {
  const mock = activeDevice?.mock
  const host = settings.mockHost || mock?.host || ''
  const httpPort = settings.mockHttpPort || mock?.httpPort || 0
  return {
    running: false,
    rootDir: settings.mockMediaDir || '',
    host,
    httpPort,
    tcpPort: settings.mockTcpPort || mock?.tcpPort || 0,
    rateMbps: settings.mockRateMbps || mock?.rateMbps || 0,
    cameraHost: host && httpPort ? `${host}:${httpPort}` : host,
    message,
  }
}

export function DeviceConnectionProvider({ children }: { children: ReactNode }) {
  const { settings, setSettings, connection, setConnection } = useApp()
  const [devices, setDevices] = useState<DeviceDefinition[]>([])
  const [devicePhase, setDevicePhase] = useState<DeviceConnectionPhase>('idle')
  const [mockServerStatus, setMockServerStatus] = useState<MockServerStatus | null>(null)
  const [cameraLibraryMounted, setCameraLibraryMounted] = useState(false)

  const activeDevice = useMemo(() => activeDeviceFor(settings, devices), [devices, settings])
  const isConnected = devicePhase === 'connected' && Boolean(connection?.httpOk && connection.controlOk)
  const showDeviceConnect = !isConnected

  useEffect(() => {
    const initialize = async (): Promise<void> => {
      try {
        logger.info('[设备连接] 初始化：获取设置和设备列表')
        const [nextSettings, nextDevices] = await Promise.all([
          window.luna.getSettings(),
          window.luna.listDevices(),
        ])
        logger.info('[设备连接] 初始化完成', { devices: nextDevices.map(d => ({ id: d.id, name: d.name })), activeDeviceId: nextSettings.activeDeviceId })
        setDevices(nextDevices)
        setSettings(nextSettings)
        setConnection(null)
        setDevicePhase('idle')
        void window.luna.getMockServerStatus().then(setMockServerStatus).catch(() => undefined)
      } catch (error) {
        logger.error('[设备连接] 初始化失败', { error: error instanceof Error ? error.message : String(error) })
      }
    }
    void initialize()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return window.luna.onConnectionLost(() => {
      const host = settings?.cameraHost || activeDevice?.defaultHost || ''
      logger.warn('[设备连接] 连接丢失', { host })
      setConnection({ host, httpOk: false, controlOk: false, message: '设备连接已断开' })
      setDevicePhase('error')
      void window.luna.disconnect()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDevice?.defaultHost, settings?.cameraHost])

  useEffect(() => {
    if (!showDeviceConnect) setCameraLibraryMounted(true)
  }, [showDeviceConnect])

  async function connectDevice(): Promise<void> {
    try {
      const deviceId = settings?.activeDeviceId ?? activeDevice?.id
      const host = settings?.cameraHost ?? activeDevice?.defaultHost
      logger.info('[设备连接] 发起连接', { deviceId, host })
      if (!deviceId || !host) {
        const errMsg = '未配置设备连接地址'
        logger.warn('[设备连接] 无法连接', { deviceId, host, error: errMsg })
        setConnection({ host: host ?? '', httpOk: false, controlOk: false, message: errMsg })
        setDevicePhase('error')
        return
      }

      setDevicePhase('checking')
      const t0 = performance.now()
      const status = await Promise.race([
        window.luna.connectDevice({ deviceId, host }),
        connectionTimeoutStatus(host),
      ])
      const elapsed = ((performance.now() - t0) / 1000).toFixed(2)
      logger.info('[设备连接] 连接结果', { deviceId, host, httpOk: status.httpOk, controlOk: status.controlOk, message: status.message, elapsedSec: elapsed })
      setConnection(status)
      if (status.httpOk && status.controlOk) {
        setDevicePhase('connected')
        setCameraLibraryMounted(false)
        logger.info('[设备连接] 连接成功', { deviceId, host })
      } else {
        setDevicePhase('error')
        logger.warn('[设备连接] 连接失败', { deviceId, host, message: status.message })
      }
    } catch (error) {
      const host = settings?.cameraHost || activeDevice?.defaultHost || ''
      const errMsg = error instanceof Error ? error.message : String(error)
      logger.error('[设备连接] 连接异常', { host, error: errMsg })
      setConnection({ host, httpOk: false, controlOk: false, message: errMsg })
      setDevicePhase('error')
    }
  }

  async function chooseMockMediaDir(): Promise<void> {
    const dir = await window.luna.chooseMockMediaDir()
    if (!dir) return
    setSettings(await window.luna.saveSettings({ mockMediaDir: dir }))
  }

  async function startMockServer(nextSettings?: Partial<AppSettings>): Promise<void> {
    const baseSettings = { ...(settings ?? {}), ...nextSettings } as AppSettings
    try {
      const status = await window.luna.startMockServer(nextSettings)
      setMockServerStatus(status)
      const updated = await window.luna.getSettings()
      setSettings(updated)
      // 不自动连接，让用户手动连接
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setMockServerStatus(failedMockStatus(baseSettings, activeDevice, message))
    }
  }

  async function stopMockServer(): Promise<void> {
    const status = await window.luna.stopMockServer()
    setMockServerStatus(status)
    setSettings(await window.luna.saveSettings({ developerMode: false }))
    setConnection(null)
    setDevicePhase('idle')
  }

  return (
    <DeviceConnectionCtx.Provider
      value={{
        activeDevice,
        cameraLibraryMounted,
        connectDevice,
        devices,
        devicePhase,
        isConnected,
        mockServerStatus,
        chooseMockMediaDir,
        showDeviceConnect,
        sourceMode: 'camera',
        startMockServer,
        stopMockServer,
      }}
    >
      {children}
    </DeviceConnectionCtx.Provider>
  )
}

export function useDeviceConnection(): DeviceConnectionContextValue {
  const ctx = useContext(DeviceConnectionCtx)
  if (!ctx) throw new Error('useDeviceConnection must be used inside DeviceConnectionProvider')
  return ctx
}
