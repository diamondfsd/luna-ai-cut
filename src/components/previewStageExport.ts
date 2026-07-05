import type { PreviewLayer, RenderLayer, StaticLayer } from '../shared/types'

interface LunaRenderCoreApi {
  exportImageFromSources(
    outputPath: string,
    width: number,
    height: number,
    layers: PreviewLayer[],
    format: string,
    quality: number,
  ): Promise<void>
  exportVideo(
    inputPath: string,
    outputPath: string,
    canvasWidth: number,
    canvasHeight: number,
    fps: number | null,
    hardware: boolean,
    videoLayer: RenderLayer,
    overlayLayers: StaticLayer[],
    taskId?: string,
    qualityPreset?: string,
  ): Promise<void>
}

function lrc(): LunaRenderCoreApi {
  const api = (window as unknown as { lunaRenderCore?: LunaRenderCoreApi }).lunaRenderCore
  if (!api) throw new Error('渲染引擎未初始化')
  return api
}

function outputPath(exportDir: string, fileName: string): string {
  return exportDir.endsWith('/') ? `${exportDir}${fileName}` : `${exportDir}/${fileName}`
}

function staticLayers(layers: PreviewLayer[]): StaticLayer[] {
  return layers
    .filter((layer) => !layer.isVideo)
    .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    .map((layer) => ({
      imagePath: layer.filePath,
      dstX: layer.dstX,
      dstY: layer.dstY,
      dstW: layer.dstW,
      dstH: layer.dstH,
      srcX: layer.srcX ?? 0,
      srcY: layer.srcY ?? 0,
      srcW: layer.srcW ?? 1,
      srcH: layer.srcH ?? 1,
      opacity: layer.opacity ?? 1,
      zIndex: layer.zIndex ?? 0,
    }))
}

export async function exportPreviewImage(params: {
  exportDir: string
  fileName: string
  width: number
  height: number
  layers: PreviewLayer[]
  format: 'jpeg' | 'png' | 'webp'
  quality: number
}): Promise<{ path: string; name: string }> {
  const path = outputPath(params.exportDir, params.fileName)
  await lrc().exportImageFromSources(path, params.width, params.height, params.layers, params.format, params.quality)
  return { path, name: params.fileName }
}

export async function exportPreviewVideo(params: {
  exportDir: string
  fileName: string
  width: number
  height: number
  layers: PreviewLayer[]
  qualityPreset?: string
}): Promise<{ path: string; name: string }> {
  const videoSourceLayer = params.layers.find((layer) => layer.isVideo)
  if (!videoSourceLayer) throw new Error('未找到视频图层')

  const path = outputPath(params.exportDir, params.fileName)
  const videoLayer: RenderLayer = {
    textureId: 0,
    dstX: videoSourceLayer.dstX,
    dstY: videoSourceLayer.dstY,
    dstW: videoSourceLayer.dstW,
    dstH: videoSourceLayer.dstH,
    srcX: videoSourceLayer.srcX ?? 0,
    srcY: videoSourceLayer.srcY ?? 0,
    srcW: videoSourceLayer.srcW ?? 1,
    srcH: videoSourceLayer.srcH ?? 1,
    opacity: videoSourceLayer.opacity ?? 1,
    zIndex: videoSourceLayer.zIndex ?? 0,
  }

  await lrc().exportVideo(
    videoSourceLayer.filePath,
    path,
    params.width,
    params.height,
    null,
    true,
    videoLayer,
    staticLayers(params.layers),
    undefined,
    params.qualityPreset ?? 'high',
  )
  return { path, name: params.fileName }
}

export async function exportPreviewLivePhoto(params: {
  name: string
  exportDir: string
  width: number
  height: number
  imageLayers: PreviewLayer[]
  videoLayers: PreviewLayer[]
  appleLivePhoto: boolean
}): Promise<{ path: string; name: string }> {
  const stamp = Date.now()
  const outputDir = params.exportDir.replace(/[\\/]$/, '')
  const imagePath = `${outputDir}/${params.name}_live_image_${stamp}.jpg`
  const videoPath = `${outputDir}/${params.name}_live_video_${stamp}.mp4`

  await lrc().exportImageFromSources(imagePath, params.width, params.height, params.imageLayers, 'jpeg', 100)
  await exportPreviewVideo({
    exportDir: outputDir,
    fileName: `${params.name}_live_video_${stamp}.mp4`,
    width: params.width,
    height: params.height,
    layers: params.videoLayers,
    qualityPreset: 'high',
  })

  return window.luna.workspace.exportRenderedLivePhoto(params.name, imagePath, videoPath, params.appleLivePhoto)
}
