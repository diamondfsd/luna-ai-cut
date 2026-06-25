import { useMemo } from 'react'
import { ChevronRight, Loader2, ZoomIn, ZoomOut } from 'lucide-react'
import { IconButton } from '../ui'
import { formatBytes } from '../lib/format'
import { WatermarkSettings } from './WatermarkSettings'
import type { DeviceWatermarkStyleConfig, LunaFile, MediaMetadata, WatermarkSettings as WatermarkSettingsType } from '../shared/types'

// ─── MediaDetails ──────────────────────────────────────
// (shared with PreviewModal.tsx)

interface HistogramBin {
  r: number
  g: number
  b: number
  l: number
}

export interface MediaDetails {
  width: number | null
  height: number | null
  duration: number | null
  currentTime: number
  frameRate: number | null
  histogram: HistogramBin[]
}

// ─── Props ─────────────────────────────────────────────

interface MediaInspectorProps {
  file: LunaFile
  mediaDetails: MediaDetails
  mediaMetadata: MediaMetadata | null
  metadataLoading: boolean
  isDownloaded: boolean
  imageZoom: number
  baseScale: number
  onZoomIn: () => void
  onZoomOut: () => void
  onResetZoom: () => void
  onToggleCollapse?: () => void
  watermarkSettings?: WatermarkSettingsType
  onWatermarkChange?: (settings: WatermarkSettingsType) => void
  watermarkStyleOptions?: DeviceWatermarkStyleConfig[]
}

// ─── Helpers ───────────────────────────────────────────

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) return '-'
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60)
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

function formatCapturedAt(value: string | null): string {
  if (!value) return '未知'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
}

function formatBitrate(bytes: number | null | undefined, duration: number | null): string {
  if (!bytes || !duration) return '-'
  return `${((bytes * 8) / duration / 1_000_000).toFixed(1)} Mbps`
}

function areaPath(values: number[], width = 280, height = 72): string {
  if (values.length === 0) return ''
  const step = values.length > 1 ? width / (values.length - 1) : width
  const points = values.map((value, index) => {
    const x = index * step
    const y = height - value * height
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })
  return `M 0,${height} L ${points.join(' L ')} L ${width},${height} Z`
}

function formatAperture(value: string | null): string | null {
  if (!value) return null
  return value.startsWith('f/') ? value : `f/${value}`
}

function formatExposure(value: string | null): string | null {
  if (!value) return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return value
  if (numeric >= 1) return `${numeric}s`
  return `1/${Math.round(1 / numeric)}`
}

/** 将 MetadataGroups 展平为 key → value 映射表 */
function buildMetadataMap(metadata: MediaMetadata | null): Map<string, string> {
  const map = new Map<string, string>()
  if (!metadata) return map
  for (const group of metadata.groups) {
    for (const entry of group.entries) {
      map.set(entry.key, entry.value)
    }
  }
  return map
}

// ─── 枚举值中文映射 ─────────────────────────────────────

const PROGRAM_MAP: Record<string, string> = {
  Manual: '手动',
  'Program AE': '程序自动',
  'Aperture-priority AE': '光圈优先',
  'Shutter-speed-priority AE': '快门优先',
  'Creative (Slow speed)': '创意模式',
  'Action (High speed)': '运动模式',
  Portrait: '人像模式',
  Landscape: '风景模式',
}

const SCENE_MAP: Record<string, string> = {
  Standard: '标准',
  Landscape: '风景',
  Portrait: '人像',
  Night: '夜景',
}

const QUALITY_MAP: Record<string, string> = {
  Normal: '正常',
  Low: '柔和',
  High: '锐利',
}

const WB_MAP: Record<string, string> = {
  Auto: '自动白平衡',
  Manual: '手动白平衡',
}

const EXPOSURE_MODE_MAP: Record<string, string> = {
  Auto: '自动',
  Manual: '手动',
  'Auto bracket': '包围曝光',
}

const METERING_MAP: Record<string, string> = {
  Unknown: '未知',
  Average: '平均测光',
  'Center-weighted average': '中央重点测光',
  Spot: '点测光',
  'Multi-spot': '多区测光',
  'Multi-segment': '矩阵测光',
  Partial: '局部测光',
}

const FLASH_MAP: Record<string, string> = {
  'No Flash': '无闪光',
  Fired: '已闪光',
  'No flash function': '无闪光功能',
}

const SENSING_MAP: Record<string, string> = {
  'One-chip color area': '单芯片色彩传感器',
  'Two-chip color area': '双芯片',
  'Three-chip color area': '三芯片',
  'Color sequential area': '色彩顺序区域',
  Trilinear: '三线传感器',
  'Color sequential linear': '色彩顺序线性',
}

// ─── 字段 / 区域定义 ────────────────────────────────────

interface FieldDef {
  key: string
  label: string
  format?: 'aperture' | 'exposure' | 'ev' | 'maskSerial'
  suffix?: string
  enumMap?: Record<string, string>
}

interface SectionDef {
  title: string
  condition?: (map: Map<string, string>) => boolean
  fields: FieldDef[]
}

