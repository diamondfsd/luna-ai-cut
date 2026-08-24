import type { AppSettings, WatermarkPosition } from '../../shared/types'
import { createDefaultPipeline, type EditPipeline } from './editPipeline'
import { defaultWatermarkStyleForDevice, type DeviceMetadataLike } from '../../shared/insta360DeviceProfiles'

const WATERMARK_POSITIONS = new Set<WatermarkPosition>([
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
])

export function createWorkspaceDefaultPipeline(
  settings: AppSettings | null | undefined,
  resourceMetadata?: DeviceMetadataLike | null,
  connectedDeviceMetadata?: DeviceMetadataLike | null,
): EditPipeline {
  const pipeline = createDefaultPipeline()
  pipeline.watermark.style = defaultWatermarkStyleForDevice(resourceMetadata ?? {})
    ?? defaultWatermarkStyleForDevice(connectedDeviceMetadata ?? {})
    ?? ''
  pipeline.watermark.enabled = settings?.defaultWatermarkEnabled ?? true
  pipeline.watermark.position = settings?.defaultWatermarkPosition
    && WATERMARK_POSITIONS.has(settings.defaultWatermarkPosition)
    ? settings.defaultWatermarkPosition
    : 'bottom-center'
  return pipeline
}
