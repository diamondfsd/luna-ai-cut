/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useApp } from './AppContext'
import { logger } from '../lib/rendererLogger'
import type {
  AppSettings,
  CameraConnectionMode,
  CameraMediaSourceCapabilities,
  CameraMediaSourceOptions,
  CameraMediaSourcePreparationResult,
  CameraMediaSourceStatus,
  ConnectionStatus,
  DeviceConnectionPhase,
  DeviceDefinition,
  MockServerConfig,
  MockServerStatus,
} from '../shared/types'

interface DeviceConnectionContextValue {
  activeDevice: DeviceDefinition | undefined
  cameraLibraryMounted: boolean
  connectDevice: (rootPath?: string, deviceId?: string, wireless?: CameraMediaSourceOptions['wireless']) => Promise<void>
  prepareConnection: (preferExistingConnection?: boolean) => Promise<CameraMediaSourcePreparationResult | null>
  selectDevice: (deviceId: string) => Promise<void>
  chooseWiredCamera: () => Promise<void>
  connectionMode: CameraConnectionMode
  disconnectDevice: () => Promise<void>
  setConnectionMode: (mode: CameraConnectionMode) => Promise<void>
  devices: DeviceDefinition[]
  devicePhase: DeviceConnectionPhase
  isConnected: boolean
  mockServerStatuses: MockServerStatus[]
  chooseMockMediaDir: (deviceId?: string) => Promise<void>
  showDeviceConnect: boolean
  sourceMode: CameraConnectionMode
  sourceCapabilities: CameraMediaSourceCapabilities
  preparedDjiWifi: CameraMediaSourcePreparationResult['credentials'] | null
  startMockServer: (deviceId?: string, settings?: Partial<AppSettings>) => Promise<void>
  stopMockServer: (deviceId?: string) => Promise<void>
}

const DeviceConnectionCtx = createContext<DeviceConnectionContextValue | null>(null)

function firstDevice(devices: DeviceDefinition[]): DeviceDefinition | undefined {
  return devices[0]
}

function activeDeviceFor(settings: AppSettings | null, devices: DeviceDefinition[]): DeviceDefinition | undefined {
  return devices.find((device) => device.id === settings?.activeDeviceId) ?? firstDevice(devices)
}

const EMPTY_CAPABILITIES: CameraMediaSourceCapabilities = {
  list: false, preview: false, copyToLocal: false, create: false, update: false, delete: false, watch: false,
  connection: {
    bluetoothActivation: false,
    bluetoothWifiCredentials: false,
    automaticWifiJoin: false,
    manualWifiCredentials: false,
  },
}

function connectionTimeoutStatus(mode: CameraConnectionMode, host: string): Promise<CameraMediaSourceStatus> {
  return new Promise((resolve) => {
    setTimeout(() => resolve({
      mode, connected: false, sourceId: mode, capabilities: EMPTY_CAPABILITIES,
      host, httpOk: false, controlOk: false, message: '连接超时',
    }), mode === 'wired' ? 12000 : 75000)
  })
}

async function enrichConnectionStatus(status: ConnectionStatus): Promise<ConnectionStatus> {
  try {
    const diagnostics = await window.luna.collectNetworkDiagnostics(status.host)
    return {
      ...status,
      diagnosticsRaw: JSON.stringify(diagnostics, null, 2),
    }
  } catch (primaryError) {
    logger.warn('[设备连接] 网络诊断收集失败，回退到基础状态', {
      error: primaryError instanceof Error ? primaryError.message : String(primaryError),
    })
    try {
      const wifiStatus = await window.luna.getWifiStatus()
      return {
        ...status,
        diagnosticsRaw: JSON.stringify({ connection: status, wifiStatus, networkDiagnosticsError: primaryError instanceof Error ? primaryError.message : String(primaryError) }, null, 2),
      }
    } catch (fallbackError) {
      logger.warn('[设备连接] 获取网络状态失败', { error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError) })
      return {
        ...status,
        diagnosticsRaw: JSON.stringify({
          connection: status,
          wifiStatusError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          networkDiagnosticsError: primaryError instanceof Error ? primaryError.message : String(primaryError),
        }, null, 2),
      }
    }
  }
}

