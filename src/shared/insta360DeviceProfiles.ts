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

/**
 * 统一设备检测函数。
 * 优先级：sourceDeviceId > cameraType > sourceDeviceName > cameraSerial > EXIF Model
 * EXIF 读取需传入 readExif 回调（前端的 IPC 调用）。
 */
export async function resolveDeviceId(
  file: {
    sourceDeviceId?: string | null
    watermarkProfileId?: string | null
    cameraType?: string | null
    sourceDeviceName?: string | null
    cameraSerial?: string | null
  },
  options?: {
    /** 备用文件路径，用于 EXIF 读取 */
    filePath?: string
    /** EXIF 读取函数（由前端传入 window.luna.readExifModel） */
    readExif?: (path: string) => Promise<string | null>
  },
): Promise<string | null> {
  // 1. 从文件字段推断
  const profile = inferDeviceProfile({
    sourceDeviceId: file.sourceDeviceId,
    sourceDeviceName: file.sourceDeviceName,
    cameraType: file.cameraType,
    cameraSerial: file.cameraSerial,
    watermarkProfileId: file.watermarkProfileId,
  })
  if (profile) return profile.id

  // 2. EXIF 兜底
  if (options?.filePath && options?.readExif) {
    try {
      const exifModel = await options.readExif(options.filePath)
      if (exifModel) {
        const exifProfile = deviceProfileForText(exifModel)
        if (exifProfile) return exifProfile.id
      }
    } catch { /* EXIF 读取失败，忽略 */ }
  }

  return null
}
