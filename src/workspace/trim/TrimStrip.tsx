import { Pause, Play } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { VideoOutputMarker } from './videoOutputMarkers'

import './TrimStrip.css'

interface TrimStripProps {
  duration: number
  startTime: number
  endTime: number
  currentTime: number
  playing: boolean
  onTogglePlay: () => void
  onSeek: (time: number) => void
  /** 仅在用户拖动播放头或点击轨道定位时触发。 */
  onPlayheadChange?: (time: number) => void
  onStartTimeChange?: (time: number) => void
  onEndTimeChange?: (time: number) => void
  /** 固定时长模式：选区不可缩放，只能整体拖动。 */
  fixedDuration?: number
  onFixedStartChange?: (time: number) => void
  /** 叠加在主截取范围内的固定时长选区（例如 Live 图 3 秒范围）。 */
  secondaryFixedRange?: {
    startTime: number
    duration: number
    label?: string
    coverTime?: number
    onStartChange: (time: number) => void
    onCoverTimeChange?: (time: number) => void
  }
  playheadRange?: { startTime: number; endTime: number }
  /** 是否使用内部动画平滑播放头；关闭时严格使用外部视频时间。 */
  animatePlayhead?: boolean
  compact?: boolean
  thumbnails: ImageData[]
  outputMarkers?: VideoOutputMarker[]
}

type TrimDragType = 'left-handle' | 'right-handle' | 'playhead' | 'fixed-range' | 'secondary-fixed-range' | 'secondary-cover'

function formatShortTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const totalSecs = Math.floor(seconds)
  const mins = Math.floor(totalSecs / 60)
  const secs = totalSecs % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

