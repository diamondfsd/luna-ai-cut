import { useCallback } from 'react'

import type { VideoExportFormat, VideoExportSettings } from '../shared/types'
import { Switch } from '../ui'
import './LivePhotoExportControls.css'

interface LivePhotoExportControlsProps {
  value: VideoExportSettings
  duration: number
  onChange: (settings: VideoExportSettings) => void
}

export function LivePhotoExportControls({ value, duration, onChange }: LivePhotoExportControlsProps) {
  const isMac = window.navigator.platform.includes('Mac')
  const liveSelected = value.exportFormats.some((format) => format !== 'video')

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
      {liveSelected && duration < 3 ? (
        <div className="live-photo-export-message">视频不足 3 秒，无法导出 Live 图</div>
      ) : null}
    </div>
  )
}
