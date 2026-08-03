import { useCallback } from 'react'

import type { VideoExportFormat, VideoExportSettings } from '../shared/types'
import { Switch } from '../ui'
import './LivePhotoExportControls.css'

interface LivePhotoExportControlsProps {
  value: VideoExportSettings
  duration: number
  allowedFormats?: VideoExportFormat[]
  outputAvailability?: { video: boolean; photo: boolean; live: boolean }
  onChange: (settings: VideoExportSettings) => void
}

export function LivePhotoExportControls({ value, duration, allowedFormats, outputAvailability, onChange }: LivePhotoExportControlsProps) {
  const isMac = window.navigator.platform.includes('Mac')
  const liveSelected = value.exportFormats.some((format) => format !== 'video')
  const videoAvailable = outputAvailability?.video ?? true
  const photoAvailable = outputAvailability?.photo ?? false
  const liveAvailable = outputAvailability?.live ?? true

  const toggleFormat = useCallback((format: VideoExportFormat, checked: boolean) => {
    const formats = checked
      ? [...new Set([...value.exportFormats, format])]
      : value.exportFormats.filter((candidate) => candidate !== format)
    if (checked && format !== 'video') {
      let trimStartTime = Math.max(0, value.trimStartTime)
      let trimEndTime = Math.min(duration, value.trimEndTime ?? duration)
      if (trimEndTime - trimStartTime < 3) {
        trimEndTime = Math.min(duration, trimStartTime + 3)
        trimStartTime = Math.max(0, trimEndTime - 3)
      }
      const liveStartTime = Math.min(Math.max(value.liveStartTime, trimStartTime), trimEndTime - 3)
      onChange({ ...value, exportFormats: formats, trimStartTime, trimEndTime, liveStartTime })
      return
    }
    onChange({ ...value, exportFormats: formats })
  }, [duration, onChange, value])

  const formats: Array<{ value: VideoExportFormat; label: string; description: string; available: boolean }> = [
    { value: 'video' as const, label: '普通视频', description: '导出完整视频或已标记片段', available: videoAvailable },
    { value: 'google-live' as const, label: '通用 Live 图', description: '导出全部 Live 图片段', available: liveAvailable },
    ...(isMac ? [{ value: 'apple-live' as const, label: 'Apple Live 图', description: '将全部 Live 图片段保存到系统照片', available: liveAvailable }] : []),
  ].filter((format) => !allowedFormats || allowedFormats.includes(format.value))
    .filter((format) => format.available)

  return (
    <div className="live-photo-export-controls">
      <div className="live-photo-export-heading">导出格式</div>
      <div className="live-photo-export-formats">
        {photoAvailable ? (
          <div className="live-photo-export-format">
            <div>
              <div className="live-photo-export-format-name">照片</div>
              <div className="live-photo-export-format-description">导出图片素材和全部照片标记</div>
            </div>
            <Switch
              checked={value.exportPhotos}
              onCheckedChange={(exportPhotos) => onChange({ ...value, exportPhotos })}
              ariaLabel={`${value.exportPhotos ? '取消' : '选择'}照片`}
            />
          </div>
        ) : null}
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
      {liveAvailable && liveSelected && duration < 3 ? (
        <div className="live-photo-export-message">视频不足 3 秒，无法导出 Live 图</div>
      ) : null}
    </div>
  )
}
