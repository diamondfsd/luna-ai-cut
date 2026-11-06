import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, FolderOpen, LoaderCircle, RefreshCw, ScanLine } from 'lucide-react'

import { useApp } from '../context/AppContext'
import { useDeviceConnection } from '../context/DeviceConnectionContext'
import { Button, Select } from '../ui'
import '../styles/panorama-stitching-lab.css'

type OutputWidth = 16000 | 24000 | 32000
type ViewState = 'empty' | 'loading' | 'ready' | 'stitching' | 'complete' | 'error'
type LayoutId = '19' | '24' | '32'

const PANORAMA_LAYOUTS = {
  '19': { rows: 3, columns: 6, photoCount: 19, pitchTop: 45, pitchStep: 45, zenith: true },
  '24': { rows: 4, columns: 6, photoCount: 24, pitchTop: 63, pitchStep: 40 },
  '32': { rows: 4, columns: 8, photoCount: 32, pitchTop: 72, pitchStep: 43 },
} as const
const PAN_MIN = -57
const PAN_MAX = 235

interface PanoramaStitchingLabViewProps {
  active: boolean
  onBack: () => void
}

interface PanoramaResult {
  path: string
  width: number
  height: number
}

interface PhonePanoramaRecord {
  id: string
  started_at: string
  photos: Array<{ slot: number; name: string; available: boolean }>
  mode?: string | null
}

const MODE_ROWS: Record<string, number[]> = {
  grid_666: [6, 6, 6],
  rings_675: [6, 7, 5],
  rings_585: [5, 8, 5],
}

function rowMajorFromCaptureOrder<T>(
  captureOrder: T[],
  rows: number,
  columns: number,
  zenith: boolean,
): T[] {
  const rowMajor = Array<T>(rows * columns)
  const gridCaptureOrder = zenith ? captureOrder.slice(0, rows * columns) : captureOrder
  gridCaptureOrder.forEach((item, index) => {
    const column = Math.floor(index / rows)
    const step = index % rows
    const row = column % 2 === 0 ? step : rows - 1 - step
    rowMajor[row * columns + column] = item
  })
  return zenith ? [...rowMajor, ...captureOrder.slice(rows * columns)] : rowMajor
}

function poseForGridIndex(
  index: number,
  rows: number,
  columns: number,
  pitchTop: number,
  pitchStep: number,
  zenith: boolean,
): number[] {
  if (zenith && index === rows * columns) {
    return [PAN_MAX, 90, 0]
  }
  const row = Math.floor(index / columns)
  const column = index % columns
  const yaw = PAN_MIN + ((PAN_MAX - PAN_MIN) * column) / (columns - 1)
  const pitch = pitchTop - row * pitchStep
  return [yaw, pitch, 0]
}

function messageForState(state: ViewState, error: string | null, photoCount: number): string {
  if (error) return error
  if (state === 'loading') return `正在读取 ${photoCount} 张照片`
  if (state === 'stitching') return '正在合成全景图'
  if (state === 'complete') return '合成完成'
  return ''
}

