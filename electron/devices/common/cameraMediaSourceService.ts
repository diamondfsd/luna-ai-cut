import { cameraPathsForFiles } from './cameraDeletePaths'
import { deviceDefinitionFor } from '../definitions/deviceDefaults'
import { getLocalResourcesDir, getSettings, resolveLocalThumbnails, saveSettings } from '../../storage/fileService'
import type { IpcContext } from '../../ipc/context'
import {
  deleteMountedCameraFilesFromVolumes,
  listMountedCameraFilesFromVolumes,
  mountedCameraVolumesStatus,
  resolveMountedCameraVolumes,
} from './mountedCameraMediaSource'
import type {
  CameraDeleteResult,
  CameraMediaSourceAdapter,
  CameraMediaSourceCapabilities,
  CameraMediaSourceFilePageCallback,
  CameraMediaSourceOptions,
  CameraMediaSourcePreparationResult,
  CameraMediaSourceStatus,
  ConnectionStatus,
  DeviceDefinition,
  LunaFile,
} from '../../../src/shared/types'
import { djiSessionFor, disconnectDjiSession } from '../dji/djiCameraSession'
import { djiErrorDetails } from '../dji/djiLog'
import { DefaultLunaWirelessPreparation, type LunaWirelessPreparation } from '../insta360/lunaWirelessPreparation'
import { autoJoinDeviceWifi, restoreDeviceWifi } from '../../platform/network/wifiAutoJoinService'
import { stopCameraVideoStream } from './cameraVideoStreamService'
import { logMainError, logMainInfo, logMainWarn } from '../../infrastructure/loggerService'

const WIRELESS_CAPABILITIES: CameraMediaSourceCapabilities = {
  list: true,
  preview: true,
  copyToLocal: true,
  create: false,
  update: false,
  delete: true,
  watch: true,
  connection: {
    bluetoothActivation: false,
    bluetoothWifiCredentials: false,
    automaticWifiJoin: false,
    manualWifiCredentials: true,
  },
}

function wirelessCapabilities(definition: DeviceDefinition): CameraMediaSourceCapabilities {
  const lunaBluetoothAvailable = definition.id === 'luna-ultra' && (process.platform === 'darwin' || process.platform === 'win32')
  return {
    ...WIRELESS_CAPABILITIES,
    ...definition.mediaCapabilities,
    delete: definition.mediaCapabilities?.delete ?? definition.protocol === 'insta360',
    connection: {
      ...WIRELESS_CAPABILITIES.connection,
      bluetoothWifiCredentials: lunaBluetoothAvailable,
      automaticWifiJoin: (process.platform === 'darwin' || process.platform === 'win32') && definition.wifi?.autoJoin === true,
    },
  }
}

function isLoopbackHost(host: string): boolean {
  try {
    const hostname = new URL(host.includes('://') ? host : `http://${host}`).hostname
    return hostname === '127.0.0.1' || hostname === 'localhost'
  } catch {
    return false
  }
}

function withWifiFailureMessage(status: ConnectionStatus, wifiMessage: string, shouldIncludeWifiMessage: boolean): ConnectionStatus {
  if (!shouldIncludeWifiMessage || status.controlOk) return status
  return {
    ...status,
    message: `${wifiMessage}；${status.message}`,
  }
}

function wirelessStatus(status: ConnectionStatus, definition: DeviceDefinition, host: string): CameraMediaSourceStatus {
  return {
    ...status,
    mode: 'wireless',
    connected: Boolean(status.controlOk),
    sourceId: `wireless:${definition.id}:${host}`,
    capabilities: wirelessCapabilities(definition),
  }
}

function attachSourceDevice(files: LunaFile[], deviceId: string): LunaFile[] {
  const device = deviceDefinitionFor(deviceId)
  return files.map((file) => ({
    ...file,
    sourceDeviceId: file.sourceDeviceId ?? deviceId,
    sourceDeviceName: file.sourceDeviceName ?? device.name,
    cameraType: file.cameraType ?? device.name,
    watermarkProfileId: file.watermarkProfileId ?? deviceId,
  }))
}

