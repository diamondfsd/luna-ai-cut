import type { IpcContext } from '../../ipc/context'
import type {
  CameraVideoStreamAdapter,
  CameraVideoStreamOptions,
} from '../../../src/shared/types'
import { deviceDefinitionFor } from '../definitions/deviceDefaults'
import { LunaVideoStreamAdapter } from '../insta360/lunaVideoStreamAdapter'
import { UnsupportedCameraVideoStreamAdapter } from './unsupportedCameraVideoStreamAdapter'

const adapters = new Map<string, CameraVideoStreamAdapter>()

function adapterKey(options: CameraVideoStreamOptions): string {
  return `${options.mode}:${options.deviceId ?? 'active'}:${options.host ?? 'default'}`
}

export function cameraVideoStreamFor(ctx: IpcContext, options: CameraVideoStreamOptions): CameraVideoStreamAdapter {
  const key = adapterKey(options)
  const existing = adapters.get(key)
  if (existing) return existing

  const definition = deviceDefinitionFor(options.deviceId)
  const adapter = options.mode === 'wireless' && definition.id === 'luna-ultra'
    ? new LunaVideoStreamAdapter(ctx, options)
    : new UnsupportedCameraVideoStreamAdapter(
        options,
        options.mode === 'wired' ? '有线相机暂不支持实时视频预览' : undefined,
      )
  adapters.set(key, adapter)
  return adapter
}

export async function stopAllCameraVideoStreams(): Promise<void> {
  await Promise.all([...adapters.values()].map((adapter) => adapter.stop().catch(() => undefined)))
  adapters.clear()
}

export async function stopCameraVideoStream(options: CameraVideoStreamOptions): Promise<void> {
  const key = adapterKey(options)
  const adapter = adapters.get(key)
  if (!adapter) return
  await adapter.stop().catch(() => undefined)
  adapters.delete(key)
}
