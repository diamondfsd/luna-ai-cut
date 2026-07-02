export interface Insta360DeviceProfile {
  id: string
  displayName: string
  cameraType: string
  deviceNamePatterns: RegExp[]
  exifModelPatterns: RegExp[]
  defaultWatermarkStyle: string
}

export const INSTA360_DEVICE_PROFILES: Insta360DeviceProfile[] = [
  {
    id: 'luna-ultra',
    displayName: 'Luna Ultra',
    cameraType: 'Insta360 Luna Ultra',
    deviceNamePatterns: [/Insta360\s+Luna\s+Ultra/i, /Luna\s+Ultra/i, /Z03/i],
    exifModelPatterns: [/Insta360\s+Luna\s+Ultra/i, /Luna\s+Ultra/i, /Z03/i],
    defaultWatermarkStyle: 'luna_ultra',
  },
  {
    id: 'go-ultra',
    displayName: 'GO Ultra',
    cameraType: 'Insta360 GO Ultra',
    deviceNamePatterns: [/Insta360\s+GO\s+Ultra/i, /GO\s+Ultra/i, /TC4/i, /IBE/i],
    exifModelPatterns: [/Insta360\s+GO\s+Ultra/i, /GO\s+Ultra/i, /TC4/i, /IBE/i],
    defaultWatermarkStyle: 'go_ultra',
  },
]

export function deviceProfileForId(deviceId?: string | null): Insta360DeviceProfile | null {
  if (!deviceId) return null
  return INSTA360_DEVICE_PROFILES.find((profile) => profile.id === deviceId) ?? null
}

export function deviceProfileForText(text?: string | null): Insta360DeviceProfile | null {
  if (!text) return null
  return INSTA360_DEVICE_PROFILES.find((profile) => (
    profile.deviceNamePatterns.some((pattern) => pattern.test(text)) ||
    profile.exifModelPatterns.some((pattern) => pattern.test(text))
  )) ?? null
}

export function inferDeviceProfile(params: {
  sourceDeviceId?: string | null
  sourceDeviceName?: string | null
  cameraType?: string | null
  cameraSerial?: string | null
  watermarkProfileId?: string | null
  exifModel?: string | null
}): Insta360DeviceProfile | null {
  return deviceProfileForId(params.watermarkProfileId)
    ?? deviceProfileForId(params.sourceDeviceId)
    ?? deviceProfileForText(params.cameraType)
    ?? deviceProfileForText(params.sourceDeviceName)
    ?? deviceProfileForText(params.cameraSerial)
    ?? deviceProfileForText(params.exifModel)
}

export function defaultWatermarkStyleForDevice(params: Parameters<typeof inferDeviceProfile>[0]): string {
  return inferDeviceProfile(params)?.defaultWatermarkStyle ?? 'luna_ultra'
}

export function concreteWatermarkStyle(style: string, _params: Parameters<typeof inferDeviceProfile>[0]): string {
  return style
}