class WirelessCameraMediaSource implements CameraMediaSourceAdapter {
  private lunaPreparation: LunaWirelessPreparation | null = null

  constructor(
    private readonly ctx: IpcContext,
    private readonly options: CameraMediaSourceOptions,
  ) {}

  private async values(): Promise<{ deviceId: string; host: string; storageId: string }> {
    const settings = await getSettings()
    const deviceId = this.options.deviceId ?? settings.activeDeviceId ?? 'luna-ultra'
    const device = deviceDefinitionFor(deviceId)
    return {
      deviceId,
      host: this.options.host || settings.cameraHost || device.defaultHost,
      storageId: this.options.storageId ?? settings.deviceStorage?.[deviceId] ?? 'all',
    }
  }

  private protocol(definition: DeviceDefinition) {
    switch (definition.protocol ?? 'insta360') {
      case 'go-ultra':
        return this.ctx.goUltraProtocol()
      case 'insta360':
        return this.ctx.lunaProtocol(definition.id)
      default:
        throw new Error(`暂不支持 ${definition.name} 的媒体协议`)
    }
  }

  async connect(): Promise<CameraMediaSourceStatus> {
    const { deviceId, host, storageId } = await this.values()
    const definition = deviceDefinitionFor(deviceId)
    const wifiSessionKey = `${deviceId}:${host}`
    const loopback = isLoopbackHost(host)
    const wifiJoin = loopback
      ? { attempted: false, connected: true, message: '模拟设备使用本机网络' }
      : await autoJoinDeviceWifi(
        definition.wifi,
        wifiSessionKey,
        this.options.wireless?.password,
        this.options.wireless?.ssid,
        definition.protocol === 'insta360'
          ? { host, port: definition.controlPort, protocol: 'insta360-stream' }
          : undefined,
      )
    const protocol = this.protocol(definition)
    if (!loopback && definition.wifi?.autoJoin === true && !wifiJoin.connected && wifiJoin.wifiPasswordRequired) {
      return wirelessStatus({
        deviceId,
        deviceName: definition.name,
        host,
        httpOk: false,
        controlOk: false,
        wifiSsid: wifiJoin.ssid,
        wifiPasswordRequired: wifiJoin.wifiPasswordRequired,
        message: wifiJoin.message,
      }, definition, host)
    }
    try {
      const status = await protocol.connect({ deviceId, host, storageId })
      await saveSettings({ cameraConnectionMode: 'wireless', activeDeviceId: deviceId, cameraHost: host })
      const statusWithWifiMessage = withWifiFailureMessage(
        status,
        wifiJoin.message,
        !loopback && definition.wifi?.autoJoin === true && !wifiJoin.connected,
      )
      if (!status.controlOk) {
        const restore = wifiJoin.attempted && wifiJoin.connected
          ? await restoreDeviceWifi(wifiSessionKey).catch(() => null)
          : null
        return wirelessStatus({
          ...statusWithWifiMessage,
          wifiSsid: statusWithWifiMessage.wifiSsid ?? wifiJoin.ssid,
          wifiPasswordRequired: wifiJoin.wifiPasswordRequired,
          message: restore?.attempted
            ? `${statusWithWifiMessage.message}；${restore.message}`
            : statusWithWifiMessage.message,
        }, definition, host)
      }
      return wirelessStatus({
        ...status,
        message: wifiJoin.connected ? `${wifiJoin.message}，${status.message}` : status.message,
      }, definition, host)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      const wifiHint = !loopback && definition.wifi?.autoJoin && !wifiJoin.connected ? `${wifiJoin.message}。` : ''
      const restore = wifiJoin.attempted && wifiJoin.connected
        ? await restoreDeviceWifi(wifiSessionKey).catch(() => null)
        : null
      const restoreHint = restore?.attempted ? `。${restore.message}` : ''
      throw new Error(`${wifiHint}${detail}${restoreHint}`)
    }
  }

