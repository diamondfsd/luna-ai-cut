import { useCallback, useEffect, useRef, useState } from 'react'

import type { EditPipeline } from '../shared/editPipeline'
import type { ImageCacheEntry } from '../shared/imageCache'
import { workspaceImageCache } from '../shared/imageCache'
import { checkWebGLSupport } from '../renderer/webglCheck'
import { WebGLRenderer } from '../renderer/webglRenderer'

export interface CanvasEngineOptions {
  editorOpen: boolean
  activeMedia: { path: string } | null
  /** Called after an image loads successfully, to update thumbnail URL */
  onThumbnailReady?: (entry: ImageCacheEntry) => void
  /** Called when image loading fails with a broken-path error */
  onBrokenPath?: (path: string) => void
  /** Called when WebGL fails */
  onWebglError?: (message: string) => void
}

export function useCanvasEngine(options: CanvasEngineOptions) {
  const { editorOpen, activeMedia, onThumbnailReady, onBrokenPath, onWebglError } = options

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<WebGLRenderer | null>(null)
  const canceledRef = useRef(false)

  const [imageLoading, setImageLoading] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [webglMessage, setWebglMessage] = useState<string | null>(null)
  const [imageRect, setImageRect] = useState({ x: 0, y: 0, width: 1, height: 1 })
  const [sourceAspect, setSourceAspect] = useState(1)
  const [rendererReady, setRendererReady] = useState(false)
  const [renderKey, setRenderKey] = useState(0)

  // WebGL detection
  useEffect(() => {
    const support = checkWebGLSupport()
    if (!support.supported) {
      setWebglMessage(support.message ?? '当前设备不支持工作台渲染')
      onWebglError?.(support.message ?? '当前设备不支持工作台渲染')
      return
    }
    if (support.message && !support.message.includes('不支持')) {
      setWebglMessage(support.message)
    }
  }, [onWebglError])

  // WebGL renderer init
  useEffect(() => {
    if (!editorOpen || !canvasRef.current || rendererRef.current || webglMessage?.includes('不支持')) {
      return
    }
    try {
      rendererRef.current = new WebGLRenderer(canvasRef.current)
      const bounds = canvasRef.current.getBoundingClientRect()
      rendererRef.current.resize(bounds.width, bounds.height)
      updateImageRect()
      setRendererReady(true)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      setWebglMessage(msg)
      onWebglError?.(msg)
    }
    const renderer = rendererRef.current
    return () => {
      renderer?.destroy()
      rendererRef.current = null
      setRendererReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorOpen, webglMessage])

  const updateImageRect = useCallback(() => {
    const rect = rendererRef.current?.getDisplayRect()
    if (rect) setImageRect(rect)
    const aspect = rendererRef.current?.getSourceAspect()
    if (aspect) setSourceAspect(aspect)
  }, [])

  const render = useCallback((pipeline: EditPipeline, opts?: { cropMode?: boolean }) => {
    rendererRef.current?.render(pipeline, { cropMode: opts?.cropMode ?? false })
  }, [])

  // Use refs for callbacks to avoid effect re-trigger loops
  // (onThumbnailReady changes when activeMedia reference changes after thumb update)
  const onThumbnailReadyRef = useRef(onThumbnailReady)
  onThumbnailReadyRef.current = onThumbnailReady
  const onBrokenPathRef = useRef(onBrokenPath)
  onBrokenPathRef.current = onBrokenPath

  // Image loading
  useEffect(() => {
    if (!activeMedia || !rendererReady) return
    let canceled = false
    canceledRef.current = false
    setImageLoading(true)
    setImageError(null)

    workspaceImageCache.generate(activeMedia.path)
      .then((entry) => {
        if (canceled) return
        rendererRef.current?.loadImage(entry.previewBitmap)
        updateImageRect()
        onThumbnailReadyRef.current?.(entry)
        setRenderKey((k) => k + 1)
      })
      .catch((error) => {
        if (canceled) return
        const msg = error instanceof Error ? error.message : String(error)
        setImageError(msg)
        if (
          msg.includes('Input file is missing') ||
          msg.includes('文件不存在') ||
          msg.includes('no such file') ||
          msg.includes('ENOENT')
        ) {
          onBrokenPathRef.current?.(activeMedia.path)
        }
      })
      .finally(() => {
        if (!canceled) setImageLoading(false)
      })

    return () => {
      canceled = true
      canceledRef.current = true
    }
  }, [activeMedia?.path, rendererReady, updateImageRect])

  // Render on resize
  useEffect(() => {
    if (!stageRef.current || !rendererRef.current) return
    const observer = new ResizeObserver(() => {
      const bounds = stageRef.current?.getBoundingClientRect()
      if (!bounds) return
      rendererRef.current?.resize(bounds.width, bounds.height)
      updateImageRect()
      setRenderKey((k) => k + 1)
    })
    observer.observe(stageRef.current)
    return () => observer.disconnect()
  }, [updateImageRect])

  const canRender = Boolean(rendererRef.current && activeMedia && !webglMessage?.includes('不支持'))

  return {
    canvasRef,
    stageRef,
    imageLoading,
    imageError,
    webglMessage,
    imageRect,
    sourceAspect,
    canRender,
    render,
    updateImageRect,
    rendererReady,
    renderKey,
  }
}
