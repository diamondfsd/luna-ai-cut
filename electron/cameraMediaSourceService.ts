import { cameraPathsForFiles } from './cameraDeletePaths'
import { deviceDefinitionFor } from './deviceDefaults'
import { getLocalResourcesDir, getSettings, resolveLocalThumbnails, saveSettings } from './fileService'
import type { IpcContext } from './ipcContext'
import {
  deleteMountedCameraFilesFromVolumes,
  listMountedCameraFilesFromVolumes,
  mountedCameraVolumesStatus,
  resolveMountedCameraVolumes,
} from './mountedCameraMediaSource'
import type {
  CameraDeleteResult,
  CameraMediaSourceCapabilities,
  CameraMediaSourceOptions,
  CameraMediaSourceStatus,
  ConnectionStatus,
  LunaFile,
} from '../src/shared/types'

const WIRELESS_CAPABILITIES: CameraMediaSourceCapabilities = {
  list: true,
  preview: true,
  copyToLocal: true,
  create: false,
  update: false,
  delete: true,
  watch: true,
}

export interface CameraMediaSourceAdapter {
  connect(): Promise<CameraMediaSourceStatus>
  check(): Promise<CameraMediaSourceStatus>
  listFiles(): Promise<LunaFile[]>
  deleteFiles(files: LunaFile[]): Promise<CameraDeleteResult>
  disconnect(): Promise<void>
}

function wirelessStatus(status: ConnectionStatus, deviceId: string, host: string): CameraMediaSourceStatus {
  return {
    ...status,
    mode: 'wireless',
    connected: Boolean(status.httpOk && status.controlOk),
    sourceId: `wireless:${deviceId}:${host}`,
    capabilities: {
      ...WIRELESS_CAPABILITIES,
      delete: deviceId === 'luna-ultra',
    },
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

  private protocol(deviceId: string) {
    return deviceId === 'go-ultra' ? this.ctx.goUltraProtocol() : this.ctx.lunaProtocol()
  }

  async connect(): Promise<CameraMediaSourceStatus> {
    const { deviceId, host, storageId } = await this.values()
    const status = await this.protocol(deviceId).connect({ deviceId, host, storageId })
    await saveSettings({ cameraConnectionMode: 'wireless', activeDeviceId: deviceId, cameraHost: host })
    return wirelessStatus(status, deviceId, host)
  }

  async check(): Promise<CameraMediaSourceStatus> {
    const { deviceId, host } = await this.values()
    return wirelessStatus(await this.protocol(deviceId).checkStatus(host), deviceId, host)
  }

  async listFiles(): Promise<LunaFile[]> {
    const { deviceId, host, storageId } = await this.values()
    const files = attachSourceDevice(
      await this.protocol(deviceId).listFiles({ deviceId, host, storageId }),
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
    if (deviceId !== 'luna-ultra') throw new Error('当前设备暂不支持在应用中删除相机素材')
    return this.ctx.lunaProtocol().deleteFiles(cameraPathsForFiles(files, host), { deviceId, host })
  }

  async disconnect(): Promise<void> {
    const { deviceId, host } = await this.values()
    await this.protocol(deviceId).disconnect(host)
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
    if (volumes.length === 0) throw new Error('未检测到包含素材的相机磁盘')
    const files = await listMountedCameraFilesFromVolumes(volumes, deviceId)
    await resolveLocalThumbnails(files, getLocalResourcesDir(await getSettings()))
    return files
  }

  async deleteFiles(files: LunaFile[]): Promise<CameraDeleteResult> {
    const { rootPath } = await this.values()
    const volumes = await resolveMountedCameraVolumes(rootPath)
    if (volumes.length === 0) throw new Error('未检测到包含素材的相机磁盘')
    return deleteMountedCameraFilesFromVolumes(volumes, files)
  }

  async disconnect(): Promise<void> {
    // 文件系统卷由操作系统管理，此处只关闭应用内媒体源。
  }
}

export function cameraMediaSourceFor(ctx: IpcContext, options: CameraMediaSourceOptions): CameraMediaSourceAdapter {
  return options.mode === 'wired'
    ? new MountedCameraMediaSource(options)
    : new WirelessCameraMediaSource(ctx, options)
}
