import { useEffect, useRef } from 'react'

import { buildColorLutParams, colorLutKey } from '../../shared/colorLut'
import type { EditPipeline } from '../../shared/editPipeline'
import type { CreativeSlotTransform } from '../shared/creativeMedia'
import {
  clearCreativeLut,
  destroyCreativeGL,
  initCreativeGL,
  loadCreativeLut,
  renderCreativeFrame,
  type CreativeGLState,
} from '../shared/webglRenderer'

interface TripleStitchGLSlotProps {
  source: HTMLImageElement | HTMLVideoElement | null
  pipeline: EditPipeline
  transform: CreativeSlotTransform
}

export function TripleStitchGLSlot({ source, pipeline, transform }: TripleStitchGLSlotProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const glRef = useRef<CreativeGLState | null>(null)
  const rafRef = useRef(0)
  const pipelineRef = useRef(pipeline)
  const sourceRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null)
  const imageSizeRef = useRef({ w: 0, h: 0 })
  const canvasSizeRef = useRef({ w: 0, h: 0 })
  const isVideo = source instanceof HTMLVideoElement

  pipelineRef.current = pipeline
  sourceRef.current = source

  // Update image dimensions from source
  useEffect(() => {
    if (!source) {
      imageSizeRef.current = { w: 0, h: 0 }
      return
    }
    if (isVideo) {
      imageSizeRef.current = { w: source.videoWidth, h: source.videoHeight }
    } else {
      imageSizeRef.current = { w: source.naturalWidth, h: source.naturalHeight }
    }
    console.log('[TripleStitch] Source size:', imageSizeRef.current)
  }, [source])

  // ── Init GL once ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    console.log('[TripleStitch] Initializing GL...')
    const state = initCreativeGL(canvas)
    if (!state) {
      console.warn('[TripleStitch] GL init failed')
      return
    }
    glRef.current = state

    // Initial resize
    const parent = canvas.parentElement
    if (parent) {
      const { width, height } = parent.getBoundingClientRect()
      if (width > 0 && height > 0) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(height * dpr)
        canvasSizeRef.current = { w: canvas.width, h: canvas.height }
        console.log('[TripleStitch] Initial canvas size:', canvas.width, 'x', canvas.height)
      }
    }

    return () => {
      cancelAnimationFrame(rafRef.current)
      if (glRef.current) destroyCreativeGL(glRef.current)
      glRef.current = null
    }
  }, [])

  // ── ResizeObserver ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return

    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      if (width > 0 && height > 0) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(height * dpr)
        canvasSizeRef.current = { w: canvas.width, h: canvas.height }
        renderOnce()
      }
    })
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])

  // ── Upload source texture ──
  useEffect(() => {
    const gl = glRef.current
    if (!gl || !source) return
    const { w, h } = imageSizeRef.current
    if (!w || !h) {
      console.log('[TripleStitch] Skip render: no source size yet')
      return
    }
    console.log('[TripleStitch] Source ready, first render')
    renderOnce()
  }, [source, imageSizeRef.current.w, imageSizeRef.current.h])

  // ── LUT for video (async) ──
  useEffect(() => {
    if (!isVideo) {
      // Clear LUT for images (pipeline already baked)
      if (glRef.current?.useLut) clearCreativeLut(glRef.current)
      return
    }
    if (!glRef.current) return
    let canceled = false
    console.log('[TripleStitch] Baking LUT for video, key:', colorLutKey(pipeline.color))
    window.luna.workspace
      .bakeAndGetLut(buildColorLutParams(pipeline.color) as unknown as Record<string, unknown>)
      .then((result: { lutBuffer: ArrayBufferLike; lutSize: number }) => {
        if (canceled) return
        console.log('[TripleStitch] LUT baked, loading...')
        if (glRef.current) {
          loadCreativeLut(glRef.current, result.lutBuffer, result.lutSize)
          renderOnce()
        }
      })
      .catch(() => {
        if (!canceled) {
          console.log('[TripleStitch] LUT bake failed, fallback to no-LUT')
          if (glRef.current?.useLut) clearCreativeLut(glRef.current)
          renderOnce()
        }
      })
    return () => { canceled = true }
  }, [isVideo, pipeline.color])

  function renderOnce(): void {
    const state = glRef.current
    const src = sourceRef.current
    if (!state || !src) {
      console.log('[TripleStitch] renderOnce: no state or source')
      return
    }
    const { w: iw, h: ih } = imageSizeRef.current
    if (!iw || !ih) {
      console.log('[TripleStitch] renderOnce: no image size')
      return
    }
    const { w: cw, h: ch } = canvasSizeRef.current
    if (!cw || !ch) {
      console.log('[TripleStitch] renderOnce: no canvas size')
      return
    }
    const t = transform
    renderCreativeFrame(state, src, iw, ih, cw, ch, t.scale, t.offsetX, t.offsetY)
  }

  // ── RAF loop for video ──
  useEffect(() => {
    if (!isVideo) {
      // Image: render once (transform changes handled by the parent re-render)
      return
    }
    if (!glRef.current) return
    let running = true
    const loop = (): void => {
      if (!running) return
      renderOnce()
      rafRef.current = requestAnimationFrame(loop)
    }
    console.log('[TripleStitch] Starting video RAF loop')
    rafRef.current = requestAnimationFrame(loop)
    return () => {
      running = false
      cancelAnimationFrame(rafRef.current)
    }
  }, [isVideo, source])

  // Re-render when transform changes
  useEffect(() => {
    renderOnce()
  }, [transform.scale, transform.offsetX, transform.offsetY])

  return (
    <canvas
      ref={canvasRef}
      className="triple-stitch-slot-canvas"
      style={{ display: 'block', width: '100%', height: '100%' }}
    />
  )
}