  async prepareConnection(options: CameraMediaSourceOptions): Promise<CameraMediaSourcePreparationResult> {
    const { deviceId, host } = await this.values()
    const definition = deviceDefinitionFor(deviceId)
    if (deviceId !== 'luna-ultra' || definition.protocol !== 'insta360') {
      return {
        mode: 'wireless',
        preparation: 'already-connected',
        capabilities: wirelessCapabilities(definition).connection,
        message: '当前设备可以直接使用已连接的网络',
      }
    }
    this.lunaPreparation = new DefaultLunaWirelessPreparation(deviceId, host, this.ctx.win)
    const result = await this.lunaPreparation.prepare({ ...this.options, ...options })
    return {
      ...result,
      capabilities: result.capabilities ?? this.lunaPreparation.capabilities,
    }
  }

  async check(): Promise<CameraMediaSourceStatus> {
    const { deviceId, host } = await this.values()
    const definition = deviceDefinitionFor(deviceId)
    return wirelessStatus(await this.protocol(definition).checkStatus(host), definition, host)
  }

  async listFiles(): Promise<LunaFile[]> {
    const { deviceId, host, storageId } = await this.values()
    const definition = deviceDefinitionFor(deviceId)
    const files = attachSourceDevice(
      await this.protocol(definition).listFiles({ deviceId, host, storageId }),
      deviceId,
    )
    await saveSettings({
      cameraConnectionMode: 'wireless',
      cameraHost: host,
      deviceStorage: {
        ...(await getSettings()).deviceStorage,
        [deviceId]: storageId,
      },
    })
    await resolveLocalThumbnails(files, getLocalResourcesDir(await getSettings()))
    return files
  }

  async deleteFiles(files: LunaFile[]): Promise<CameraDeleteResult> {
    const { deviceId, host } = await this.values()
    const definition = deviceDefinitionFor(deviceId)
    if (definition.protocol !== 'insta360') throw new Error('当前设备暂不支持在应用中删除相机素材')
    return this.protocol(definition).deleteFiles(cameraPathsForFiles(files, host), { deviceId, host })
  }

  async disconnect(): Promise<void> {
    const { deviceId, host } = await this.values()
    const wifiSessionKey = `${deviceId}:${host}`
    try {
      await stopCameraVideoStream({ mode: 'wireless', deviceId, host })
      await this.protocol(deviceDefinitionFor(deviceId)).disconnect(host)
    } finally {
      await restoreDeviceWifi(wifiSessionKey).catch(() => undefined)
    }
  }
}

class DjiCameraMediaSource implements CameraMediaSourceAdapter {
  constructor(private readonly ctx: IpcContext, private readonly options: CameraMediaSourceOptions) {}

  private async values(): Promise<{ deviceId: string; host: string; storageId: string }> {
    const settings = await getSettings()
    const deviceId = this.options.deviceId ?? settings.activeDeviceId ?? 'dji-pocket-4'
    const profile = deviceDefinitionFor(deviceId)
    return {
      deviceId,
      host: this.options.host || settings.cameraHost || profile.defaultHost,
      storageId: this.options.storageId ?? settings.deviceStorage?.[deviceId] ?? 'all',
    }
  }

