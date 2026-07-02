import exifr from 'exifr'

import { concreteWatermarkStyle } from '../src/shared/insta360DeviceProfiles'
import type { ExportFileInput, WatermarkSettings, WatermarkStyle } from '../src/shared/types'

async function readExifModel(localPath?: string): Promise<string | null> {
  if (!localPath) return null
  try {
    const parsed = await exifr.parse(localPath, { translateValues: false, pick: ['Model', 'Make'] }) as Record<string, unknown> | undefined
    const model = typeof parsed?.Model === 'string' ? parsed.Model : ''
    const make = typeof parsed?.Make === 'string' ? parsed.Make : ''
    return [make, model].filter(Boolean).join(' ') || null
  } catch {
    return null
  }
}

export async function resolveWatermarkStyleForFile(file: ExportFileInput, settings: WatermarkSettings): Promise<Exclude<WatermarkStyle, 'auto'>> {
  if (settings.style !== 'auto') return settings.style
  const exifModel = await readExifModel(file.localPath)
  return concreteWatermarkStyle(settings.style, {
    sourceDeviceId: file.sourceDeviceId,
    sourceDeviceName: file.sourceDeviceName,
    cameraType: file.cameraType,
    cameraSerial: file.cameraSerial,
    watermarkProfileId: file.watermarkProfileId,
    exifModel,
  })
}

export async function resolveWatermarkSettingsForFile(
  file: ExportFileInput,
  settings: WatermarkSettings,
): Promise<WatermarkSettings & { style: Exclude<WatermarkStyle, 'auto'> }> {
  return {
    ...settings,
    style: await resolveWatermarkStyleForFile(file, settings),
  }
}