export function PanoramaStitchingLabView({ active, onBack }: PanoramaStitchingLabViewProps) {
  const navigate = useNavigate()
  const { settings } = useApp()
  const { activeDevice, isConnected, sourceMode } = useDeviceConnection()
  const [state, setState] = useState<ViewState>('empty')
  const [layoutId, setLayoutId] = useState<LayoutId>('19')
  const [targetWidth, setTargetWidth] = useState<OutputWidth>(24000)
  const [gridPaths, setGridPaths] = useState<string[]>([])
  const [thumbnails, setThumbnails] = useState<Array<string | null>>([])
  const [result, setResult] = useState<PanoramaResult | null>(null)
  const [resultThumbnail, setResultThumbnail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [phoneEndpoint, setPhoneEndpoint] = useState<string | null>(null)
  const [phoneRecords, setPhoneRecords] = useState<PhonePanoramaRecord[]>([])
  const [recordMode, setRecordMode] = useState<string | null>(null)
  const [recordPoses, setRecordPoses] = useState<number[][] | null>(null)
  const busy = state === 'loading' || state === 'stitching'
  const { rows, columns, photoCount, pitchTop, pitchStep } = PANORAMA_LAYOUTS[layoutId]
  const zenith = layoutId === '19'
  const supportedCamera = activeDevice?.protocol === 'insta360'
  const statusMessage = messageForState(state, error, photoCount)

  const changeLayout = useCallback((value: string) => {
    if (value !== '19' && value !== '24' && value !== '32') return
    setLayoutId(value)
    setState('empty')
    setGridPaths([])
    setRecordMode(null)
    setRecordPoses(null)
    setThumbnails([])
    setResult(null)
    setResultThumbnail(null)
    setError(null)
  }, [])

  const showPhotoGrid = useCallback(async (captureOrder: string[]) => {
    if (captureOrder.length !== photoCount) {
      throw new Error(`请选择正好 ${photoCount} 张照片`)
    }
    const grid = rowMajorFromCaptureOrder(captureOrder, rows, columns, zenith)
    setRecordMode(null)
    setRecordPoses(null)
    const nextThumbnails = await Promise.all(
      grid.map((path) => window.luna.resolveThumbnail(path, 'image').catch(() => null)),
    )
    setGridPaths(grid)
    setThumbnails(nextThumbnails)
    setState('ready')
  }, [columns, photoCount, rows, zenith])

  const loadPhoneRecords = useCallback(async () => {
    setState('loading')
    setError(null)
    try {
      const saved = localStorage.getItem('luna.director-lab.endpoint')
      const discovered = await window.luna.directorLab.discover()
      const endpoints = [...new Set([saved, ...discovered.services.map((service) => service.baseUrl)].filter((item): item is string => Boolean(item)))]
      for (const endpoint of endpoints) {
        try {
          const result = await window.luna.lunaKaHttpClient.request<{ service: string; records: PhonePanoramaRecord[] }>(endpoint, '/api/v1/panorama/records')
          if (result.service !== 'luna-ka-panorama' || !Array.isArray(result.records)) continue
          setPhoneEndpoint(endpoint)
          setPhoneRecords(result.records)
          setState('empty')
          if (result.records.length === 0) setError('手机上没有全景拍摄记录')
          return
        } catch { /* Try the next discovered phone. */ }
      }
      throw new Error('未找到已连接的手机，请确认手机与电脑在同一局域网')
    } catch (cause) {
      setState('error')
      setError(cause instanceof Error ? cause.message : '读取手机拍摄记录失败')
    }
  }, [])

  const loadPhoneRecord = useCallback(async (record: PhonePanoramaRecord) => {
    if (!phoneEndpoint) return
    setState('loading')
    setError(null)
    try {
      const { paths, mode, poses } = await window.luna.downloadPhonePanoramaRecord(phoneEndpoint, record.id)
      if (paths.length !== 19 && paths.length !== 24 && paths.length !== 32) throw new Error('拍摄记录不完整')
      setLayoutId(String(paths.length) as LayoutId)
      setRecordMode(mode)
      setRecordPoses(poses?.map((pose) => [pose.yaw, pose.pitch, pose.roll]) ?? null)
      setGridPaths(paths)
      setThumbnails(await Promise.all(paths.map((path) => window.luna.resolveThumbnail(path, 'image').catch(() => null))))
      setResult(null)
      setResultThumbnail(null)
      setState('ready')
    } catch (cause) {
      setState('error')
      setError(cause instanceof Error ? cause.message : '下载拍摄记录失败')
    }
  }, [phoneEndpoint])

  const loadRecentCameraPhotos = useCallback(async () => {
    if (!isConnected || !settings || !supportedCamera) return
    setState('loading')
    setError(null)
    setGridPaths([])
    setRecordMode(null)
    setRecordPoses(null)
    setThumbnails([])
    setResult(null)
    setResultThumbnail(null)

    try {
      const files = await window.luna.cameraSource.listFiles({
        mode: sourceMode,
        deviceId: settings.activeDeviceId ?? activeDevice?.id,
        host: settings.cameraHost ?? activeDevice?.defaultHost,
        rootPath: settings.mountedCameraRoot,
      })
      const latest = files
        .filter((file) => file.kind === 'image' && /\.(?:jpe?g|insp)$/i.test(file.name) && file.capturedAt)
        .sort((left, right) => {
          const byTime = Date.parse(left.capturedAt!) - Date.parse(right.capturedAt!)
          return byTime || left.name.localeCompare(right.name)
        })
        .slice(-photoCount)

      if (latest.length !== photoCount) {
        setState('error')
        setError(`相机中带拍摄时间的 JPEG 照片不足 ${photoCount} 张`)
        return
      }

      const summary = await window.luna.downloadFiles(latest.map((file) => ({ ...file, rawCompanion: null })))
      if (summary.failed.length > 0 || summary.completed.length !== photoCount) {
        setState('error')
        setError(`照片下载失败 ${summary.failed.length} 张，请重试`)
        return
      }

      const downloadedByName = new Map(summary.completed.map((item) => [item.name, item.path]))
      const captureOrder = latest.map((file) => downloadedByName.get(file.name) ?? '')
      if (captureOrder.some((path) => !path)) {
        setState('error')
        setError('部分照片没有下载到本地，请重试')
        return
      }

      await showPhotoGrid(captureOrder)
    } catch {
      setState('error')
      setError('读取或下载相机照片失败，请重试')
    }
  }, [activeDevice?.defaultHost, activeDevice?.id, isConnected, photoCount, settings, showPhotoGrid, sourceMode, supportedCamera])

  const loadLocalPhotos = useCallback(async () => {
    setState('loading')
    setError(null)
    setGridPaths([])
    setRecordMode(null)
    setRecordPoses(null)
    setThumbnails([])
    setResult(null)
    setResultThumbnail(null)
    try {
      const photos = await window.luna.choosePanoramaPhotos(photoCount)
      if (!photos) {
        setState('empty')
        return
      }
      await showPhotoGrid(photos.map((photo) => photo.path))
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : ''
      setState('error')
      setError(reason.includes(`正好 ${photoCount} 张`) ? `请选择正好 ${photoCount} 张照片` : '读取本地照片失败，请重试')
    }
  }, [photoCount, showPhotoGrid])

  const startStitching = useCallback(async () => {
    if (gridPaths.length !== photoCount) return
    setState('stitching')
    setError(null)
    try {
      const panorama = await window.luna.stitchPanorama({
        paths: gridPaths,
        poses: recordPoses ?? gridPaths.map((_, index) =>
          poseForGridIndex(index, rows, columns, pitchTop, pitchStep, zenith),
        ),
        rows,
        columns,
        targetWidth,
      })
      if (!panorama) {
        setState('ready')
        return
      }
      setResult(panorama)
      setResultThumbnail(await window.luna.resolveThumbnail(panorama.path, 'image'))
      setState('complete')
    } catch (cause) {
      setState('error')
      setError(cause instanceof Error && cause.message ? `合成失败：${cause.message}` : '合成失败，请检查照片后重试')
    }
  }, [columns, gridPaths, photoCount, pitchStep, pitchTop, recordPoses, rows, targetWidth, zenith])

  const recordRows = recordMode ? MODE_ROWS[recordMode] : undefined
  const photoTile = (index: number) => (
    <div className="panorama-lab-photo" key={gridPaths[index]}>
      {thumbnails[index] && <img src={thumbnails[index]!} alt={`第 ${index + 1} 张`} />}
      <span>{index + 1}</span>
    </div>
  )

  if (!active) return null

  return (
    <main className="panorama-lab-page">
      <header className="panorama-lab-header">
        <Button variant="ghost" icon={<ArrowLeft size={16} />} onClick={onBack}>实验室</Button>
        <h1>360 全景合成</h1>
        <span className={`panorama-lab-connection ${isConnected ? 'is-connected' : ''}`}>
          {isConnected ? '相机已连接' : '相机未连接'}
        </span>
      </header>

      <div className="panorama-lab-layout">
        <section className="panorama-lab-controls">
          <label className="panorama-lab-field-label">拍摄布局</label>
          <Select
            variant="compact"
            fullWidth
            disabled={busy}
            placeholder="拍摄布局"
            value={layoutId}
            onValueChange={changeLayout}
            options={[
              { value: '19', label: '19 张 · 3 × 6 + 天顶' },
              { value: '24', label: '24 张 · 4 × 6' },
              { value: '32', label: '32 张 · 4 × 8' },
            ]}
          />

          <Button variant="secondary" icon={<RefreshCw size={15} />} disabled={busy} onClick={() => void loadPhoneRecords()}>
            读取手机拍摄记录
          </Button>
          {phoneRecords.map((record) => (
            <Button key={record.id} variant="secondary" disabled={busy} onClick={() => void loadPhoneRecord(record)}>
              {new Date(record.started_at).toLocaleString()} · {record.mode && MODE_ROWS[record.mode] ? `${MODE_ROWS[record.mode].join('/')} · ` : ''}{record.photos.filter((photo) => photo.available).length}/{record.photos.length} 张
            </Button>
          ))}

          {!supportedCamera && isConnected ? (
            <p className="panorama-lab-notice">请切换到 Luna 相机</p>
          ) : !isConnected ? (
            <Button variant="primary" icon={<RefreshCw size={15} />} onClick={() => navigate('/library')}>
              连接相机
            </Button>
          ) : (
            <Button
              variant="primary"
              icon={state === 'loading' ? <LoaderCircle className="is-spinning" size={15} /> : <RefreshCw size={15} />}
              disabled={busy}
              onClick={() => void loadRecentCameraPhotos()}
            >
              读取相机最近 {photoCount} 张
            </Button>
          )}
          <Button
            variant="secondary"
            icon={state === 'loading' ? <LoaderCircle className="is-spinning" size={15} /> : <FolderOpen size={15} />}
            disabled={busy}
            onClick={() => void loadLocalPhotos()}
          >
            选择本地 {photoCount} 张照片
          </Button>
          {zenith && <p className="panorama-lab-path-note">6/7/5 和 5/8/5 方案请从手机拍摄记录导入。</p>}

          <label className="panorama-lab-field-label">输出尺寸</label>
          <Select
            variant="compact"
            fullWidth
            disabled={busy}
            placeholder="输出尺寸"
            value={String(targetWidth)}
            onValueChange={(value) => setTargetWidth(Number(value) as OutputWidth)}
            options={[
              { value: '16000', label: '16K · 128 MP' },
              { value: '24000', label: '24K · 288 MP' },
              { value: '32000', label: '32K · 512 MP' },
            ]}
          />

          <div className="panorama-lab-summary">
            <div><span>照片</span><strong>{gridPaths.length}/{photoCount}</strong></div>
            <div><span>排列</span><strong>{recordRows ? `${recordRows.join(' / ')} + 天顶` : `${rows} × ${columns}`}</strong></div>
            <div><span>投影</span><strong>360° 等距圆柱</strong></div>
          </div>

          {statusMessage && (
            <p className={`panorama-lab-status ${state === 'error' ? 'is-error' : ''}`} role="status">
              {state === 'complete' && <Check size={14} />}
              {statusMessage}
            </p>
          )}

          {state === 'ready' && (
            <Button variant="primary" icon={<ScanLine size={15} />} onClick={() => void startStitching()}>
              开始合成
            </Button>
          )}
          {state === 'stitching' && (
            <Button variant="primary" disabled icon={<LoaderCircle className="is-spinning" size={15} />}>
              正在合成
            </Button>
          )}
          {state === 'complete' && result && (
            <div className="panorama-lab-result-actions">
              <span>{result.width.toLocaleString()} × {result.height.toLocaleString()}</span>
              <Button variant="secondary" icon={<FolderOpen size={15} />} onClick={() => void window.luna.revealFile(result.path)}>
                显示文件
              </Button>
            </div>
          )}
          <p className="panorama-lab-path-note">照片会下载到当前设置的本地资源目录</p>
        </section>

        <section className="panorama-lab-preview" aria-label="全景照片预览">
          {result ? (
            <div className="panorama-lab-result-preview">
              {resultThumbnail
                ? <img src={resultThumbnail} alt="360 全景合成结果" />
                : <span>预览暂不可用</span>}
              <span>{result.width.toLocaleString()} × {result.height.toLocaleString()}</span>
            </div>
          ) : gridPaths.length > 0 && recordRows ? (
            <div className="panorama-lab-record-grid">
              {recordRows.map((count, row) => {
                const offset = recordRows.slice(0, row).reduce((sum, value) => sum + value, 0)
                return <div className="panorama-lab-record-row" key={row}>{Array.from({ length: count }, (_, index) => photoTile(offset + index))}</div>
              })}
              <div className="panorama-lab-record-row">{photoTile(18)}</div>
            </div>
          ) : gridPaths.length > 0 ? (
            <div className={`panorama-lab-grid is-${columns}-columns${zenith ? ' is-zenith-layout' : ''}`}>
              {Array.from({ length: photoCount }, (_, index) => index + 1).map((label, index) => (
                <div className={`panorama-lab-photo${zenith && index === 18 ? ' is-zenith-photo' : ''}`} key={gridPaths[index]}>
                  {thumbnails[index] && <img src={thumbnails[index]!} alt={`第 ${label} 张`} />}
                  <span>{label}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="panorama-lab-empty">
              <span><FolderOpen size={24} /></span>
              <strong>暂无照片</strong>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
