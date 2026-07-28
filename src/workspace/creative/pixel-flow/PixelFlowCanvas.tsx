import { useEffect, useRef, useState } from 'react'

import { assetSourceUrl } from '../shared/creativeMedia'
import type { WorkspaceMediaAsset } from '../../../shared/types'
import { createPixelFlowCells, pixelFlowProgress, type PixelFlowCell, type PixelFlowMask } from './pixelFlowRender'

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

function pixelLightStrength(distance: number, band: number): number {
  const fadeInDistance = band * 0.9
  const fadeOutDistance = band * 2.6
  const linear = distance >= 0
    ? 1 - distance / fadeInDistance
    : 1 + distance / fadeOutDistance
  const clamped = Math.max(0, Math.min(1, linear))
  return clamped * clamped * (3 - 2 * clamped)
}

function firstCellAtOrAfter(cells: PixelFlowCell[], arrival: number): number {
  let start = 0
  let end = cells.length
  while (start < end) {
    const middle = Math.floor((start + end) / 2)
    if (cells[middle].arrival < arrival) start = middle + 1
    else end = middle
  }
  return start
}

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
      .sort((left, right) => left.arrival - right.arrival)
    const band = Math.max(0.012, lightWidth / 100)
    const reveal = document.createElement('canvas')
    reveal.width = scene.width
    reveal.height = scene.height
    const revealContext = reveal.getContext('2d')
    if (!revealContext) return
    let revealedCount = 0
    let previousProgress = Number.NEGATIVE_INFINITY

    function render(time: number): void {
      const progress = pixelFlowProgress(time, duration) * (1.04 + band * 2.8)
      if (progress < previousProgress) {
        revealContext!.clearRect(0, 0, scene!.width, scene!.height)
        revealedCount = 0
      }
      while (revealedCount < cells.length && cells[revealedCount].arrival <= progress) {
        const cell = cells[revealedCount]
        revealContext!.drawImage(
          scene!.color,
          cell.x,
          cell.y,
          cell.width,
          cell.height,
          cell.x,
          cell.y,
          cell.width + 0.5,
          cell.height + 0.5,
        )
        revealedCount += 1
      }
      previousProgress = progress
      context!.globalAlpha = 1
      context!.globalCompositeOperation = 'source-over'
      context!.filter = 'none'
      context!.drawImage(scene!.mono, 0, 0)
      context!.drawImage(reveal, 0, 0)

      context!.save()
      context!.globalCompositeOperation = 'lighter'
      context!.shadowBlur = cellSize * 2.2
      const firstVisible = firstCellAtOrAfter(cells, progress - band * 2.6)
      const lastVisible = firstCellAtOrAfter(cells, progress + band * 0.9)
      for (let index = firstVisible; index < lastVisible; index += 1) {
        const cell = cells[index]
        const distance = cell.arrival - progress
        const strength = pixelLightStrength(distance, band)
        if (strength <= 0) continue
        context!.globalAlpha = Math.min(1, strength)
        context!.shadowColor = cell.glowColor
        context!.fillStyle = cell.color
        context!.fillRect(cell.x + 0.5, cell.y + 0.5, Math.max(1, cell.width - 1), Math.max(1, cell.height - 1))
        context!.globalAlpha *= 0.72
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