  async connect(): Promise<CameraMediaSourceStatus> {
    const { deviceId, host } = await this.values()
    const startedAt = Date.now()
    logMainInfo('[DJI 媒体入口] connect 开始', {
      deviceId,
      host,
      preparation: this.options.wireless?.preparation ?? 'bluetooth-auto',
      autoJoin: this.options.wireless?.autoJoin === true,
      preferExistingConnection: this.options.preferExistingConnection === true,
      hasSsid: Boolean(this.options.wireless?.ssid?.trim()),
      hasPassword: Boolean(this.options.wireless?.password),
    })
    try {
      const session = await djiSessionFor(deviceId, host, this.ctx.win)
      const status = await session.connect(this.options)
      await saveSettings({ cameraConnectionMode: 'wireless', activeDeviceId: deviceId, cameraHost: host })
      logMainInfo('[DJI 媒体入口] connect 完成', {
        deviceId,
        host,
        connected: status.connected,
        httpOk: status.httpOk,
        controlOk: status.controlOk,
        elapsedMs: Date.now() - startedAt,
      })
      return status
    } catch (error) {
      logMainError('[DJI 媒体入口] connect 异常', {
        deviceId,
        host,
        elapsedMs: Date.now() - startedAt,
        ...djiErrorDetails(error),
      })
      throw error
    }
  }

  async prepareConnection(options: CameraMediaSourceOptions): Promise<CameraMediaSourcePreparationResult> {
    const { deviceId, host } = await this.values()
    const startedAt = Date.now()
    const mergedOptions = { ...this.options, ...options }
    logMainInfo('[DJI 媒体入口] prepare-connection 开始', {
      deviceId,
      host,
      preparation: mergedOptions.wireless?.preparation ?? 'bluetooth-auto',
      autoJoin: mergedOptions.wireless?.autoJoin === true,
      hasSsid: Boolean(mergedOptions.wireless?.ssid?.trim()),
      hasPassword: Boolean(mergedOptions.wireless?.password),
    })
    try {
      const result = await (await djiSessionFor(deviceId, host, this.ctx.win)).prepareConnection(mergedOptions)
      logMainInfo('[DJI 媒体入口] prepare-connection 完成', {
        deviceId,
        host,
        preparation: result.preparation,
        hasCredentials: Boolean(result.credentials),
        elapsedMs: Date.now() - startedAt,
      })
      return result
    } catch (error) {
      logMainError('[DJI 媒体入口] prepare-connection 异常', {
        deviceId,
        host,
        elapsedMs: Date.now() - startedAt,
        ...djiErrorDetails(error),
      })
      throw error
    }
  }

  async check(): Promise<CameraMediaSourceStatus> {
    const { deviceId, host } = await this.values()
    const startedAt = Date.now()
    logMainInfo('[DJI 媒体入口] check 开始', { deviceId, host })
    try {
      const status = await (await djiSessionFor(deviceId, host, this.ctx.win)).check(this.options)
      logMainInfo('[DJI 媒体入口] check 完成', {
        deviceId,
        host,
        connected: status.connected,
        elapsedMs: Date.now() - startedAt,
      })
      return status
    } catch (error) {
      logMainWarn('[DJI 媒体入口] check 异常', {
        deviceId,
        host,
        elapsedMs: Date.now() - startedAt,
        ...djiErrorDetails(error),
      })
      throw error
    }
  }

  async listFiles(onPage?: CameraMediaSourceFilePageCallback): Promise<LunaFile[]> {
    const { deviceId, host, storageId } = await this.values()
    const startedAt = Date.now()
    logMainInfo('[DJI 媒体入口] list-files 开始', { deviceId, host, storageId })
    try {
      const session = await djiSessionFor(deviceId, host, this.ctx.win)
      const files = await session.listFiles(storageId, this.options, onPage)
      await saveSettings({
        cameraConnectionMode: 'wireless',
        cameraHost: host,
        deviceStorage: { ...(await getSettings()).deviceStorage, [deviceId]: storageId },
      })
      await resolveLocalThumbnails(files, getLocalResourcesDir(await getSettings()))
      logMainInfo('[DJI 媒体入口] list-files 完成', {
        deviceId,
        host,
        storageId,
        fileCount: files.length,
        elapsedMs: Date.now() - startedAt,
      })
      return files
    } catch (error) {
      logMainError('[DJI 媒体入口] list-files 异常', {
        deviceId,
        host,
        storageId,
        elapsedMs: Date.now() - startedAt,
        ...djiErrorDetails(error),
      })
      throw error
    }
  }

