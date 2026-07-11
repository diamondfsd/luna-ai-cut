export const BORDER_LOGOS = {
  logo_standard_black: { fileName: 'luna_ultra_logo_blank.png', aspectRatio: 1800 / 333 },
  logo_standard_white: { fileName: 'luna_ultra_logo_white.png', aspectRatio: 1800 / 333 },
  logo_cn_black: { fileName: 'luna_ultra_logo_cn_blank.png', aspectRatio: 2103 / 333 },
  logo_cn_white: { fileName: 'luna_ultra_logo_cn_white.png', aspectRatio: 2103 / 333 },
} as const

export type BorderLogoId = keyof typeof BORDER_LOGOS

const pathCache = new Map<BorderLogoId, string>()

export async function preloadBorderLogoPaths(): Promise<void> {
  await Promise.all(Object.keys(BORDER_LOGOS).map(async (id) => {
    const filePath = await window.luna.getBorderLogoPath(id)
    pathCache.set(id as BorderLogoId, filePath)
  }))
}

export function getBorderLogo(id: string): { filePath: string; aspectRatio: number } | null {
  if (!(id in BORDER_LOGOS)) return null
  const logoId = id as BorderLogoId
  const filePath = pathCache.get(logoId)
  return filePath ? { filePath, aspectRatio: BORDER_LOGOS[logoId].aspectRatio } : null
}
