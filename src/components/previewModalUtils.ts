export interface MediaDetails {
  width: number | null
  height: number | null
  duration: number | null
  currentTime: number
  frameRate: number | null
  histogram: Array<{ r: number; g: number; b: number; l: number }>
}

export function emptyDetails(): MediaDetails {
  return {
    width: null,
    height: null,
    duration: null,
    currentTime: 0,
    frameRate: null,
    histogram: [],
  }
}

export function buildHistogram(image: HTMLImageElement): MediaDetails['histogram'] {
  const canvas = document.createElement('canvas')
  const size = 96
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) return []

  context.drawImage(image, 0, 0, size, size)
  const { data } = context.getImageData(0, 0, size, size)
  const bins = Array.from({ length: 32 }, () => ({ r: 0, g: 0, b: 0, l: 0 }))
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index]
    const green = data[index + 1]
    const blue = data[index + 2]
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722
    bins[Math.min(31, Math.floor(red / 8))].r += 1
    bins[Math.min(31, Math.floor(green / 8))].g += 1
    bins[Math.min(31, Math.floor(blue / 8))].b += 1
    bins[Math.min(31, Math.floor(luminance / 8))].l += 1
  }

  const max = Math.max(1, ...bins.flatMap((bin) => [bin.r, bin.g, bin.b, bin.l]))
  return bins.map((bin) => ({
    r: bin.r / max,
    g: bin.g / max,
    b: bin.b / max,
    l: bin.l / max,
  }))
}

export function filePathToPreviewUrl(filePath: string | null | undefined): string | null {
  if (!filePath) return null
  if (filePath.startsWith('file://')) return filePath
  // Windows 路径需将反斜杠转为正斜杠，保证 file:/// 有效
  const normalized = filePath.replace(/\\/g, '/')
  return encodeURI(`file://${normalized.startsWith('/') ? '' : '/'}${normalized}`)
    .replace(/#/g, '%23').replace(/\?/g, '%3F')
}
