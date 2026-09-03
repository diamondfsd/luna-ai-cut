import type { DeviceLutRestoreConfig } from '../../shared/types/device'
import type { LutFileInfo } from './builtinLuts'

function fileName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1]?.toLocaleLowerCase('en-US') ?? ''
}

function normalizedFileName(value: string): string {
  return fileName(value)
}

/** 判断一个 LUT 是否是当前设备的专用还原 LUT。 */
export function isDeviceRestoreLut(path: string | null | undefined, config?: DeviceLutRestoreConfig | null): boolean {
  return Boolean(path && config && normalizedFileName(path) === normalizedFileName(config.fileName))
}

export function findDeviceRestoreLut(
  luts: LutFileInfo[],
  config?: DeviceLutRestoreConfig | null,
): LutFileInfo | null {
  return config
    ? luts.find((lut) => isDeviceRestoreLut(lut.filePath, config)) ?? null
    : null
}

/** 技术还原 LUT 不应出现在创意滤镜列表中。 */
export function isTechnicalLut(lut: LutFileInfo): boolean {
  return lut.isTechnical === true || fileName(lut.filePath).startsWith('luna_i-log_to_')
}
