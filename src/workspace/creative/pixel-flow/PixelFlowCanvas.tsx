import { useEffect, useRef, useState } from 'react'

import { assetSourceUrl } from '../shared/creativeMedia'
import type { WorkspaceMediaAsset } from '../../../shared/types'
import { createPixelFlowCells, pixelFlowProgress, type PixelFlowMask } from './pixelFlowRender'

interface PixelFlowCanvasProps {
  asset: WorkspaceMediaAsset
  subjectMask: PixelFlowMask | null
  skyMask: PixelFlowMask | null
  duration: number
  pixelSize: number
  lightWidth: number
  semanticDelay: number
  playing: boolean
  currentTime: number
  onTimeChange: (time: number) => void
  onEnded: () => void
  onReady: (size: { width: number; height: number }) => void
  onError: (message: string) => void
}

const MAX_PREVIEW_SIDE = 1080

export function PixelFlowCanvas({
  asset,
  subjectMask,
  skyMask,
  duration,
  pixelSize,
  lightWidth,
  semanticDelay,
  playing,
  currentTime,
  onTimeChange,
  onEnded,
  onReady,
  onError,
}: PixelFlowCanvasProps) {
  const sourceUrl = assetSourceUrl(asset)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef(0)
  const [sceneVersion, setSceneVersion] = useState(0)
  const timeRef = useRef(currentTime)
  const callbacksRef = useRef({ onTimeChange, onEnded })
  const renderFrameRef = useRef<(time: number) => void>(() => undefined)
  const sceneRef = useRef<{
    color: HTMLCanvasElement
    mono: HTMLCanvasElement
    pixels: Uint8ClampedArray
    width: number
    height: number
  } | null>(null)

  timeRef.current = currentTime
  callbacksRef.current = { onTimeChange, onEnded }

  useEffect(() => {
    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (cancelled) return
      const scale = Math.min(1, MAX_PREVIEW_SIDE / Math.max(image.naturalWidth, image.naturalHeight))
      const width = Math.max(1, Math.round(image.naturalWidth * scale))
      const height = Math.max(1, Math.round(image.naturalHeight * scale))
      const color = document.createElement('canvas')
      color.width = width
      color.height = height
      const colorContext = color.getContext('2d', { willReadFrequently: true })
      if (!colorContext) return onError('无法准备流光画面')
      colorContext.drawImage(image, 0, 0, width, height)
      const imageData = colorContext.getImageData(0, 0, width, height)
      const monoData = new ImageData(new Uint8ClampedArray(imageData.data), width, height)
      for (let index = 0; index < monoData.data.length; index += 4) {
        const gray = Math.round(monoData.data[index] * 0.2126 + monoData.data[index + 1] * 0.7152 + monoData.data[index + 2] * 0.0722)
        const lifted = Math.max(0, Math.min(255, (gray - 128) * 1.08 + 132))
        monoData.data[index] = lifted
        monoData.data[index + 1] = lifted
        monoData.data[index + 2] = lifted
      }
      const mono = document.createElement('canvas')
      mono.width = width
      mono.height = height
      mono.getContext('2d')?.putImageData(monoData, 0, 0)
      sceneRef.current = { color, mono, pixels: imageData.data, width, height }
      const canvas = canvasRef.current
      if (canvas) {
        canvas.width = width
        canvas.height = height
      }
      setSceneVersion((version) => version + 1)
      onReady({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => { if (!cancelled) onError('无法加载图片') }
    image.src = sourceUrl
    return () => { cancelled = true; sceneRef.current = null }
  }, [asset.id, onError, onReady, sourceUrl])

  useEffect(() => {
    const scene = sceneRef.current
    const canvas = canvasRef.current
    if (!scene || !canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    const cellSize = Math.max(4, Math.round(Math.max(scene.width, scene.height) * pixelSize / 1000))
    const cells = createPixelFlowCells(scene.pixels, scene.width, scene.height, cellSize, semanticDelay / 100, subjectMask, skyMask)
    const band = Math.max(0.012, lightWidth / 100)

    function render(time: number): void {
      const progress = pixelFlowProgress(time, duration) * (1.02 + band)
      context!.globalAlpha = 1
      context!.globalCompositeOperation = 'source-over'
      context!.filter = 'none'
      context!.drawImage(scene!.mono, 0, 0)

      context!.save()
      context!.beginPath()
      for (const cell of cells) {
        if (cell.arrival <= progress) context!.rect(cell.x, cell.y, cell.width + 0.5, cell.height + 0.5)
      }
      context!.clip()
      context!.drawImage(scene!.color, 0, 0)
      context!.restore()

      context!.save()
      context!.globalCompositeOperation = 'screen'
      context!.shadowBlur = cellSize * 1.4
      for (const cell of cells) {
        const distance = cell.arrival - progress
        if (distance < -band * 0.3 || distance > band) continue
        const strength = 1 - Math.abs(distance - band * 0.2) / (band * 0.8)
        context!.globalAlpha = Math.max(0.16, Math.min(0.92, strength))
        context!.shadowColor = cell.glowColor
        context!.fillStyle = cell.color
        context!.fillRect(cell.x + 0.5, cell.y + 0.5, Math.max(1, cell.width - 1), Math.max(1, cell.height - 1))
        context!.globalAlpha *= 0.62
        context!.fillStyle = cell.highlightColor
        context!.fillRect(cell.x + 1, cell.y + 1, Math.max(1, cell.width - 2), Math.max(1, cell.height - 2))
      }
      context!.restore()
    }

    renderFrameRef.current = render
    render(timeRef.current)
    return () => {
      if (renderFrameRef.current === render) renderFrameRef.current = () => undefined
    }
  }, [duration, lightWidth, pixelSize, sceneVersion, semanticDelay, skyMask, subjectMask])

  useEffect(() => {
    if (!playing) renderFrameRef.current(currentTime)
  }, [currentTime, playing])

  useEffect(() => {
    if (!playing) return
    let previous = performance.now()
    const tick = (now: number) => {
      const next = Math.min(duration, timeRef.current + Math.max(0, now - previous) / 1000)
      previous = now
      timeRef.current = next
      callbacksRef.current.onTimeChange(next)
      renderFrameRef.current(next)
      if (next >= duration) {
        callbacksRef.current.onEnded()
        return
      }
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [duration, playing])

  return <canvas ref={canvasRef} className="pixel-flow-canvas" />
}