const SECTIONS: SectionDef[] = [
  {
    title: '拍摄设备',
    fields: [
      { key: 'Make', label: '相机品牌' },
      { key: 'Model', label: '相机型号' },
      { key: 'Software', label: '固件版本' },
      { key: 'SerialNumber', label: '序列号', format: 'maskSerial' },
    ],
  },
  {
    title: '曝光参数',
    fields: [
      { key: 'ExposureTime', label: '快门速度', format: 'exposure' },
      { key: 'FNumber', label: '光圈', format: 'aperture' },
      { key: 'ISO', label: 'ISO感光度' },
      { key: 'ExposureCompensation', label: '曝光补偿', format: 'ev' },
      { key: 'FocalLengthIn35mmFormat', label: '35mm等效焦距', suffix: 'mm' },
      { key: 'DigitalZoomRatio', label: '数码变焦', suffix: 'x' },
      { key: 'ExposureProgram', label: '曝光模式', enumMap: PROGRAM_MAP },
      { key: 'ExposureMode', label: '曝光方式', enumMap: EXPOSURE_MODE_MAP },
      { key: 'MeteringMode', label: '测光模式', enumMap: METERING_MAP },
      { key: 'WhiteBalance', label: '白平衡', enumMap: WB_MAP },
      { key: 'SceneCaptureType', label: '场景模式', enumMap: SCENE_MAP },
      { key: 'LightValue', label: '曝光值' },
      { key: 'Flash', label: '闪光灯', enumMap: FLASH_MAP },
    ],
  },
  {
    title: '色彩与画质',
    fields: [
      { key: 'ColorSpace', label: '色彩空间' },
      { key: 'ColorSpaceData', label: '色彩空间(ICC)' },
      { key: 'ProfileDescription', label: '色彩配置文件' },
      { key: 'Contrast', label: '对比度', enumMap: QUALITY_MAP },
      { key: 'Saturation', label: '饱和度', enumMap: QUALITY_MAP },
      { key: 'Sharpness', label: '锐度', enumMap: QUALITY_MAP },
      { key: 'GainControl', label: '增益控制' },
      { key: 'CustomRendered', label: '自定义渲染' },
    ],
  },
  {
    title: '传感器',
    fields: [
      { key: 'SensingMethod', label: '传感器类型', enumMap: SENSING_MAP },
      { key: 'FileSource', label: '文件来源' },
      { key: 'SceneType', label: '场景类型' },
      { key: 'BitsPerSample', label: '位深' },
      { key: 'CompressedBitsPerPixel', label: '压缩位/像素' },
    ],
  },
  {
    title: '传感器数据',
    condition: (map) => map.get('Make') === 'Insta360',
    fields: [
      { key: 'Parameters', label: '拼接参数' },
      { key: 'Accelerometer', label: '加速度计' },
      { key: 'AngularVelocity', label: '陀螺仪' },
    ],
  },
]

/** 格式化单个字段值 */
function formatFieldValue(value: string, field: FieldDef): string {
  if (field.enumMap?.[value]) return field.enumMap[value]
  switch (field.format) {
    case 'aperture':
      return formatAperture(value) ?? value
    case 'exposure':
      return formatExposure(value) ?? value
    case 'ev': {
      const trimmed = value.trim()
      return trimmed.startsWith('+') || trimmed.startsWith('-') ? `${trimmed} EV` : `${trimmed} EV`
    }
    case 'maskSerial': {
      const s = value.trim()
      return s.length > 4 ? `****${s.slice(-4)}` : s
    }
    default: {
      let result = value
      if (field.suffix) {
        const trimmed = result.trim()
        if (!trimmed.endsWith(field.suffix) && !trimmed.endsWith(` ${field.suffix}`)) {
          result = `${trimmed}${field.suffix}`
        }
      }
      return result
    }
  }
}

/** 渲染一个元数据区域（如果该区域没有数据则返回 null） */
function MetadataSection({ section, metaMap }: { section: SectionDef; metaMap: Map<string, string> }) {
  const rows = section.fields
    .map((field) => {
      const raw = metaMap.get(field.key)
      if (!raw || raw === '-') return null
      return (
        <div key={field.key}>
          <dt>{field.label}</dt>
          <dd title={raw}>{formatFieldValue(raw, field)}</dd>
        </div>
      )
    })
    .filter(Boolean)

  if (rows.length === 0) return null
  return (
    <section>
      <span className="eyebrow">{section.title}</span>
      <dl>{rows}</dl>
    </section>
  )
}

// ─── Component ─────────────────────────────────────────

