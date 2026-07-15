import type { PreviewLayer } from '../../../shared/types'

const TITLE_FONT_FILE = 'fonts/SourceHanSansSC-Bold.otf'
export const COLOR_REVEAL_TITLE_FADE_DURATION = 0.35

export function createColorRevealTitleLayer(
  content: string,
  opacity: number,
  visibleStart: number,
  visibleEnd?: number,
  fadeInDuration?: number,
  fadeOutDuration?: number,
): PreviewLayer {
  return {
    layerType: 'text',
    filePath: '',
    isVideo: false,
    dstX: 0.12,
    dstY: 0.45,
    dstW: 0.76,
    dstH: 0.1,
    srcX: 0,
    srcY: 0,
    srcW: 1,
    srcH: 1,
    opacity,
    zIndex: 100,
    content,
    fontSize: 42,
    fontFamily: 'Source Han Sans SC',
    fontFile: TITLE_FONT_FILE,
    fontWeight: 700,
    textColor: '#FFFFFF',
    textAlign: 'center',
    verticalAlign: 'middle',
    visibleStart,
    visibleEnd,
    fadeInDuration,
    fadeOutDuration,
  }
}

export function createPreviewColorRevealTitleLayer(
  time: number,
  initialHoldDuration: number,
  effectStart: number,
  initialTitle: string,
  revealedTitle: string,
): PreviewLayer | null {
  if (time < effectStart) {
    const opacity = time <= initialHoldDuration
      ? 1
      : Math.max(0, (effectStart - time) / COLOR_REVEAL_TITLE_FADE_DURATION)
    return initialTitle.trim() && opacity > 0
      ? createColorRevealTitleLayer(initialTitle.trim(), opacity, 0)
      : null
  }
  const opacity = Math.min(1, (time - effectStart) / COLOR_REVEAL_TITLE_FADE_DURATION)
  return revealedTitle.trim() && opacity > 0
    ? createColorRevealTitleLayer(revealedTitle.trim(), opacity, 0)
    : null
}
