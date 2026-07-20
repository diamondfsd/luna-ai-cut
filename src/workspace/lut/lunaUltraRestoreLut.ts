import type { LutFileInfo } from './builtinLuts'

export const LUNA_ULTRA_RESTORE_LUT_FILE = 'Luna_I-Log_to_Rec709_BT1886_s65_v2.cube'
export const LUNA_ULTRA_RESTORE_INTENSITY = 100
export const CREATIVE_LUT_DEFAULT_INTENSITY = 30

function fileName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1]?.toLocaleLowerCase('en-US') ?? ''
}

export function isLunaUltraRestoreLut(path: string | null): boolean {
  return Boolean(path && fileName(path) === LUNA_ULTRA_RESTORE_LUT_FILE.toLocaleLowerCase('en-US'))
}

export function findLunaUltraRestoreLut(luts: LutFileInfo[]): LutFileInfo | null {
  return luts.find((lut) => isLunaUltraRestoreLut(lut.filePath)) ?? null
}
