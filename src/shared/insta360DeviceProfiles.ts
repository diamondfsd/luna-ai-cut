export interface Insta360DeviceProfile {
  id: string
  displayName: string
  cameraType: string
  deviceNamePatterns: RegExp[]
  exifModelPatterns: RegExp[]
  defaultWatermarkStyle: string
  supportsBorderLogo?: boolean
}

export type DeviceMetadataLike = {
  sourceDeviceId?: string | null
  sourceDeviceName?: string | null
  cameraType?: string | null
  cameraSerial?: string | null
  watermarkProfileId?: string | null
}

export const INSTA360_DEVICE_PROFILES: Insta360DeviceProfile[] = [
  {
    id: 'luna-ultra',
    displayName: 'Luna Ultra',
    cameraType: 'Insta360 Luna Ultra',
    deviceNamePatterns: [/Insta360\s+Luna\s+Ultra/i, /Luna\s+Ultra/i, /Z03/i],
    exifModelPatterns: [/Insta360\s+Luna\s+Ultra/i, /Luna\s+Ultra/i, /Z03/i],
    defaultWatermarkStyle: 'luna_ultra_cn',
    supportsBorderLogo: true,
  },
  {
    id: 'go-ultra',
    displayName: 'GO Ultra',
    cameraType: 'Insta360 GO Ultra',
    deviceNamePatterns: [/Insta360\s+GO\s+Ultra/i, /GO\s+Ultra/i, /TC4/i, /IBE/i],
    exifModelPatterns: [/Insta360\s+GO\s+Ultra/i, /GO\s+Ultra/i, /TC4/i, /IBE/i],
    defaultWatermarkStyle: 'go_ultra_cn',
  },
  {
    id: 'dji-pocket-4-pro',
    displayName: 'Osmo Pocket 4 Pro',
    cameraType: 'DJI OsmoPocket4P',
    deviceNamePatterns: [/DJI\s*Osmo\s*Pocket\s*4\s*P/i, /OsmoPocket4P/i, /PP-041/i],
    exifModelPatterns: [/DJI\s*Osmo\s*Pocket\s*4\s*P/i, /OsmoPocket4P/i, /PP-041/i],
    defaultWatermarkStyle: 'dji_pocket_4_pro',
  },
  {
    id: 'dji-pocket-4',
    displayName: 'Osmo Pocket 4',
    cameraType: 'DJI OsmoPocket4',
    deviceNamePatterns: [/DJI\s*Osmo\s*Pocket\s*4(?!\s*P)/i, /OsmoPocket4(?!P)/i],
    exifModelPatterns: [/DJI\s*Osmo\s*Pocket\s*4(?!\s*P)/i, /OsmoPocket4(?!P)/i],
    defaultWatermarkStyle: 'dji_pocket_4',
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

export function inferDeviceProfile(params: DeviceMetadataLike & { exifModel?: string | null }): Insta360DeviceProfile | null {
  return deviceProfileForId(params.watermarkProfileId)
    ?? deviceProfileForId(params.sourceDeviceId)
    ?? deviceProfileForText(params.cameraType)
    ?? deviceProfileForText(params.sourceDeviceName)
    ?? deviceProfileForText(params.cameraSerial)
    ?? deviceProfileForText(params.exifModel)
}

export function defaultWatermarkStyleForDevice(params: Parameters<typeof inferDeviceProfile>[0]): string | null {
  return inferDeviceProfile(params)?.defaultWatermarkStyle ?? null
}

export function deviceDisplayNameForMetadata(params: DeviceMetadataLike): string | null {
  const profile = inferDeviceProfile(params)
  if (profile) return profile.displayName
  return [params.sourceDeviceName, params.cameraType]
    .map((value) => value?.trim())
    .find((value): value is string => Boolean(value)) ?? null
}

/**
 * 边框标题使用设备的标准型号，而不是厂商 Make（例如“Insta360”）。
 * 这样同一套边框可以随当前连接设备或素材来源切换标题。
 */
export function borderTitleForDevice(params: DeviceMetadataLike & { exifModel?: string | null }): string | null {
  const profile = inferDeviceProfile(params)
  if (profile) return profile.cameraType
  const genericLabels = new Set(['insta360', 'dji', 'camera', '相机'])
  return [params.cameraType, params.sourceDeviceName, params.exifModel]
    .map((value) => value?.trim())
    .find((value): value is string => typeof value === 'string' && value.length > 0 && !genericLabels.has(value.toLocaleLowerCase())) ?? null
}

const LEGACY_BORDER_TITLES = new Set([
  'insta360',
  'insta360 luna ultra',
  'luna ultra',
])

export function isLegacyBorderTitle(title?: string | null): boolean {
  return LEGACY_BORDER_TITLES.has(title?.trim().toLocaleLowerCase() ?? '')
}

export function mediaSourceLabelFor(params: {
  connected?: boolean
  connectedDeviceName?: string | null
  files?: readonly DeviceMetadataLike[]
}): string {
  if (params.connected) {
    const connectedName = params.connectedDeviceName?.trim()
    if (connectedName) return connectedName
  }
  for (const file of params.files ?? []) {
    const label = deviceDisplayNameForMetadata(file)
    if (label) return label
  }
  return '相机媒体'
}

export function concreteWatermarkStyle(style: string): string {
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