function failedMockStatus(settings: AppSettings, device: DeviceDefinition | undefined, message: string): MockServerStatus {
  const mock = device?.mock
  const host = settings.mockHost || mock?.host || ''
  const httpPort = settings.mockHttpPort || mock?.httpPort || 0
  return {
    deviceId: device?.id ?? settings.activeDeviceId ?? '',
    deviceName: device?.name ?? '当前设备',
    running: false,
    rootDir: settings.mockMediaDir || '',
    host,
    httpPort,
    tcpPort: settings.mockTcpPort || mock?.tcpPort || 0,
    udpPort: mock?.udpPort || 0,
    rateMbps: settings.mockRateMbps || mock?.rateMbps || 0,
    cameraHost: host && httpPort ? `${host}:${httpPort}` : host,
    message,
  }
}

function userFacingConnectionError(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error)
  const message = rawMessage
    .replace(/^Error invoking remote method '[^']+':\s*Error:\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
  return message || '连接失败，请重试'
}

export function DeviceConnectionProvider({ children }: { children: ReactNode }) {
  const { settings, setSettings, connection, setConnection } = useApp()
  const [devices, setDevices] = useState<DeviceDefinition[]>([])
  const [devicePhase, setDevicePhase] = useState<DeviceConnectionPhase>('idle')
  const [mockServerStatuses, setMockServerStatuses] = useState<MockServerStatus[]>([])
  const [cameraLibraryMounted, setCameraLibraryMounted] = useState(false)
  const [connectionMode, setConnectionModeState] = useState<CameraConnectionMode>('wireless')
  const [preparedDjiWifi, setPreparedDjiWifi] = useState<CameraMediaSourcePreparationResult['credentials'] & { deviceId: string } | null>(null)

  const activeDevice = useMemo(() => activeDeviceFor(settings, devices), [devices, settings])
  const isConnected = devicePhase === 'connected' && Boolean(connection?.httpOk && connection.controlOk)
  const showDeviceConnect = !isConnected
  const sourceCapabilities = (connection as CameraMediaSourceStatus | null)?.capabilities ?? EMPTY_CAPABILITIES

  useEffect(() => {
    const initialize = async (): Promise<void> => {
      try {
        logger.info('[设备连接] 初始化：获取设置和设备列表')
        const [nextSettings, nextDevices] = await Promise.all([
          window.luna.getSettings(),
          window.luna.listDevices(),
        ])
        logger.info('[设备连接] 初始化完成', { devices: nextDevices.map(d => ({ id: d.id, name: d.name })), activeDeviceId: nextSettings.activeDeviceId })
        const nextActiveDevice = nextDevices.find((device) => device.id === nextSettings.activeDeviceId) ?? nextDevices[0]
        const normalizedSettings = nextActiveDevice && nextActiveDevice.id !== nextSettings.activeDeviceId
          ? await window.luna.saveSettings({
              activeDeviceId: nextActiveDevice.id,
              cameraHost: nextActiveDevice.defaultHost,
              cameraConnectionMode: 'wireless',
              mountedCameraRoot: '',
            })
          : nextSettings
        setDevices(nextDevices)
        setSettings(normalizedSettings)
        setConnectionModeState(normalizedSettings.cameraConnectionMode ?? 'wireless')
        setConnection(null)
        setDevicePhase('idle')
        void window.luna.getMockServerStatuses().then(setMockServerStatuses).catch(() => undefined)
      } catch (error) {
        logger.error('[设备连接] 初始化失败', { error: error instanceof Error ? error.message : String(error) })
      }
    }
    void initialize()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return window.luna.onConnectionLost(() => {
      if (connectionMode !== 'wireless') return
      const host = settings?.cameraHost || activeDevice?.defaultHost || ''
      logger.warn('[设备连接] 连接丢失', { host })
      setConnection({ host, httpOk: false, controlOk: false, message: '设备连接已断开' })
      setDevicePhase('error')
      void window.luna.cameraSource.disconnect({
        mode: 'wireless',
        deviceId: settings?.activeDeviceId ?? activeDevice?.id,
        host,
      }).catch(() => window.luna.disconnect())
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDevice?.defaultHost, connectionMode, settings?.cameraHost])

  useEffect(() => {
    if (connectionMode !== 'wired' || !isConnected) return
    const timer = window.setInterval(() => {
      void window.luna.cameraSource.check({
        mode: 'wired',
        deviceId: settings?.activeDeviceId,
        rootPath: settings?.mountedCameraRoot,
      }).then((status) => {
        if (status.connected) return
        setConnection(status)
        setDevicePhase('error')
      }).catch(() => {
        const disconnectedStatus: CameraMediaSourceStatus = {
          mode: 'wired',
          connected: false,
          sourceId: settings?.mountedCameraRoot || 'mounted-camera',
          capabilities: EMPTY_CAPABILITIES,
          host: '',
          httpOk: false,
          controlOk: false,
          message: '相机磁盘已断开',
        }
        setConnection(disconnectedStatus)
        setDevicePhase('error')
      })
    }, 2000)
    return () => window.clearInterval(timer)
  }, [connectionMode, isConnected, setConnection, settings?.activeDeviceId, settings?.mountedCameraRoot])

  useEffect(() => {
    if (!showDeviceConnect) setCameraLibraryMounted(true)
  }, [showDeviceConnect])

  async function connectDevice(
    rootPath?: string,
    requestedDeviceId?: string,
    wirelessOverride?: CameraMediaSourceOptions['wireless'],
  ): Promise<void> {
    try {
      const latestSettings = await window.luna.getSettings().catch(() => settings)
      const deviceId = requestedDeviceId ?? latestSettings?.activeDeviceId ?? activeDevice?.id
      const requestedDevice = devices.find((device) => device.id === requestedDeviceId)
      const mode = requestedDeviceId ? 'wireless' : connectionMode
      const host = requestedDeviceId
        ? latestSettings?.activeDeviceId === requestedDeviceId
          ? latestSettings.cameraHost
          : requestedDevice?.defaultHost
        : latestSettings?.cameraHost ?? activeDevice?.defaultHost
      logger.info('[设备连接] 发起连接', { mode, deviceId, host, rootPath })
      if (!deviceId || (mode === 'wireless' && !host)) {
        const errMsg = '未配置设备连接地址'
        logger.warn('[设备连接] 无法连接', { deviceId, host, error: errMsg })
        setConnection({ host: host ?? '', httpOk: false, controlOk: false, message: errMsg })
        setDevicePhase('error')
        return
      }

      setDevicePhase('checking')
      const t0 = performance.now()
      const preparedWifi = preparedDjiWifi?.deviceId === deviceId ? preparedDjiWifi : null
      const wireless = wirelessOverride ?? (preparedWifi ? {
        preparation: 'bluetooth' as const,
        ssid: preparedWifi.ssid,
        password: preparedWifi.password,
      } : undefined)
      const status = await Promise.race([
        window.luna.cameraSource.connect({
          mode,
          deviceId,
          host,
          rootPath: rootPath || latestSettings?.mountedCameraRoot,
          wireless,
        }),
        connectionTimeoutStatus(mode, host ?? ''),
      ])
      const elapsed = ((performance.now() - t0) / 1000).toFixed(2)
      const enrichedStatus = status.connected || mode === 'wired' ? status : await enrichConnectionStatus(status)
      setConnection(enrichedStatus)
      if (status.connected) {
        const updated = await window.luna.getSettings()
        setSettings(updated)
        setDevicePhase('connected')
        setCameraLibraryMounted(false)
        logger.info('[设备连接] 连接成功', { deviceId, host, elapsedSec: elapsed })
      } else {
        setDevicePhase('error')
        logger.warn('[设备连接] 连接失败', {
          deviceId,
          host,
          httpOk: enrichedStatus.httpOk,
          controlOk: enrichedStatus.controlOk,
          message: enrichedStatus.message,
          elapsedSec: elapsed,
          diagnosticsRaw: enrichedStatus.diagnosticsRaw,
        })
      }
    } catch (error) {
      const host = settings?.cameraHost || activeDevice?.defaultHost || ''
      const errMsg = userFacingConnectionError(error)
      logger.error('[设备连接] 连接异常', { host, error: errMsg })
      setConnection({ host, httpOk: false, controlOk: false, message: errMsg })
      setDevicePhase('error')
    }
  }

  async function prepareConnection(preferExistingConnection = false): Promise<CameraMediaSourcePreparationResult | null> {
    const latestSettings = await window.luna.getSettings().catch(() => settings)
    const deviceId = latestSettings?.activeDeviceId ?? activeDevice?.id
    const device = devices.find((item) => item.id === deviceId) ?? activeDevice
    const host = latestSettings?.cameraHost ?? device?.defaultHost ?? ''
    if (!deviceId || !host) {
      setConnection({ host, httpOk: false, controlOk: false, message: '未配置设备连接地址' })
      setDevicePhase('error')
      return null
    }

    setDevicePhase('checking')
    try {
      const result = await window.luna.cameraSource.prepareConnection({
        mode: 'wireless',
        deviceId,
        host,
        preferExistingConnection,
      })
      if (result.credentials) {
        setPreparedDjiWifi({ ...result.credentials, deviceId })
      }
      setConnection({
        deviceId,
        deviceName: device?.name,
        host,
        httpOk: false,
        controlOk: false,
        message: result.message,
        deviceInfo: result.credentials ? { deviceName: device?.name, ssid: result.credentials.ssid, wifiPassword: result.credentials.password, rawStrings: [] } : undefined,
      })
      setDevicePhase('idle')
      return result
    } catch (error) {
      const message = userFacingConnectionError(error)
      setConnection({ host, httpOk: false, controlOk: false, message })
      setDevicePhase('idle')
      return { mode: 'wireless', preparation: 'already-connected', message }
    }
  }

  async function selectDevice(deviceId: string): Promise<void> {
    const nextDevice = devices.find((device) => device.id === deviceId)
    if (!nextDevice || nextDevice.id === activeDevice?.id) return

    await window.luna.cameraSource.disconnect({
      mode: connectionMode,
      deviceId: settings?.activeDeviceId ?? activeDevice?.id,
      host: settings?.cameraHost,
      rootPath: settings?.mountedCameraRoot,
    }).catch(() => undefined)

    setConnection(null)
    setDevicePhase('idle')
    setCameraLibraryMounted(false)
    setPreparedDjiWifi(null)
    setConnectionModeState('wireless')

    const nextSettings = await window.luna.saveSettings({
      activeDeviceId: nextDevice.id,
      cameraHost: nextDevice.defaultHost,
      cameraConnectionMode: 'wireless',
      mountedCameraRoot: '',
      mockHost: nextDevice.mock.host,
      mockHttpPort: nextDevice.mock.httpPort,
      mockTcpPort: nextDevice.mock.tcpPort,
      mockRateMbps: nextDevice.mock.rateMbps,
    })
    setSettings(nextSettings)

    const selectedMockStatus = mockServerStatuses.find((status) => status.deviceId === nextDevice.id)
    const savedMock = nextSettings.mockServers?.[nextDevice.id]
    const mockHost = savedMock?.host ?? nextDevice.mock.host
    const mockHttpPort = savedMock?.httpPort ?? nextDevice.mock.httpPort
    const mockTcpPort = savedMock?.tcpPort ?? nextDevice.mock.tcpPort
    const mockRateMbps = savedMock?.rateMbps ?? nextDevice.mock.rateMbps
    const cameraHost = nextSettings.developerMode && selectedMockStatus?.running
      ? selectedMockStatus.cameraHost
      : nextDevice.defaultHost
    const updated = await window.luna.saveSettings({ mockHost, mockHttpPort, mockTcpPort, mockRateMbps, cameraHost })
    setSettings(updated)
  }

  async function chooseWiredCamera(): Promise<void> {
    try {
      const volume = await window.luna.cameraSource.chooseMounted()
      if (!volume) return
      const updated = await window.luna.getSettings()
      setSettings(updated)
      await connectDevice(volume.rootPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setConnection({ host: '', httpOk: false, controlOk: false, message })
      setDevicePhase('error')
    }
  }

  async function setConnectionMode(mode: CameraConnectionMode): Promise<void> {
    if (mode === connectionMode) return
    if (isConnected) {
      await window.luna.cameraSource.disconnect({
        mode: connectionMode,
        deviceId: settings?.activeDeviceId,
        host: settings?.cameraHost,
        rootPath: settings?.mountedCameraRoot,
      }).catch(() => undefined)
    }
    setConnectionModeState(mode)
    setConnection(null)
    setDevicePhase('idle')
    setCameraLibraryMounted(false)
    setPreparedDjiWifi(null)
    setSettings(await window.luna.saveSettings({ cameraConnectionMode: mode }))
  }

  async function disconnectDevice(): Promise<void> {
    await window.luna.cameraSource.disconnect({
      mode: connectionMode,
      deviceId: settings?.activeDeviceId,
      host: settings?.cameraHost,
      rootPath: settings?.mountedCameraRoot,
    }).catch(() => undefined)
    setConnection(null)
    setDevicePhase('idle')
    setCameraLibraryMounted(false)
    setPreparedDjiWifi(null)
  }

  async function chooseMockMediaDir(deviceId = activeDevice?.id): Promise<void> {
    const dir = await window.luna.chooseMockMediaDir()
    if (!dir || !deviceId) return
    const current = await window.luna.getSettings()
    const device = devices.find((item) => item.id === deviceId) ?? activeDevice
    if (!device) return
    const existing = current.mockServers?.[deviceId]
    const config: MockServerConfig = {
      rootDir: dir,
      host: existing?.host ?? device.mock.host,
      httpPort: existing?.httpPort ?? device.mock.httpPort,
      tcpPort: existing?.tcpPort ?? device.mock.tcpPort,
      udpPort: existing?.udpPort ?? device.mock.udpPort ?? (device.protocol === 'dji' ? 19004 : 19001),
      rateMbps: existing?.rateMbps ?? device.mock.rateMbps,
    }
    setSettings(await window.luna.saveSettings({
      mockServers: { ...(current.mockServers ?? {}), [deviceId]: config },
      ...(current.activeDeviceId === deviceId ? { mockMediaDir: dir } : {}),
    }))
  }

  async function startMockServer(deviceId = activeDevice?.id, nextSettings?: Partial<AppSettings>): Promise<void> {
    if (!deviceId) return
    const baseSettings = { ...(settings ?? {}), ...nextSettings } as AppSettings
    const device = devices.find((item) => item.id === deviceId) ?? activeDevice
    try {
      await window.luna.startMockServer(deviceId, nextSettings)
      setMockServerStatuses(await window.luna.getMockServerStatuses())
      const updated = await window.luna.getSettings()
      setSettings(updated)
      // 不自动连接，让用户手动连接
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failed = failedMockStatus(baseSettings, device, message)
      setMockServerStatuses((current) => [...current.filter((status) => status.deviceId !== deviceId), failed])
    }
  }

  async function stopMockServer(deviceId?: string): Promise<void> {
    await window.luna.stopMockServer(deviceId)
    setMockServerStatuses(await window.luna.getMockServerStatuses())
    if (!deviceId) setSettings(await window.luna.saveSettings({ developerMode: false }))
  }

  return (
    <DeviceConnectionCtx.Provider
      value={{
        activeDevice,
        cameraLibraryMounted,
        chooseWiredCamera,
        connectDevice,
        prepareConnection,
        selectDevice,
        connectionMode,
        disconnectDevice,
        devices,
        devicePhase,
        isConnected,
        mockServerStatuses,
        chooseMockMediaDir,
        showDeviceConnect,
        sourceMode: connectionMode,
        sourceCapabilities,
        preparedDjiWifi,
        setConnectionMode,
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
