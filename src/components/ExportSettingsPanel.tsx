import { useCallback } from 'react'
import { Select, Input, Switch } from '../ui'
import type { PreviewLayer, VideoExportFormat, VideoResolution, VideoFrameRate, VideoQuality, VideoExportSettings } from '../shared/types'
import { lockDolbyVisionExportSettings } from '../shared/types'
import { LivePhotoExportControls } from './LivePhotoExportControls'
import './ExportSettingsPanel.css'

export type { VideoExportSettings, VideoResolution, VideoFrameRate, VideoQuality }

export { DEFAULT_VIDEO_EXPORT_SETTINGS as DEFAULT_EXPORT_CONFIG } from '../shared/types'

interface ExportSettingsPanelProps {
  value: VideoExportSettings
  onChange: (settings: VideoExportSettings) => void
  livePhotoSource?: {
    path: string
    startTime: number
    duration: number
    thumbnailDuration: number
    layers: PreviewLayer[]
    outputSize: { width: number; height: number }
  }
  allowedFormats?: VideoExportFormat[]
  dolbyVisionAvailable?: boolean
  dolbyVisionChecking?: boolean
}

const RESOLUTION_OPTIONS = [
  { value: 'original', label: '原始' },
  { value: '1080p', label: '1080p' },
  { value: '2k', label: '2K' },
  { value: '4k', label: '4K' },
]

const FRAMERATE_OPTIONS = [
  { value: 'original', label: '原始' },
  { value: '24', label: '24 fps' },
  { value: '25', label: '25 fps' },
  { value: '29.97', label: '29.97 fps' },
  { value: '30', label: '30 fps' },
  { value: '50', label: '50 fps' },
  { value: '60', label: '60 fps' },
  { value: '120', label: '120 fps' },
]

const QUALITY_OPTIONS = [
  { value: 'original', label: '原始' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'custom', label: '自定义' },
]

/**
 * 导出设置面板
 *
 * 独立组件，只对外输出 VideoExportSettings 配置。
 * 所有选项默认均为「原始」（即使用源文件参数）。
 *
 * 用法：
 * ```tsx
 * const [config, setConfig] = useState(DEFAULT_EXPORT_CONFIG)
 * <ExportSettingsPanel value={config} onChange={setConfig} />
 * ```
 */
export function ExportSettingsPanel({ value, onChange, livePhotoSource, allowedFormats, dolbyVisionAvailable, dolbyVisionChecking }: ExportSettingsPanelProps) {
  const locked = Boolean(value.dolbyVision)
  const handleResolutionChange = useCallback(
    (v: string) => onChange({ ...value, resolution: v as VideoResolution }),
    [value, onChange],
  )

  const handleFrameRateChange = useCallback(
    (v: string) => onChange({ ...value, frameRate: v as VideoFrameRate }),
    [value, onChange],
  )

  const handleQualityChange = useCallback(
    (v: string) => onChange({ ...value, quality: v as VideoQuality }),
    [value, onChange],
  )

  const handleBitrateChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value
      if (raw === '') {
        onChange({ ...value, customBitrate: undefined })
      } else {
        const num = parseInt(raw, 10)
        if (!isNaN(num) && num >= 0) {
          onChange({ ...value, customBitrate: num })
        }
      }
    },
    [value, onChange],
  )

  return (
    <div className="export-settings-panel">
      <div className="export-settings-title">导出设置</div>
      <div className="export-settings-grid">
        {(dolbyVisionAvailable || dolbyVisionChecking) && (
          <div className="export-settings-row export-settings-dolby-row">
            <label className="export-settings-label">Dolby Vision 导出</label>
            <Switch
              checked={locked}
              disabled={dolbyVisionChecking}
              onCheckedChange={(enabled) => onChange(enabled
                ? lockDolbyVisionExportSettings(value)
                : { ...value, dolbyVision: false })}
              ariaLabel="Dolby Vision 导出"
            />
          </div>
        )}
        {livePhotoSource ? (
          <LivePhotoExportControls
            value={value}
            duration={livePhotoSource.duration}
            allowedFormats={allowedFormats}
            onChange={onChange}
          />
        ) : null}
        <div className="export-settings-row">
          <label className="export-settings-label">分辨率</label>
          <Select
            variant="compact"
            options={RESOLUTION_OPTIONS}
            value={value.resolution}
            onValueChange={handleResolutionChange}
            disabled={locked}
          />
        </div>
        <div className="export-settings-row">
          <label className="export-settings-label">码率</label>
          <Select
            variant="compact"
            options={QUALITY_OPTIONS}
            value={value.quality}
            onValueChange={handleQualityChange}
            disabled={locked}
          />
        </div>
        <div className="export-settings-row">
          <label className="export-settings-label">帧率</label>
          <Select
            variant="compact"
            options={FRAMERATE_OPTIONS}
            value={value.frameRate}
            onValueChange={handleFrameRateChange}
            disabled={locked}
          />
        </div>
        {value.quality === 'custom' && !locked && (
          <div className="export-settings-row">
            <label className="export-settings-label">码率</label>
            <Input
              variant="compact"
              type="number"
              placeholder="mbps，例如 50"
              value={value.customBitrate ?? ''}
              onChange={handleBitrateChange}
              min={0}
              className="export-settings-bitrate-input"
            />
          </div>
        )}
      </div>
    </div>
  )
}
