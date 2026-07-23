import { useCallback, useEffect, useMemo, useState } from 'react'

import type { PreviewLayer, VideoExportSettings } from '../shared/types'
import { TrimStrip } from '../workspace/trim/TrimStrip'
import { useTrimThumbnails } from '../workspace/trim/useTrimThumbnails'
import { MultipleLayerVideoPreviewLrcRender } from './MultipleLayerVideoPreviewLrcRender'
import './ExportPreviewPane.css'

const LIVE_DURATION = 3
const MAX_COVER_TIME = LIVE_DURATION - 0.01

export interface ExportPreviewSource {
  path: string
  layers: PreviewLayer[]
  outputSize: { width: number; height: number }
}

interface ExportPreviewPaneProps {
  source: ExportPreviewSource
  livePhotoSource?: ExportPreviewSource & {
    startTime: number
    duration: number
    thumbnailDuration: number
  }
  value: VideoExportSettings
  onChange: (settings: VideoExportSettings) => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function formatTime(seconds: number): string {
  const centiseconds = Math.max(0, Math.round(seconds * 100))
  const minutes = Math.floor(centiseconds / 6000)
  const secs = Math.floor((centiseconds % 6000) / 100)
  return `${minutes}:${String(secs).padStart(2, '0')}.${String(centiseconds % 100).padStart(2, '0')}`
}

export function ExportPreviewPane({ source, livePhotoSource, value, onChange }: ExportPreviewPaneProps) {
  const duration = livePhotoSource?.duration ?? 0
  const sourceStartTime = livePhotoSource?.startTime ?? 0
  const thumbnailDuration = livePhotoSource?.thumbnailDuration ?? duration
  const liveSelected = Boolean(livePhotoSource && value.exportFormats.some((format) => format !== 'video'))
  const minimumRange = liveSelected ? LIVE_DURATION : 0.1
  const exportStart = clamp(value.trimStartTime, 0, Math.max(0, duration - minimumRange))
  const exportEnd = clamp(value.trimEndTime ?? duration, exportStart + minimumRange, duration)
  const liveStart = clamp(value.liveStartTime, exportStart, Math.max(exportStart, exportEnd - LIVE_DURATION))
  const cover = clamp(value.liveCoverTime, 0, MAX_COVER_TIME)
  const playbackStart = liveSelected ? liveStart : exportStart
  const playbackEnd = liveSelected ? liveStart + LIVE_DURATION : exportEnd
  const previewAnchor = liveSelected ? liveStart + cover : exportStart
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(playbackStart + (liveSelected ? cover : 0))
  const { thumbnails, loading } = useTrimThumbnails({
    videoPath: livePhotoSource?.path ?? '',
    duration: thumbnailDuration,
  })

  const timelineThumbnails = useMemo(() => {
    if (!livePhotoSource || thumbnails.length < 2 || thumbnailDuration <= 0) return thumbnails
    const lastIndex = thumbnails.length - 1
    return thumbnails.map((_, index) => {
      const progress = lastIndex > 0 ? index / lastIndex : 0
      const sourceTime = sourceStartTime + progress * duration
      const cachedIndex = Math.round(clamp(sourceTime / thumbnailDuration, 0, 1) * lastIndex)
      return thumbnails[cachedIndex]
    })
  }, [duration, livePhotoSource, sourceStartTime, thumbnailDuration, thumbnails])

  const previewLayers = useMemo(() => source.layers.map((layer) => (
    livePhotoSource && layer.isVideo
      ? { ...layer, videoTime: sourceStartTime + previewAnchor, videoDuration: Math.max(0.1, playbackEnd - playbackStart) }
      : layer
  )), [livePhotoSource, playbackEnd, playbackStart, previewAnchor, source.layers, sourceStartTime])

  const seekPreview = useCallback((relativeTime: number) => {
    const nextTime = clamp(relativeTime, playbackStart, playbackEnd - (liveSelected ? 0.01 : 0))
    setPlaying(false)
    setCurrentTime(nextTime)
    if (videoElement) videoElement.currentTime = sourceStartTime + nextTime
  }, [liveSelected, playbackEnd, playbackStart, sourceStartTime, videoElement])

  const changePlayhead = useCallback((relativeTime: number) => {
    if (!liveSelected) return
    const nextTime = clamp(relativeTime, liveStart, liveStart + MAX_COVER_TIME)
    onChange({ ...value, liveCoverTime: nextTime - liveStart })
  }, [liveSelected, liveStart, onChange, value])

  const changeExportStart = useCallback((nextStart: number) => {
    const start = clamp(nextStart, 0, exportEnd - minimumRange)
    const nextLiveStart = liveSelected
      ? clamp(liveStart, start, exportEnd - LIVE_DURATION)
      : value.liveStartTime
    setPlaying(false)
    setCurrentTime(start)
    onChange({ ...value, trimStartTime: start, liveStartTime: nextLiveStart })
  }, [exportEnd, liveSelected, liveStart, minimumRange, onChange, value])

  const changeExportEnd = useCallback((nextEnd: number) => {
    const end = clamp(nextEnd, exportStart + minimumRange, duration)
    const nextLiveStart = liveSelected
      ? clamp(liveStart, exportStart, end - LIVE_DURATION)
      : value.liveStartTime
    setPlaying(false)
    setCurrentTime(exportStart)
    onChange({ ...value, trimEndTime: end, liveStartTime: nextLiveStart })
  }, [duration, exportStart, liveSelected, liveStart, minimumRange, onChange, value])

  const moveLiveRange = useCallback((nextStart: number) => {
    const start = clamp(nextStart, exportStart, exportEnd - LIVE_DURATION)
    const nextTime = start + cover
    setPlaying(false)
    setCurrentTime(nextTime)
    if (videoElement) videoElement.currentTime = sourceStartTime + nextTime
    onChange({ ...value, liveStartTime: start })
  }, [cover, exportEnd, exportStart, onChange, sourceStartTime, value, videoElement])

  const togglePreview = useCallback(() => {
    if (!videoElement || playbackEnd <= playbackStart) return
    if (playing) {
      setPlaying(false)
      return
    }
    videoElement.currentTime = sourceStartTime + playbackStart
    setCurrentTime(playbackStart)
    setPlaying(true)
  }, [playbackEnd, playbackStart, playing, sourceStartTime, videoElement])

  useEffect(() => {
    if (!videoElement || !playing) return
    let animationFrame = 0
    const updateTime = () => {
      const relativeTime = videoElement.currentTime - sourceStartTime
      if (relativeTime >= playbackEnd - 0.01) {
        videoElement.pause()
        videoElement.currentTime = sourceStartTime + playbackEnd
        setCurrentTime(playbackEnd)
        setPlaying(false)
        return
      }
      setCurrentTime(clamp(relativeTime, playbackStart, playbackEnd))
      animationFrame = requestAnimationFrame(updateTime)
    }
    animationFrame = requestAnimationFrame(updateTime)
    return () => cancelAnimationFrame(animationFrame)
  }, [playbackEnd, playbackStart, playing, sourceStartTime, videoElement])

  useEffect(() => {
    setPlaying(false)
    const nextTime = liveSelected ? liveStart + cover : exportStart
    setCurrentTime(nextTime)
    if (videoElement) videoElement.currentTime = sourceStartTime + nextTime
  }, [cover, exportStart, liveSelected, liveStart, sourceStartTime, videoElement])

  return (
    <section className="export-preview-pane">
      <div className="export-preview-heading">
        <span>导出预览</span>
        <span>{formatTime(exportStart)} – {formatTime(exportEnd)}</span>
      </div>
      <div className="export-preview-frame">
        <MultipleLayerVideoPreviewLrcRender
          className="export-preview-canvas"
          layers={previewLayers}
          canvasWidth={source.outputSize.width}
          canvasHeight={source.outputSize.height}
          playing={playing}
          decodeQuality={1}
          interactiveImageLayerIndexes={[]}
          onVideoElement={setVideoElement}
        />
      </div>

      {livePhotoSource ? (
        <div className="export-preview-trim">
          <div className="export-preview-cover-time">
            {liveSelected ? `Live 图 ${formatTime(liveStart)} – ${formatTime(liveStart + LIVE_DURATION)} · 封面 ${formatTime(liveStart + cover)}` : '拖动两端调整导出长度'}
          </div>
          <div className="export-preview-strip">
            {loading ? <div className="export-preview-loading">正在准备画面…</div> : null}
            <TrimStrip
              compact
              duration={duration}
              startTime={exportStart}
              endTime={exportEnd}
              currentTime={clamp(currentTime, playbackStart, playbackEnd)}
              playing={playing}
              onTogglePlay={togglePreview}
              onSeek={seekPreview}
              onPlayheadChange={changePlayhead}
              onStartTimeChange={changeExportStart}
              onEndTimeChange={changeExportEnd}
              secondaryFixedRange={liveSelected ? {
                startTime: liveStart,
                duration: LIVE_DURATION,
                label: 'Live 3 秒',
                onStartChange: moveLiveRange,
              } : undefined}
              playheadRange={liveSelected ? { startTime: liveStart, endTime: liveStart + LIVE_DURATION } : undefined}
              animatePlayhead={false}
              thumbnails={timelineThumbnails}
            />
          </div>
          <div className="export-preview-help">
            <span>蓝色范围为视频导出片段</span>
            <span>{liveSelected ? '橙色范围为 Live 图片段' : '可在这里再次截取'}</span>
          </div>
        </div>
      ) : null}
    </section>
  )
}
