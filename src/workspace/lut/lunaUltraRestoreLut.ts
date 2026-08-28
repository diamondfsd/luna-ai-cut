import type { LutFileInfo } from './builtinLuts'
import { findDeviceRestoreLut, isDeviceRestoreLut, isTechnicalLut } from './restoreLuts'

export const LUNA_ULTRA_RESTORE_LUT_FILE = 'Luna_I-Log_to_Rec709_BT1886_s65_v2.cube'

const LUNA_ULTRA_RESTORE_CONFIG = {
  fileName: LUNA_ULTRA_RESTORE_LUT_FILE,
  label: 'I-Log 转 Rec.709',
}

/** 兼容预览弹窗等仍只处理 Luna I-Log 的旧调用。 */
export function isLunaUltraRestoreLut(path: string | null): boolean {
  return isDeviceRestoreLut(path, LUNA_ULTRA_RESTORE_CONFIG)
}

export function isLunaUltraTechnicalLut(path: string): boolean {
  return isTechnicalLut({ id: '', name: '', category: '', filePath: path })
}

export function findLunaUltraRestoreLut(luts: LutFileInfo[]): LutFileInfo | null {
  return findDeviceRestoreLut(luts, LUNA_ULTRA_RESTORE_CONFIG)
}
