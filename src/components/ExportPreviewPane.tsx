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
  const liveSelected = Boolean(livePhotoSource && value.exportFormats.some((format) => format !== 'video'))
  const duration = livePhotoSource?.duration ?? 0
  const sourceStartTime = livePhotoSource?.startTime ?? 0
  const maxStart = Math.max(0, duration - LIVE_DURATION)
  const start = clamp(value.liveStartTime, 0, maxStart)
  const cover = clamp(value.liveCoverTime, 0, MAX_COVER_TIME)
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(start + cover)
  const { thumbnails, loading } = useTrimThumbnails({
    videoPath: livePhotoSource?.path ?? '',
    duration,
    startTime: sourceStartTime,
  })

  const previewLayers = useMemo(() => source.layers.map((layer) => (
    livePhotoSource && layer.isVideo
      ? { ...layer, videoTime: sourceStartTime + start + cover, videoDuration: LIVE_DURATION }
      : layer
  )), [cover, livePhotoSource, source.layers, sourceStartTime, start])

  const seekPreview = useCallback((relativeTime: number) => {
    const nextTime = clamp(relativeTime, start, start + MAX_COVER_TIME)
    setPlaying(false)
    setCurrentTime(nextTime)
    if (videoElement) videoElement.currentTime = sourceStartTime + nextTime
    onChange({ ...value, liveCoverTime: nextTime - start })
  }, [onChange, sourceStartTime, start, value, videoElement])

  const moveFixedRange = useCallback((nextStart: number) => {
    const clampedStart = clamp(nextStart, 0, maxStart)
    const nextTime = clampedStart + cover
    setPlaying(false)
    setCurrentTime(nextTime)
    if (videoElement) videoElement.currentTime = sourceStartTime + nextTime
    onChange({ ...value, liveStartTime: clampedStart })
  }, [cover, maxStart, onChange, sourceStartTime, value, videoElement])

  const togglePreview = useCallback(() => {
    if (!videoElement || duration < LIVE_DURATION) return
    if (playing) {
      setPlaying(false)
      return
    }
    videoElement.currentTime = sourceStartTime + start
    setCurrentTime(start)
    setPlaying(true)
  }, [duration, playing, sourceStartTime, start, videoElement])

  useEffect(() => {
    if (!videoElement) return
    const updateTime = () => {
      const relativeTime = videoElement.currentTime - sourceStartTime
      if (playing && relativeTime >= start + LIVE_DURATION - 0.01) {
        videoElement.currentTime = sourceStartTime + start
        setCurrentTime(start)
        return
      }
      setCurrentTime(clamp(relativeTime, 0, duration))
    }
    videoElement.addEventListener('timeupdate', updateTime)
    return () => videoElement.removeEventListener('timeupdate', updateTime)
  }, [duration, playing, sourceStartTime, start, videoElement])

  useEffect(() => {
    if (!liveSelected) setPlaying(false)
  }, [liveSelected])

  return (
    <section className="export-preview-pane">
      <div className="export-preview-heading">
        <span>导出预览</span>
        {liveSelected ? <span>{formatTime(start)} – {formatTime(start + LIVE_DURATION)}</span> : null}
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

      {liveSelected ? (
        duration < LIVE_DURATION ? (
          <div className="export-preview-message">视频不足 3 秒，无法导出 Live 图</div>
        ) : (
          <div className="export-preview-trim">
            <div className="export-preview-cover-time">封面 {formatTime(start + cover)}</div>
            <div className="export-preview-strip">
              {loading ? <div className="export-preview-loading">正在准备画面…</div> : null}
              <TrimStrip
                compact
                fixedDuration={LIVE_DURATION}
                duration={duration}
                startTime={start}
                endTime={start + LIVE_DURATION}
                currentTime={clamp(currentTime, start, start + LIVE_DURATION)}
                playing={playing}
                onTogglePlay={togglePreview}
                onSeek={seekPreview}
                onFixedStartChange={moveFixedRange}
                thumbnails={thumbnails}
              />
            </div>
            <div className="export-preview-help">
              <span>拖动蓝色胶囊选择固定 3 秒片段</span>
              <span>拖动白色播放头选择封面帧</span>
            </div>
          </div>
        )
      ) : null}
    </section>
  )
}
