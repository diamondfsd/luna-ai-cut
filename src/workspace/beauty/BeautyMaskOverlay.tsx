import { useEffect, useMemo, useRef } from 'react'

import { useWorkspaceCanvas } from '../context/WorkspaceCanvasContext'
import { useWorkspaceEdit } from '../context/WorkspaceEditContext'
import { useWorkspaceMedia } from '../context/WorkspaceMediaContext'
import { buildMaskOverlayPreview } from '../mask/maskOverlayPreview'
import { maskTimelineSampleAt } from '../mask/maskTimeline'
import { BEAUTY_MASK_VISUALIZATION } from './beautyMaskVisualization'
import './BeautyMaskOverlay.css'

const PREVIEW_MAX_SIDE = 512
const OVERLAY_OPACITY = 0.62

interface BeautyMaskOverlayProps {
  currentTime?: number
}

export function BeautyMaskOverlay({ currentTime = 0 }: BeautyMaskOverlayProps) {
  const canvas = useWorkspaceCanvas()
  const edit = useWorkspaceEdit()
  const media = useWorkspaceMedia()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRect = canvas.imageRect
  const displaySize = useMemo(() => canvas.sourceAspect >= 1
    ? { width: PREVIEW_MAX_SIDE, height: Math.max(1, Math.round(PREVIEW_MAX_SIDE / canvas.sourceAspect)) }
    : { width: Math.max(1, Math.round(PREVIEW_MAX_SIDE * canvas.sourceAspect)), height: PREVIEW_MAX_SIDE }, [canvas.sourceAspect])

  useEffect(() => {
    let cancelled = false
    const element = canvasRef.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    context.clearRect(0, 0, displaySize.width, displaySize.height)

    const transform = edit.pipeline.transform
    const crop = transform.crop ?? { x: 0, y: 0, w: 1, h: 1 }
    const normalizedOrientation = ((transform.orientation % 180) + 180) % 180
    const swapsAxes = normalizedOrientation >= 45 && normalizedOrientation <= 135
    const frameWidth = swapsAxes ? 1 : canvas.sourceAspect
    const frameHeight = swapsAxes ? canvas.sourceAspect : 1
    const displayToSource = (x: number, y: number) => {
      let centeredX = (crop.x + x * crop.w - 0.5) * frameWidth / Math.max(transform.scale, 0.0001)
      let centeredY = (crop.y + y * crop.h - 0.5) * frameHeight / Math.max(transform.scale, 0.0001)
      const radians = (transform.orientation + transform.rotate) * Math.PI / 180
      const sourceXBeforeFlip = centeredX * Math.cos(radians) + centeredY * Math.sin(radians)
      const sourceYBeforeFlip = -centeredX * Math.sin(radians) + centeredY * Math.cos(radians)
      centeredX = transform.flipH ? -sourceXBeforeFlip : sourceXBeforeFlip
      centeredY = transform.flipV ? -sourceYBeforeFlip : sourceYBeforeFlip
      return {
        x: centeredX / Math.max(canvas.sourceAspect, 0.0001) + 0.5,
        y: centeredY + 0.5,
      }
    }

    const visibleMasks = BEAUTY_MASK_VISUALIZATION.flatMap((item) => {
      const layer = edit.pipeline.beautyMasks.find((candidate) => candidate.id === item.id)
      const timelineSample = maskTimelineSampleAt(layer?.timeline, currentTime)
      const path = layer?.timeline ? timelineSample?.path : layer?.path
      return layer && path && !layer.loadError ? [{ item, layer, path, timelineSample }] : []
    })
    void Promise.all(visibleMasks.map(async ({ item, layer, path, timelineSample }) => ({
      item,
      layer,
      timelineSample,
      data: new Uint8Array((await window.luna.workspace.loadColorMask(media.currentProject?.id ?? '', path)).bytes),
    }))).then((loaded) => {
      if (cancelled) return
      const image = context.createImageData(displaySize.width, displaySize.height)
      for (const { item, layer, timelineSample, data } of loaded) {
        const maskTransform = timelineSample?.transform
        const displayToMask = maskTransform
          ? (x: number, y: number) => {
              const source = displayToSource(x, y)
              const translatedX = (source.x - 0.5 - maskTransform.translateX) * layer.width
              const translatedY = (source.y - 0.5 - maskTransform.translateY) * layer.height
              const cosine = Math.cos(maskTransform.rotation)
              const sine = Math.sin(maskTransform.rotation)
              return {
                x: (cosine * translatedX + sine * translatedY) / maskTransform.scale / layer.width + 0.5,
                y: (-sine * translatedX + cosine * translatedY) / maskTransform.scale / layer.height + 0.5,
              }
            }
          : displayToSource
        const preview = buildMaskOverlayPreview(
          data,
          { width: layer.width, height: layer.height },
          displaySize,
          displayToMask,
          layer.inverted,
          layer.feather,
        )
        for (let index = 0; index < preview.length; index += 1) {
          const sourceAlpha = preview[index] / 255 * OVERLAY_OPACITY
          if (sourceAlpha <= 0) continue
          const pixel = index * 4
          const destinationAlpha = image.data[pixel + 3] / 255
          const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha)
          for (let channel = 0; channel < 3; channel += 1) {
            image.data[pixel + channel] = Math.round(
              (item.rgb[channel] * sourceAlpha + image.data[pixel + channel] * destinationAlpha * (1 - sourceAlpha))
                / Math.max(outputAlpha, 0.0001),
            )
          }
          image.data[pixel + 3] = Math.round(outputAlpha * 255)
        }
      }
      context.putImageData(image, 0, 0)
      element.dataset.maskCount = String(loaded.length)
    }).catch(() => {
      if (!cancelled) element.dataset.loadError = 'true'
    })
    return () => { cancelled = true }
  }, [canvas.sourceAspect, currentTime, displaySize, edit.pipeline.beautyMasks, edit.pipeline.transform, media.currentProject?.id])

  return (
    <div
      className="beauty-mask-overlay-shell"
      style={{ left: imageRect.x, top: imageRect.y, width: imageRect.width, height: imageRect.height }}
      aria-hidden="true"
    >
      <canvas
        ref={canvasRef}
        className="beauty-mask-overlay"
        width={displaySize.width}
        height={displaySize.height}
        data-testid="beauty-mask-overlay"
      />
    </div>
  )
}
