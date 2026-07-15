import type { PreviewLayer } from '../../../shared/types'

const TITLE_FONT_FILE = 'fonts/SourceHanSansSC-Bold.otf'

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
