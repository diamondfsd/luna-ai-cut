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
  CameraMediaSourceOptions,
  CameraMediaSourcePreparationResult,
  CameraMediaSourceStatus,
  ConnectionStatus,
  DeviceDefinition,
  LunaFile,
} from '../../../src/shared/types'
import { djiSessionFor, disconnectDjiSession } from '../dji/djiCameraSession'
import { autoJoinDeviceWifi, restoreDeviceWifi } from '../../platform/network/wifiAutoJoinService'
import { stopCameraVideoStream } from './cameraVideoStreamService'

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
  return {
    ...WIRELESS_CAPABILITIES,
    ...definition.mediaCapabilities,
    delete: definition.mediaCapabilities?.delete ?? definition.protocol === 'insta360',
    connection: {
      ...WIRELESS_CAPABILITIES.connection,
      automaticWifiJoin: process.platform === 'darwin' && definition.wifi?.autoJoin === true,
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
  if (!shouldIncludeWifiMessage || (status.httpOk && status.controlOk)) return status
  return {
    ...status,
    message: `${wifiMessage}；${status.message}`,
  }
}

function wirelessStatus(status: ConnectionStatus, definition: DeviceDefinition, host: string): CameraMediaSourceStatus {
  return {
    ...status,
    mode: 'wireless',
    connected: Boolean(status.httpOk && status.controlOk),
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
        return this.ctx.lunaProtocol()
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
      ? { attempted: false, connected: false, message: '模拟设备跳过 Wi-Fi 自动连接' }
      : await autoJoinDeviceWifi(
        definition.wifi,
        wifiSessionKey,
        this.options.wireless?.password,
        this.options.wireless?.ssid,
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
      if (!status.httpOk || !status.controlOk) {
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
  constructor(private readonly options: CameraMediaSourceOptions) {}

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
    const session = await djiSessionFor(deviceId, host)
    const status = await session.connect(this.options)
    await saveSettings({ cameraConnectionMode: 'wireless', activeDeviceId: deviceId, cameraHost: host })
    return status
  }

  async prepareConnection(): Promise<CameraMediaSourcePreparationResult> {
    const { deviceId, host } = await this.values()
    return (await djiSessionFor(deviceId, host)).prepareConnection(this.options)
  }

  async check(): Promise<CameraMediaSourceStatus> {
    const { deviceId, host } = await this.values()
    return (await djiSessionFor(deviceId, host)).check(this.options)
  }

  async listFiles(): Promise<LunaFile[]> {
    const { deviceId, host, storageId } = await this.values()
    const session = await djiSessionFor(deviceId, host)
    const files = await session.listFiles(storageId, this.options)
    await saveSettings({
      cameraConnectionMode: 'wireless',
      cameraHost: host,
      deviceStorage: { ...(await getSettings()).deviceStorage, [deviceId]: storageId },
    })
    await resolveLocalThumbnails(files, getLocalResourcesDir(await getSettings()))
    return files
  }

  async deleteFiles(): Promise<CameraDeleteResult> {
    return { deleted: [], failed: [{ path: '', error: 'DJI 相机暂不支持在应用中删除相机素材' }] }
  }

  async disconnect(): Promise<void> {
    const { deviceId, host } = await this.values()
    await stopCameraVideoStream({ mode: 'wireless', deviceId, host })
    await disconnectDjiSession(deviceId, host)
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
    dji: () => new DjiCameraMediaSource(options),
  }
  return factories[definition.protocol ?? 'insta360']()
}
