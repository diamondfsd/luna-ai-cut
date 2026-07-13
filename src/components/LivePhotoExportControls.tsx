import { useCallback, useEffect, useMemo, useState } from 'react'

import type { PreviewLayer, VideoExportFormat, VideoExportSettings } from '../shared/types'
import { Switch } from '../ui'
import { MultipleLayerVideoPreviewLrcRender } from './MultipleLayerVideoPreviewLrcRender'
import { TrimStrip } from '../workspace/trim/TrimStrip'
import { useTrimThumbnails } from '../workspace/trim/useTrimThumbnails'
import './LivePhotoExportControls.css'

const LIVE_DURATION = 3
const MAX_COVER_TIME = LIVE_DURATION - 0.01

interface LivePhotoExportControlsProps {
  value: VideoExportSettings
  sourcePath: string
  sourceStartTime: number
  duration: number
  layers: PreviewLayer[]
  outputSize: { width: number; height: number }
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

export function LivePhotoExportControls({
  value,
  sourcePath,
  sourceStartTime,
  duration,
  layers,
  outputSize,
  onChange,
}: LivePhotoExportControlsProps) {
  const isMac = window.navigator.platform.includes('Mac')
  const maxStart = Math.max(0, duration - LIVE_DURATION)
  const start = clamp(value.liveStartTime, 0, maxStart)
  const cover = clamp(value.liveCoverTime, 0, MAX_COVER_TIME)
  const liveSelected = value.exportFormats.some((format) => format !== 'video')
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(start + cover)
  const { thumbnails, loading } = useTrimThumbnails({ videoPath: sourcePath, duration, startTime: sourceStartTime })

  const previewLayers = useMemo(() => layers.map((layer) => layer.isVideo ? {
    ...layer,
    videoTime: sourceStartTime + start + cover,
    videoDuration: LIVE_DURATION,
  } : layer), [cover, layers, sourceStartTime, start])

  const toggleFormat = useCallback((format: VideoExportFormat, checked: boolean) => {
    const formats = checked
      ? [...new Set([...value.exportFormats, format])]
      : value.exportFormats.filter((candidate) => candidate !== format)
    onChange({ ...value, exportFormats: formats })
  }, [onChange, value])

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
    if (liveSelected) return
    setPlaying(false)
  }, [liveSelected])

  const formats: Array<{ value: VideoExportFormat; label: string; description: string }> = [
    { value: 'video', label: '普通视频', description: '导出完整编辑后视频' },
    { value: 'google-live', label: 'Google Live 图', description: '生成可分享的动态照片' },
    ...(isMac ? [{ value: 'apple-live' as const, label: 'Apple Live 图', description: '保存到系统照片中' }] : []),
  ]

  return (
    <div className="live-photo-export-controls">
      <div className="live-photo-export-heading">导出格式</div>
      <div className="live-photo-export-formats">
        {formats.map((format) => (
          <div className="live-photo-export-format" key={format.value}>
            <div>
              <div className="live-photo-export-format-name">{format.label}</div>
              <div className="live-photo-export-format-description">{format.description}</div>
            </div>
            <Switch
              checked={value.exportFormats.includes(format.value)}
              onCheckedChange={(checked) => toggleFormat(format.value, checked)}
              ariaLabel={`${value.exportFormats.includes(format.value) ? '取消' : '选择'}${format.label}`}
            />
          </div>
        ))}
      </div>

      {liveSelected ? (
        <div className="live-photo-export-timing">
          <div className="live-photo-export-timeline-header">
            <div>
              <div className="live-photo-export-heading">选择 3 秒片段</div>
              <div className="live-photo-export-range">{formatTime(start)} – {formatTime(start + LIVE_DURATION)}</div>
            </div>
            <div className="live-photo-export-cover-time">封面 {formatTime(start + cover)}</div>
          </div>

          {duration < LIVE_DURATION ? (
            <div className="live-photo-export-message">视频不足 3 秒，无法导出 Live 图</div>
          ) : (
            <>
              <div
                className="live-photo-export-preview"
                style={{ aspectRatio: `${outputSize.width} / ${outputSize.height}` }}
              >
                <MultipleLayerVideoPreviewLrcRender
                  className="live-photo-export-preview-canvas"
                  layers={previewLayers}
                  canvasWidth={outputSize.width}
                  canvasHeight={outputSize.height}
                  playing={playing}
                  decodeQuality={1}
                  interactiveImageLayerIndexes={[]}
                  onVideoElement={setVideoElement}
                />
              </div>

              <div className="live-photo-export-fixed-strip">
                {loading ? <div className="live-photo-export-loading">正在准备画面…</div> : null}
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
              <div className="live-photo-export-timeline-help">
                <span>拖动蓝色胶囊选择固定 3 秒片段</span>
                <span>拖动白色播放头选择封面帧</span>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