  async deleteFiles(files: LunaFile[]): Promise<CameraDeleteResult> {
    const { deviceId, host } = await this.values()
    const session = await djiSessionFor(deviceId, host, this.ctx.win)
    return session.deleteFiles(files, this.options)
  }

  async disconnect(): Promise<void> {
    const { deviceId, host } = await this.values()
    const startedAt = Date.now()
    logMainInfo('[DJI 媒体入口] disconnect 开始', { deviceId, host })
    try {
      await stopCameraVideoStream({ mode: 'wireless', deviceId, host })
      await disconnectDjiSession(deviceId, host)
      logMainInfo('[DJI 媒体入口] disconnect 完成', { deviceId, host, elapsedMs: Date.now() - startedAt })
    } catch (error) {
      logMainError('[DJI 媒体入口] disconnect 异常', {
        deviceId,
        host,
        elapsedMs: Date.now() - startedAt,
        ...djiErrorDetails(error),
      })
      throw error
    }
  }
}

class MountedCameraMediaSource implements CameraMediaSourceAdapter {
  constructor(private readonly options: CameraMediaSourceOptions) {}

  private async values(): Promise<{ deviceId: string; rootPath: string | undefined }> {
    const settings = await getSettings()
    return {
      deviceId: this.options.deviceId ?? settings.activeDeviceId ?? 'luna-ultra',
      rootPath: this.options.rootPath || settings.mountedCameraRoot || undefined,
    }
  }

  async connect(): Promise<CameraMediaSourceStatus> {
    const { deviceId, rootPath } = await this.values()
    const volumes = await resolveMountedCameraVolumes(rootPath)
    const status = mountedCameraVolumesStatus(volumes, deviceId)
    if (status.connected) {
      await saveSettings({
        cameraConnectionMode: 'wired',
        mountedCameraRoot: volumes.length === 1 ? volumes[0].rootPath : '',
        activeDeviceId: deviceId,
      })
    }
    return status
  }

  async check(): Promise<CameraMediaSourceStatus> {
    const { deviceId, rootPath } = await this.values()
    return mountedCameraVolumesStatus(await resolveMountedCameraVolumes(rootPath), deviceId)
  }

  async listFiles(): Promise<LunaFile[]> {
    const { deviceId, rootPath } = await this.values()
    const volumes = await resolveMountedCameraVolumes(rootPath)
    if (volumes.length === 0) throw new Error('未检测到包含 DCIM 的相机磁盘')
    const files = await listMountedCameraFilesFromVolumes(volumes, deviceId)
    await resolveLocalThumbnails(files, getLocalResourcesDir(await getSettings()))
    return files
  }

  async deleteFiles(files: LunaFile[]): Promise<CameraDeleteResult> {
    const { rootPath } = await this.values()
    const volumes = await resolveMountedCameraVolumes(rootPath)
    if (volumes.length === 0) throw new Error('未检测到包含 DCIM 的相机磁盘')
    return deleteMountedCameraFilesFromVolumes(volumes, files)
  }

  async disconnect(): Promise<void> {
    // 文件系统卷由操作系统管理，此处只关闭应用内媒体源。
  }
}

export function cameraMediaSourceFor(ctx: IpcContext, options: CameraMediaSourceOptions): CameraMediaSourceAdapter {
  const definition = deviceDefinitionFor(options.deviceId)
  if (definition.connectionSupported === false) throw new Error(`${definition.name} 暂不支持连接`)
  if (options.mode === 'wired') return new MountedCameraMediaSource(options)

  const factories: Record<NonNullable<DeviceDefinition['protocol']>, () => CameraMediaSourceAdapter> = {
    insta360: () => new WirelessCameraMediaSource(ctx, options),
    'go-ultra': () => new WirelessCameraMediaSource(ctx, options),
    dji: () => new DjiCameraMediaSource(ctx, options),
  }
  return factories[definition.protocol ?? 'insta360']()
}