export function MediaInspector({
  file,
  mediaDetails,
  mediaMetadata,
  metadataLoading,
  isDownloaded,
  imageZoom,
  baseScale,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onToggleCollapse,
  watermarkSettings,
  onWatermarkChange,
  watermarkStyleOptions,
}: MediaInspectorProps) {
  const metaMap = useMemo(() => buildMetadataMap(mediaMetadata), [mediaMetadata])

  const histogram = mediaDetails.histogram
  const histogramWidth = 280
  const histogramHeight = 72
  const luminancePath = areaPath(histogram.map((bin) => bin.l), histogramWidth, histogramHeight)
  const redPath = areaPath(histogram.map((bin) => bin.r), histogramWidth, histogramHeight)
  const greenPath = areaPath(histogram.map((bin) => bin.g), histogramWidth, histogramHeight)
  const bluePath = areaPath(histogram.map((bin) => bin.b), histogramWidth, histogramHeight)

  // 检查是否有任意一个元数据区域有内容
  const hasAnySection = SECTIONS.some((section) => {
    if (section.condition && !section.condition(metaMap)) return false
    return section.fields.some((f) => {
      const raw = metaMap.get(f.key)
      return raw && raw !== '-'
    })
  })

  return (
    <aside className="media-inspector">
      {/* ── 水印设置（图片/视频） ── */}
      {file.kind !== 'unknown' && watermarkSettings && onWatermarkChange && (
        <WatermarkSettings settings={watermarkSettings} onChange={onWatermarkChange} styleOptions={watermarkStyleOptions} />
      )}

      {/* ── 文件信息（通用） ── */}
      <section>
        <div className="inspector-section-header">
          <span className="eyebrow">文件信息</span>
          {onToggleCollapse && (
            <button className="inspector-collapse-btn" onClick={onToggleCollapse} title="收起信息面板">
              <ChevronRight size={16} />
            </button>
          )}
        </div>
        <dl>
          <div>
            <dt>文件大小</dt>
            <dd>{formatBytes(file.bytes)}</dd>
          </div>
          <div>
            <dt>拍摄时间</dt>
            <dd>{formatCapturedAt(file.capturedAt)}</dd>
          </div>
          {(file.kind !== 'video' || isDownloaded) && (
            <div>
              <dt>分辨率</dt>
              <dd>{mediaDetails.width && mediaDetails.height ? `${mediaDetails.width} x ${mediaDetails.height}` : '-'}</dd>
            </div>
          )}
        </dl>
      </section>

      {/* ── 图片特有内容 ── */}
      {file.kind === 'image' ? (
        <>
          {/* 颜色与亮度（直方图） */}
          <section>
            <span className="eyebrow">颜色与亮度</span>
            <div className="histogram" aria-label="颜色与亮度面积图">
              {histogram.length > 0 ? (
                <svg viewBox={`0 0 ${histogramWidth} ${histogramHeight}`} preserveAspectRatio="none">
                  <path className="luma-area" d={luminancePath} />
                  <path className="red-area" d={redPath} />
                  <path className="green-area" d={greenPath} />
                  <path className="blue-area" d={bluePath} />
                </svg>
              ) : (
                <small>暂无曲线</small>
              )}
            </div>
            <div className="histogram-legend">
              <span>亮度</span>
              <span>红</span>
              <span>绿</span>
              <span>蓝</span>
            </div>
            <dl>
              <div>
                <dt>缩放</dt>
                <dd>{Math.round(imageZoom * baseScale * 100)}%</dd>
              </div>
            </dl>
            <div className="zoom-tools">
              <IconButton
                variant="light"
                onClick={onZoomOut}
                title="缩小"
                icon={<ZoomOut size={14} />}
              />
              <IconButton
                variant="light"
                style={{ fontSize: 12, fontWeight: 400 }}
                icon="1x"
                onClick={onResetZoom}
                title="适配屏幕"
              />
              <IconButton
                variant="light"
                onClick={onZoomIn}
                title="放大"
                icon={<ZoomIn size={14} />}
              />
            </div>
          </section>

          {/* EXIF 元数据区域 */}
          {metadataLoading ? (
            <section>
              <span className="eyebrow">图片属性</span>
              <Loader2 className="spin" size={18} />
            </section>
          ) : (
            !hasAnySection ? (
              <section>
                <span className="eyebrow">图片属性</span>
                <p className="metadata-empty">暂无扩展信息</p>
              </section>
            ) : (
              SECTIONS.map((section) => {
                if (section.condition && !section.condition(metaMap)) return null
                return <MetadataSection key={section.title} section={section} metaMap={metaMap} />
              })
            )
          )}
        </>
      ) : (
        /* ── 视频参数 ── */
        <section>
          <span className="eyebrow">视频参数</span>
          <dl>
            <div>
              <dt>时长</dt>
              <dd>{formatDuration(mediaDetails.duration)}</dd>
            </div>
            <div>
              <dt>播放</dt>
              <dd>
                {formatDuration(mediaDetails.currentTime)} / {formatDuration(mediaDetails.duration)}
              </dd>
            </div>
            <div>
              <dt>码率</dt>
              <dd>{formatBitrate(file.bytes, mediaDetails.duration)}</dd>
            </div>
            {isDownloaded && (
              <>
                <div>
                  <dt>分辨率</dt>
                  <dd>{mediaDetails.width && mediaDetails.height ? `${mediaDetails.width} x ${mediaDetails.height}` : '-'}</dd>
                </div>
                <div>
                  <dt>帧率</dt>
                  <dd>{mediaDetails.frameRate ? `${mediaDetails.frameRate} fps` : '-'}</dd>
                </div>
              </>
            )}
          </dl>
        </section>
      )}
    </aside>
  )
}