function formatPreciseTime(seconds: number): string {
  const centiseconds = Math.max(0, Math.round((Number.isFinite(seconds) ? seconds : 0) * 100))
  const hours = Math.floor(centiseconds / 360000)
  const minutes = Math.floor((centiseconds % 360000) / 6000)
  const secs = Math.floor((centiseconds % 6000) / 100)
  const fraction = centiseconds % 100
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(fraction).padStart(2, '0')}`
}

function formatRulerTime(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const secs = totalSeconds % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

export function TrimStrip({
  duration,
  startTime,
  endTime,
  currentTime,
  playing,
  onTogglePlay,
  onSeek,
  onPlayheadChange,
  onStartTimeChange,
  onEndTimeChange,
  fixedDuration,
  onFixedStartChange,
  secondaryFixedRange,
  playheadRange,
  animatePlayhead = true,
  compact = false,
  thumbnails,
  outputMarkers = [],
}: TrimStripProps) {
  const stripRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [trackWidth, setTrackWidth] = useState(0)
  const [dragging, setDragging] = useState<TrimDragType | null>(null)

  // ── ResizeObserver ──
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setTrackWidth(entry.contentRect.width)
    })
    ro.observe(el)
    setTrackWidth(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])

  // ── 渲染胶片缩略图（更高分辨率渲染） ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || thumbnails.length === 0 || !trackWidth) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 用 CSS 尺寸的 2x 分辨率渲染，提高清晰度
    const dpr = 2
    const displayW = trackWidth
    const displayH = compact ? 52 : 72
    canvas.width = displayW * dpr
    canvas.height = displayH * dpr
    canvas.style.width = `${displayW}px`
    canvas.style.height = `${displayH}px`

    ctx.scale(dpr, dpr)
    ctx.fillStyle = '#2a2a2a'
    ctx.fillRect(0, 0, displayW, displayH)

    const count = thumbnails.length
    const thumbW = displayW / count

    for (let i = 0; i < count; i++) {
      const img = thumbnails[i]
      if (!img || img.width <= 1 || img.height <= 1) continue

      const tc = document.createElement('canvas')
      tc.width = img.width
      tc.height = img.height
      const tctx = tc.getContext('2d')
      if (!tctx) continue
      tctx.putImageData(img, 0, 0)

      const srcAspect = img.width / img.height
      const dstAspect = thumbW / displayH
      let sx = 0, sy = 0, sw = img.width, sh = img.height
      if (srcAspect > dstAspect) {
        sw = img.height * dstAspect; sx = (img.width - sw) / 2
      } else {
        sh = img.width / dstAspect; sy = (img.height - sh) / 2
      }
      ctx.drawImage(tc, sx, sy, sw, sh, i * thumbW, 0, thumbW, displayH)
    }
  }, [compact, thumbnails, trackWidth])

  // ── 平滑播放头 ──
  const [animatedTime, setAnimatedTime] = useState(currentTime)
  const animatedTimeRef = useRef(currentTime)
  const rafAnimRef = useRef<number | null>(null)

  useEffect(() => {
    if (!playing || Math.abs(currentTime - animatedTimeRef.current) > 0.35) {
      animatedTimeRef.current = currentTime
      setAnimatedTime(currentTime)
    }
  }, [playing, currentTime])

  useEffect(() => {
    if (!playing || !animatePlayhead) return
    let lastUpdate = performance.now()
    function tick() {
      const now = performance.now()
      const dt = (now - lastUpdate) / 1000
      lastUpdate = now
      animatedTimeRef.current = Math.min(animatedTimeRef.current + dt, endTime)
      setAnimatedTime(animatedTimeRef.current)
      rafAnimRef.current = requestAnimationFrame(tick)
    }
    rafAnimRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafAnimRef.current != null) { cancelAnimationFrame(rafAnimRef.current); rafAnimRef.current = null }
    }
  }, [animatePlayhead, playing, endTime])

  // ── 坐标转换 ──
  const pxPerSec = duration > 0 && trackWidth > 0 ? trackWidth / duration : 0
  const timeToX = useCallback((t: number) => Math.max(0, Math.min(t * pxPerSec, trackWidth)), [pxPerSec, trackWidth])
  const xToTime = useCallback((x: number) => pxPerSec > 0 ? Math.max(0, Math.min(x / pxPerSec, duration)) : 0, [pxPerSec, duration])

  // ── Drag（无 rAF 节流，直接指针响应） ──
  const dragRef = useRef<{
    type: TrimDragType | null
    startX: number
    startTime: number
    startStartTime: number
    startEndTime: number
  }>({ type: null, startX: 0, startTime: 0, startStartTime: 0, startEndTime: 0 })
  const lastSeekRef = useRef(-1)

  const handlePointerDown = useCallback((type: TrimDragType, e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const target = trackRef.current
    if (!target) return
    target.setPointerCapture(e.pointerId)
    const dragType = fixedDuration && (type === 'left-handle' || type === 'right-handle') ? 'fixed-range' : type
    dragRef.current = { type: dragType, startX: e.clientX, startTime: currentTime, startStartTime: startTime, startEndTime: endTime }
    lastSeekRef.current = -1
    setDragging(dragType)
    if (dragType === 'left-handle' || dragType === 'right-handle') onSeek(startTime)
  }, [currentTime, startTime, endTime, fixedDuration, onSeek])

  const handleTrackPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const lx = timeToX(startTime)
    const rx = timeToX(endTime)
    if (Math.abs(x - lx) < 20 || Math.abs(x - rx) < 20) return
    const targetTime = xToTime(x)
    if (fixedDuration) {
      const nextStart = targetTime >= startTime && targetTime <= endTime
        ? startTime
        : Math.max(0, Math.min(targetTime - fixedDuration / 2, duration - fixedDuration))
      e.currentTarget.setPointerCapture(e.pointerId)
      lastSeekRef.current = -1
      dragRef.current = {
        type: 'fixed-range',
        startX: e.clientX,
        startTime: targetTime,
        startStartTime: nextStart,
        startEndTime: nextStart + fixedDuration,
      }
      setDragging('fixed-range')
      if (nextStart !== startTime) onFixedStartChange?.(nextStart)
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      type: 'playhead',
      startX: e.clientX,
      startTime: targetTime,
      startStartTime: startTime,
      startEndTime: endTime,
    }
    lastSeekRef.current = targetTime
    setDragging('playhead')
    onSeek(targetTime)
    onPlayheadChange?.(targetTime)
  }, [startTime, endTime, fixedDuration, duration, timeToX, xToTime, onSeek, onPlayheadChange, onFixedStartChange])

  const handleSecondaryPointerDown = useCallback((e: React.PointerEvent) => {
    if (!secondaryFixedRange) return
    e.preventDefault()
    e.stopPropagation()
    const target = trackRef.current
    if (!target) return
    target.setPointerCapture(e.pointerId)
    lastSeekRef.current = -1
    dragRef.current = {
      type: 'secondary-fixed-range',
      startX: e.clientX,
      startTime: secondaryFixedRange.startTime,
      startStartTime: secondaryFixedRange.startTime,
      startEndTime: secondaryFixedRange.startTime + secondaryFixedRange.duration,
    }
    setDragging('secondary-fixed-range')
  }, [secondaryFixedRange])

  const handleSecondaryCoverPointerDown = useCallback((e: React.PointerEvent) => {
    if (!secondaryFixedRange || secondaryFixedRange.coverTime === undefined) return
    e.preventDefault()
    e.stopPropagation()
    const target = trackRef.current
    if (!target) return
    target.setPointerCapture(e.pointerId)
    lastSeekRef.current = -1
    dragRef.current = {
      type: 'secondary-cover',
      startX: e.clientX,
      startTime: secondaryFixedRange.coverTime,
      startStartTime: secondaryFixedRange.startTime,
      startEndTime: secondaryFixedRange.startTime + secondaryFixedRange.duration,
    }
    setDragging('secondary-cover')
    onSeek(secondaryFixedRange.coverTime)
  }, [onSeek, secondaryFixedRange])

  const handleSecondaryCoverKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!secondaryFixedRange || secondaryFixedRange.coverTime === undefined) return
    let nextTime: number | null = null
    if (e.key === 'ArrowLeft') nextTime = secondaryFixedRange.coverTime - 0.1
    if (e.key === 'ArrowRight') nextTime = secondaryFixedRange.coverTime + 0.1
    if (e.key === 'Home') nextTime = secondaryFixedRange.startTime
    if (e.key === 'End') nextTime = secondaryFixedRange.startTime + secondaryFixedRange.duration - 0.01
    if (nextTime === null) return
    e.preventDefault()
    const clamped = Math.max(
      secondaryFixedRange.startTime,
      Math.min(nextTime, secondaryFixedRange.startTime + secondaryFixedRange.duration - 0.01),
    )
    secondaryFixedRange.onCoverTimeChange?.(clamped)
    onSeek(clamped)
  }, [onSeek, secondaryFixedRange])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag.type) return
    const dx = e.clientX - drag.startX
    const dt = dx / pxPerSec
    let target: number
    let doStart = false, doEnd = false

    if (drag.type === 'secondary-cover' && secondaryFixedRange) {
      target = Math.max(drag.startStartTime, Math.min(drag.startTime + dt, drag.startEndTime - 0.01))
      if (Math.abs(target - lastSeekRef.current) < 0.01) return
      lastSeekRef.current = target
      secondaryFixedRange.onCoverTimeChange?.(target)
      onSeek(target)
      return
    } else if (drag.type === 'secondary-fixed-range' && secondaryFixedRange) {
      const maxStart = Math.max(0, duration - secondaryFixedRange.duration)
      target = Math.max(0, Math.min(drag.startStartTime + dt, maxStart))
      if (Math.abs(target - lastSeekRef.current) < 0.01) return
      lastSeekRef.current = target
      secondaryFixedRange.onStartChange(target)
      return
    } else if (drag.type === 'fixed-range' && fixedDuration) {
      target = Math.max(0, Math.min(drag.startStartTime + dt, duration - fixedDuration))
      if (Math.abs(target - lastSeekRef.current) < 0.01) return
      lastSeekRef.current = target
      onFixedStartChange?.(target)
      return
    } else if (drag.type === 'left-handle') {
      target = Math.max(0, Math.min(drag.startStartTime + dt, endTime - 0.1))
      doStart = true
    } else if (drag.type === 'right-handle') {
      target = Math.max(startTime + 0.1, Math.min(drag.startEndTime + dt, duration))
      doEnd = true
    } else {
      target = Math.max(0, Math.min(drag.startTime + dt, duration))
    }

    // 最小跳变阈值避免冗余 seek
    if (Math.abs(target - lastSeekRef.current) < 0.033) return
    lastSeekRef.current = target

    if (doStart) {
      onStartTimeChange?.(target)
      onSeek(target)
    } else if (doEnd) {
      onEndTimeChange?.(target)
      // 拖动过程中跟随结束把手，便于确认最后一帧。
      onSeek(target)
    } else {
      onSeek(target)
      onPlayheadChange?.(target)
    }
  }, [pxPerSec, startTime, endTime, duration, fixedDuration, secondaryFixedRange, onStartTimeChange, onEndTimeChange, onFixedStartChange, onSeek, onPlayheadChange])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current
    const target = trackRef.current
    if (target) target.releasePointerCapture(e.pointerId)
    if (drag.type === 'right-handle') onSeek(drag.startStartTime)
    dragRef.current.type = null
    setDragging(null)
  }, [onSeek])

  // ── 位置 ──
  const displayTime = playing && animatePlayhead ? animatedTime : currentTime
  const leftHandleX = timeToX(startTime)
  const rightHandleX = timeToX(endTime)
  // 把手层级高于播放头，因此播放头可以准确到达范围端点而不影响拖动。
  const playheadLeftX = timeToX(playheadRange?.startTime ?? startTime)
  const playheadRightX = timeToX(playheadRange?.endTime ?? endTime)
  const playheadX = Math.max(playheadLeftX, Math.min(timeToX(displayTime), playheadRightX))
  const secondaryLeftX = secondaryFixedRange ? timeToX(secondaryFixedRange.startTime) : 0
  const secondaryRightX = secondaryFixedRange
    ? timeToX(secondaryFixedRange.startTime + secondaryFixedRange.duration)
    : 0
  const secondaryCoverX = secondaryFixedRange?.coverTime === undefined
    ? null
    : timeToX(secondaryFixedRange.coverTime) - secondaryLeftX
  const rulerTicks = useMemo(() => {
    if (duration <= 0) return []
    const count = 5
    return Array.from({ length: count }, (_, index) => ({
      time: (duration * index) / (count - 1),
      left: `${(index / (count - 1)) * 100}%`,
    }))
  }, [duration])

  return (
    <div className={`workspace-trim-strip${compact ? ' workspace-trim-strip-compact' : ''}${fixedDuration ? ' workspace-trim-strip-fixed' : ''}`} ref={stripRef}>
      <button className="workspace-trim-play-btn" type="button" onClick={onTogglePlay} aria-label={playing ? '暂停' : '播放'}>
        {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
      </button>

      <div className={`workspace-trim-track${dragging ? ` is-dragging is-dragging-${dragging}` : ''}`} ref={trackRef}
        onPointerDown={handleTrackPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <canvas ref={canvasRef} className="workspace-trim-canvas" />

        {/* 遮罩 */}
        {leftHandleX > 0 && <div className="workspace-trim-mask" style={{ left: 0, width: leftHandleX }} />}
        {rightHandleX < trackWidth && <div className="workspace-trim-mask" style={{ left: rightHandleX, right: 0 }} />}

        {/* 截取范围高亮背景 */}
        <div className="workspace-trim-range-bg" style={{ left: leftHandleX, width: Math.max(0, rightHandleX - leftHandleX) }} />

        {/* 完整蓝色边框 */}
        <div className="workspace-trim-range-border" style={{ left: leftHandleX, width: Math.max(0, rightHandleX - leftHandleX) }} />

        <div className="workspace-trim-output-markers" aria-hidden="true">
          {outputMarkers.map((marker) => marker.kind === 'photo' ? (
            <span
              key={marker.id}
              className="workspace-trim-output-photo"
              style={{ left: timeToX(marker.time) }}
            />
          ) : (
            <span
              key={marker.id}
              className={`workspace-trim-output-range is-${marker.kind}`}
              style={{
                left: timeToX(marker.startTime),
                width: Math.max(2, timeToX(marker.endTime) - timeToX(marker.startTime)),
              }}
            />
          ))}
        </div>

        {secondaryFixedRange ? (
          <div
            className="workspace-trim-secondary-range"
            style={{ left: secondaryLeftX, width: Math.max(0, secondaryRightX - secondaryLeftX) }}
            onPointerDown={handleSecondaryPointerDown}
          >
            <span>{secondaryFixedRange.label ?? 'Live'}</span>
            {secondaryCoverX !== null ? (
              <div
                className="workspace-trim-live-cover"
                style={{ left: secondaryCoverX }}
                role="slider"
                tabIndex={0}
                aria-label="Live 图封面"
                aria-valuemin={secondaryFixedRange.startTime}
                aria-valuemax={secondaryFixedRange.startTime + secondaryFixedRange.duration}
                aria-valuenow={secondaryFixedRange.coverTime}
                onPointerDown={handleSecondaryCoverPointerDown}
                onKeyDown={handleSecondaryCoverKeyDown}
              >
                <i />
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ── 左侧把手 ── */}
        <div className="workspace-trim-handle" onPointerDown={(e) => handlePointerDown('left-handle', e)} style={{ left: leftHandleX }}>
          <span className="workspace-trim-handle-time">{formatPreciseTime(startTime)}</span>
          <div className="workspace-trim-handle-grip" aria-hidden="true"><span /><span /><span /></div>
        </div>

        {/* ── 右侧把手 ── */}
        <div className="workspace-trim-handle workspace-trim-handle-right" onPointerDown={(e) => handlePointerDown('right-handle', e)} style={{ left: rightHandleX }}>
          <span className="workspace-trim-handle-time">{formatPreciseTime(endTime)}</span>
          <div className="workspace-trim-handle-grip" aria-hidden="true"><span /><span /><span /></div>
        </div>

        {/* ── 播放头 ── */}
        <div className="workspace-trim-playhead" onPointerDown={(e) => handlePointerDown('playhead', e)} style={{ left: playheadX }}>
          <div className="workspace-trim-playhead-diamond" />
          <div className="workspace-trim-playhead-line" />
          <div className="workspace-trim-playhead-time">{formatShortTime(displayTime)}</div>
        </div>
      </div>

      {!compact ? (
        <div className="workspace-trim-ruler" aria-hidden="true">
          {rulerTicks.map((tick) => <span key={tick.left} style={{ left: tick.left }}>{formatRulerTime(tick.time)}</span>)}
        </div>
      ) : null}
    </div>
  )
}
