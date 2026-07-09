import { useEffect, useRef, useState } from 'react'
import type { CompositionInput } from '../shared/types/render'
import {
  initPreviewEngine,
  updatePreviewState,
  getLatestPreviewFrame,
  destroyPreviewEngine,
  type PreviewFrameData,
} from '../hooks/usePreviewEngine'

const PREVIEW_FPS = 30

interface CompositionPreviewCanvasProps {
  composition: CompositionInput | null
  className?: string
  playing?: boolean
  startTime?: number
  dragging?: boolean
  onTimeChange?: (time: number) => void
  onPlaybackEnd?: () => void
  onError?: (message: string) => void
}

export function CompositionPreviewCanvas({
  composition,
  className,
  playing = true,
  startTime = 0,
  dragging = false,
  onTimeChange,
  onPlaybackEnd,
  onError,
}: CompositionPreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const compositionRef = useRef<CompositionInput | null>(composition)
  const readyRef = useRef(false)
  const timeRef = useRef(0)
  const startTimeRef = useRef(startTime)
  const rafRef = useRef(0)
  const lastFrameAtRef = useRef(0)
  const endedRef = useRef(false)
  const wasPlayingRef = useRef(playing)
  const [fatalError, setFatalError] = useState<string | null>(null)
  compositionRef.current = composition

  useEffect(() => {
    initPreviewEngine()
      .then(() => {
        readyRef.current = true
      })
      .catch((error: Error) => {
        const msg = `渲染引擎初始化失败: ${error.message}`
        setFatalError(msg)
        onError?.(msg)
      })
    return () => {
      void destroyPreviewEngine()
    }
  }, [])

  // 当 composition 变化时更新引擎状态
  useEffect(() => {
    if (!readyRef.current || !composition) return
    const mode = dragging ? 'dragging' : playing ? 'playing' : 'final-seek'
    updatePreviewState(mode, timeRef.current, composition)
  }, [composition, playing, dragging])

  // 当 startTime 变化时 seek
  useEffect(() => {
    if (startTimeRef.current === startTime) return
    startTimeRef.current = startTime
    timeRef.current = startTime
    endedRef.current = false
    onTimeChange?.(startTime)
    if (!readyRef.current || !compositionRef.current) return
    updatePreviewState('final-seek', startTime, compositionRef.current)
  }, [startTime, onTimeChange])

  // 播放状态切换
  useEffect(() => {
    const current = compositionRef.current
    const duration = current?.canvas.duration ?? 5
    if (playing && !wasPlayingRef.current && endedRef.current) {
      timeRef.current = 0
      endedRef.current = false
      lastFrameAtRef.current = 0
      onTimeChange?.(0)
      if (current) updatePreviewState('playing', 0, current)
    }
    if (playing && duration > 0 && timeRef.current >= duration) {
      timeRef.current = 0
      endedRef.current = false
      lastFrameAtRef.current = 0
      onTimeChange?.(0)
      if (current) updatePreviewState('playing', 0, current)
    }
    wasPlayingRef.current = playing
  }, [playing, onTimeChange])

  // 主循环：推进时间 + 拉最新帧 + 渲染画布
  useEffect(() => {
    function tick(now: number) {
      const current = compositionRef.current
      const ready = readyRef.current

      // 推进时间（仅在 playing 状态）
      if (playing && current && ready) {
        if (now - lastFrameAtRef.current >= 1000 / PREVIEW_FPS) {
          lastFrameAtRef.current = now
          const duration = current.canvas.duration ?? 5
          const nextTime = duration > 0 ? timeRef.current + 1 / PREVIEW_FPS : 0
          if (duration > 0 && nextTime >= duration) {
            timeRef.current = duration
            endedRef.current = true
            onTimeChange?.(duration)
            onPlaybackEnd?.()
            updatePreviewState('idle', duration, current)
            rafRef.current = requestAnimationFrame(tick)
            return
          }
          timeRef.current = nextTime
          onTimeChange?.(timeRef.current)
          updatePreviewState('playing', timeRef.current, current)
        }
      }

      // 拉取最新帧并渲染
      if (ready) {
        getLatestPreviewFrame()
          .then((frame: PreviewFrameData | null) => {
            if (!frame) return
            const canvas = canvasRef.current
            if (!canvas) return
            canvas.width = frame.width
            canvas.height = frame.height
            const context = canvas.getContext('2d')
            if (!context) return
            context.putImageData(new ImageData(frame.data, frame.width, frame.height), 0, 0)
          })
          .catch(() => {})
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing])

  if (fatalError) return <div className={className}>{fatalError}</div>
  return <canvas ref={canvasRef} className={className} />
}
