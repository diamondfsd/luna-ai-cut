import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Clock3, FolderOpen, LoaderCircle, RefreshCw, ScanLine } from 'lucide-react'

import { useApp } from '../context/AppContext'
import { useDeviceConnection } from '../context/DeviceConnectionContext'
import { MODE_ROWS, PANORAMA_LAYOUTS, poseForGridIndex, rowMajorFromCaptureOrder, type LayoutId } from '../lib/panoramaStitchingLayout'
import type { PanoramaDownloadProgress as DownloadProgress, PanoramaLocalDownloadStatus } from '../shared/types'
import { PanoramaDownloadProgress as PanoramaDownloadProgressView } from './PanoramaDownloadProgress'
import { PanoramaPhoneRecordList, type PhonePanoramaRecord } from './PanoramaPhoneRecordList'
import { Button, Select } from '../ui'
import '../styles/panorama-stitching-lab.css'

type OutputWidth = 16000 | 24000 | 32000
type ViewState = 'empty' | 'loading' | 'ready' | 'stitching' | 'complete' | 'error'

interface PanoramaStitchingLabViewProps {
  active: boolean
  onBack: () => void
}

interface PanoramaResult {
  path: string
  width: number
  height: number
}

function messageForState(state: ViewState, error: string | null, loadingMessage: string): string {
  if (error) return error
  if (state === 'loading') return loadingMessage
  if (state === 'stitching') return '正在合成全景图'
  if (state === 'complete') return '合成完成'
  return ''
}

export function PanoramaStitchingLabView({ active, onBack }: PanoramaStitchingLabViewProps) {
  const navigate = useNavigate()
  const { settings } = useApp()
  const { activeDevice, isConnected, sourceMode } = useDeviceConnection()
  const [state, setState] = useState<ViewState>('empty')
  const [layoutId, setLayoutId] = useState<LayoutId>('36-visual')
  const [targetWidth, setTargetWidth] = useState<OutputWidth>(24000)
  const [gridPaths, setGridPaths] = useState<string[]>([])
  const [thumbnails, setThumbnails] = useState<Array<string | null>>([])
  const [result, setResult] = useState<PanoramaResult | null>(null)
  const [resultThumbnail, setResultThumbnail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [phoneEndpoint, setPhoneEndpoint] = useState<string | null>(null)
  const [phoneRecords, setPhoneRecords] = useState<PhonePanoramaRecord[]>([])
  const [selectedPhoneRecord, setSelectedPhoneRecord] = useState<PhonePanoramaRecord | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null)
  const [recordMode, setRecordMode] = useState<string | null>(null)
  const [recordPoses, setRecordPoses] = useState<number[][] | null>(null)
  const [loadingMessage, setLoadingMessage] = useState('正在读取照片')
  const [stitchElapsedSeconds, setStitchElapsedSeconds] = useState(0)
  const busy = state === 'loading' || state === 'stitching'
  const { rows, columns, photoCount, pitchTop, pitchStep, pitchBottom, zenith } = PANORAMA_LAYOUTS[layoutId]
  const requiresPhoneRecord = layoutId === '22'
    || layoutId === '24-rings'
    || layoutId === '25'
    || layoutId === '27-rings'
    || layoutId === '32-rings'
    || layoutId === '35-rings'
    || layoutId === '36-visual'
  const supportedCamera = activeDevice?.protocol === 'insta360'
  const statusMessage = state === 'loading' && downloadProgress
    ? ''
    : messageForState(state, error, loadingMessage)

  useEffect(() => window.luna.onPanoramaDownloadProgress((progress) => {
    setDownloadProgress((current) => current?.recordId === progress.recordId ? progress : current)
  }), [])

  useEffect(() => {
    if (state !== 'stitching') return
    const startedAt = Date.now()
    setStitchElapsedSeconds(0)
    const timer = window.setInterval(() => {
      setStitchElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [state])

  const changeLayout = useCallback((value: string) => {
    if (!Object.keys(PANORAMA_LAYOUTS).includes(value)) return
    setLayoutId(value as LayoutId)
    setState('empty')
    setGridPaths([])
    setRecordMode(null)
    setRecordPoses(null)
    setThumbnails([])
    setResult(null)
    setResultThumbnail(null)
    setError(null)
    setSelectedPhoneRecord(null)
    setDownloadProgress(null)
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
    setLoadingMessage('正在读取手机记录')
    setState('loading')
    setError(null)
    setDownloadProgress(null)
    setPhoneEndpoint(null)
    setPhoneRecords([])
    setSelectedPhoneRecord(null)
    try {
      const saved = localStorage.getItem('luna.director-lab.endpoint')
      const discovered = await window.luna.directorLab.discover()
      const endpoints = [...new Set([saved, ...discovered.services.map((service) => service.baseUrl)].filter((item): item is string => Boolean(item)))]
      let lastError: unknown
      for (const endpoint of endpoints) {
        try {
          const result = await window.luna.lunaKaHttpClient.request<{ service: string; records: PhonePanoramaRecord[] }>(endpoint, '/api/v1/panorama/records')
          if (result.service !== 'luna-ka-panorama' || !Array.isArray(result.records)) {
            lastError = new Error('该手机版本暂不支持全景记录')
            continue
          }
          const supportedRecords = result.records.filter((record) =>
            record.photos.length === 19 || record.photos.length === 22 || record.photos.length === 24 || record.photos.length === 25 || record.photos.length === 27 || record.photos.length === 32 || record.photos.length === 35 || record.photos.length === 36,
          )
          const localStatuses = await window.luna.getPanoramaDownloadStatuses(
            supportedRecords.map((record) => ({ recordId: record.id, photoCount: record.photos.length })),
          ).catch((): PanoramaLocalDownloadStatus[] => [])
          const statusByRecordId = new Map(localStatuses.map((status) => [status.recordId, status]))
          const records = [...supportedRecords]
            .sort((left, right) => Date.parse(right.started_at) - Date.parse(left.started_at))
            .map((record) => {
              const local = statusByRecordId.get(record.id)
              return {
                ...record,
                localDownloadState: local?.state ?? 'not-downloaded',
                localDownloadedPhotos: local?.downloadedPhotos ?? 0,
              }
            })
          setPhoneEndpoint(endpoint)
          setPhoneRecords(records)
          setState('empty')
          if (records.length === 0) setError('手机上没有可合成的全景记录')
          return
        } catch (cause) {
          lastError = cause
        }
      }
      if (lastError instanceof Error) throw lastError
      throw new Error('未找到已连接的手机，请确认手机与电脑在同一局域网')
    } catch (cause) {
      setState('error')
      setError(cause instanceof Error ? cause.message : '读取手机拍摄记录失败')
    }
  }, [])

  useEffect(() => {
    if (active) void loadPhoneRecords()
  }, [active, loadPhoneRecords])

  const loadPhoneRecord = useCallback(async (record: PhonePanoramaRecord) => {
    if (!phoneEndpoint) return
    setSelectedPhoneRecord(record)
    const alreadyDownloaded = record.localDownloadState === 'downloaded'
    setLoadingMessage(alreadyDownloaded ? '正在打开已下载记录' : '正在下载拍摄照片')
    setState('loading')
    setError(null)
    setGridPaths([])
    setThumbnails([])
    setRecordMode(null)
    setRecordPoses(null)
    setResult(null)
    setResultThumbnail(null)
    setDownloadProgress(alreadyDownloaded ? null : {
      recordId: record.id,
      slot: 0,
      totalPhotos: record.photos.length,
      completedPhotos: 0,
      downloaded: 0,
      total: null,
      percent: null,
      status: 'starting',
    })
    try {
      let localRecord: Awaited<ReturnType<typeof window.luna.loadLocalPanoramaRecord>>
      if (alreadyDownloaded) {
        try {
          localRecord = await window.luna.loadLocalPanoramaRecord(record.id, record.photos.length)
        } catch {
          setLoadingMessage('本地照片不完整，正在重新下载')
          setDownloadProgress({
            recordId: record.id,
            slot: 0,
            totalPhotos: record.photos.length,
            completedPhotos: 0,
            downloaded: 0,
            total: null,
            percent: null,
            status: 'starting',
          })
          localRecord = await window.luna.downloadPhonePanoramaRecord(phoneEndpoint, record.id)
        }
      } else {
        localRecord = await window.luna.downloadPhonePanoramaRecord(phoneEndpoint, record.id)
      }
      const { paths, mode, poses } = localRecord
      if (paths.length !== 19 && paths.length !== 22 && paths.length !== 24 && paths.length !== 25 && paths.length !== 27 && paths.length !== 32 && paths.length !== 35 && paths.length !== 36) throw new Error('拍摄记录不完整')
      const [localStatus] = await window.luna.getPanoramaDownloadStatuses([
        { recordId: record.id, photoCount: paths.length },
      ])
      if (localStatus) {
        setPhoneRecords((records) => records.map((item) => item.id === record.id
          ? { ...item, localDownloadState: localStatus.state, localDownloadedPhotos: localStatus.downloadedPhotos }
          : item))
        setSelectedPhoneRecord({
          ...record,
          localDownloadState: localStatus.state,
          localDownloadedPhotos: localStatus.downloadedPhotos,
        })
      }
      const modeLayout: Partial<Record<string, LayoutId>> = {
        rings_788_plus_zenith: '24-rings',
        rings_887_plus_zenith: '24-rings',
        sphere_887_manual3_zenith_v2: '27-rings',
        sphere_visual_8888_manual3_top_v1: '36-visual',
        sphere_9x10x9_manual3_zenith_v1: '32-rings',
        sphere_10x11x10_manual3_zenith_v1: '35-rings',
      }
      setLayoutId(modeLayout[mode ?? ''] ?? String(paths.length) as LayoutId)
      setRecordMode(mode)
      setRecordPoses(poses?.map((pose) => [pose.yaw, pose.pitch, pose.roll]) ?? null)
      setGridPaths(paths)
      setThumbnails(await Promise.all(paths.map((path) => window.luna.resolveThumbnail(path, 'image').catch(() => null))))
      setResult(null)
      setResultThumbnail(null)
      setState('ready')
    } catch (cause) {
      const cancelled = cause instanceof Error && cause.message.includes('取消')
      const failure = cause instanceof Error ? cause.message : '下载拍摄记录失败'
      const [localStatus] = await window.luna.getPanoramaDownloadStatuses([
        { recordId: record.id, photoCount: record.photos.length },
      ]).catch((): PanoramaLocalDownloadStatus[] => [])
      if (localStatus) {
        setPhoneRecords((records) => records.map((item) => item.id === record.id
          ? { ...item, localDownloadState: localStatus.state, localDownloadedPhotos: localStatus.downloadedPhotos }
          : item))
        setSelectedPhoneRecord({
          ...record,
          localDownloadState: localStatus.state,
          localDownloadedPhotos: localStatus.downloadedPhotos,
        })
      }
      setState(cancelled ? 'empty' : 'error')
      setError(null)
      setDownloadProgress((current) => {
        if (current?.recordId !== record.id) return current
        if (cancelled && current.status === 'cancelled') return current
        return {
          ...current,
          status: cancelled ? 'cancelled' : 'failed',
          error: cancelled ? undefined : failure.replace(/^第 \d+ 张下载失败：/, ''),
        }
      })
    }
  }, [phoneEndpoint])

  const cancelPhoneRecordDownload = useCallback(async () => {
    if (selectedPhoneRecord) await window.luna.cancelPanoramaDownload(selectedPhoneRecord.id)
  }, [selectedPhoneRecord])

  const loadRecentCameraPhotos = useCallback(async () => {
    if (!isConnected || !settings || !supportedCamera) return
    setLoadingMessage('正在读取相机照片')
    setState('loading')
    setError(null)
    setDownloadProgress(null)
    setSelectedPhoneRecord(null)
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
    setLoadingMessage('正在读取本地照片')
    setState('loading')
    setError(null)
    setDownloadProgress(null)
    setSelectedPhoneRecord(null)
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
    if (requiresPhoneRecord && !recordMode) {
      setError('该拍摄方案请通过手机拍摄记录导入')
      setState('error')
      return
    }
    setStitchElapsedSeconds(0)
    setState('stitching')
    setError(null)
    try {
      const panorama = await window.luna.stitchPanorama({
        paths: gridPaths,
        poses: recordPoses ?? gridPaths.map((_, index) =>
          poseForGridIndex(index, rows, columns, pitchTop, pitchStep, pitchBottom, zenith),
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
      setState('ready')
      setError(cause instanceof Error && cause.message ? `合成失败：${cause.message}` : '合成失败，请检查照片后重试')
    }
  }, [columns, gridPaths, photoCount, pitchBottom, pitchStep, pitchTop, recordMode, recordPoses, requiresPhoneRecord, rows, targetWidth, zenith])

  const recordRows = recordMode ? MODE_ROWS[recordMode] : undefined
  const formattedStitchTime = `${Math.floor(stitchElapsedSeconds / 60)}:${String(stitchElapsedSeconds % 60).padStart(2, '0')}`
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
              { value: '19', label: '19 张 · 三层 + 天顶' },
              { value: '22', label: '22 张 · 6 / 7 / 8 + 天顶' },
              { value: '24', label: '24 张 · 4 × 6' },
              { value: '24-rings', label: '24 张 · 8 / 8 / 7 + 天顶' },
              { value: '25', label: '25 张 · 补拍 3 张 + 7 列 + 天顶' },
              { value: '27-rings', label: '27 张 · 手动 3 + 8 / 8 / 7 + 天顶' },
              { value: '32', label: '32 张 · 4 × 8' },
              { value: '32-rings', label: '32 张 · 手动 3 + 9 / 10 / 9 + 天顶' },
              { value: '35-rings', label: '35 张 · 手动 3 + 10 / 11 / 10 + 天顶' },
              { value: '36-visual', label: '36 张 · 视觉控制 + 顶部' },
            ]}
          />

          <Button variant="secondary" icon={<RefreshCw size={15} />} disabled={busy} onClick={() => void loadPhoneRecords()}>
            读取手机拍摄记录
          </Button>
          <PanoramaPhoneRecordList
            records={phoneRecords}
            selectedRecordId={selectedPhoneRecord?.id ?? null}
            disabled={busy}
            onSelect={(record) => void loadPhoneRecord(record)}
          />
          {downloadProgress && (
            <PanoramaDownloadProgressView
              progress={downloadProgress}
              onCancel={cancelPhoneRecordDownload}
              onRetry={selectedPhoneRecord ? () => void loadPhoneRecord(selectedPhoneRecord) : undefined}
            />
          )}

          {requiresPhoneRecord ? (
            <p className="panorama-lab-path-note">该方案请从手机拍摄记录导入。</p>
          ) : !supportedCamera && isConnected ? (
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
          {!requiresPhoneRecord && <Button
            variant="secondary"
            icon={state === 'loading' ? <LoaderCircle className="is-spinning" size={15} /> : <FolderOpen size={15} />}
            disabled={busy}
            onClick={() => void loadLocalPhotos()}
          >
            选择本地 {photoCount} 张照片
          </Button>}
          {layoutId === '19' && <p className="panorama-lab-path-note">6/7/5 和 5/8/5 方案请从手机拍摄记录导入。</p>}

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
              {error ? '重试合成' : '开始合成'}
            </Button>
          )}
          {state === 'stitching' && (
            <>
              <Button variant="primary" disabled icon={<LoaderCircle className="is-spinning" size={15} />}>
                正在合成
              </Button>
              <div className="panorama-lab-stitch-progress" aria-live="polite">
                <div className="panorama-lab-stitch-progress-heading">
                  <span><LoaderCircle className="is-spinning" size={14} /> 合成中</span>
                  <span><Clock3 size={14} /> {formattedStitchTime}</span>
                </div>
                <div className="panorama-lab-stitch-progress-track" role="progressbar" aria-label="全景合成进度">
                  <span />
                </div>
              </div>
            </>
          )}
          {state === 'complete' && result && (
            <div className="panorama-lab-result-actions">
              <span>{result.width.toLocaleString()} × {result.height.toLocaleString()}</span>
              <Button variant="secondary" icon={<ScanLine size={15} />} onClick={() => void startStitching()}>
                重新合成
              </Button>
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
              <div className="panorama-lab-record-row">{photoTile(photoCount - 1)}</div>
            </div>
          ) : gridPaths.length > 0 ? (
            <div className={`panorama-lab-grid is-${columns}-columns${zenith ? ' is-zenith-layout' : ''}`}>
              {Array.from({ length: photoCount }, (_, index) => index + 1).map((label, index) => (
                <div className={`panorama-lab-photo${zenith && index === photoCount - 1 ? ' is-zenith-photo' : ''}`} key={gridPaths[index]}>
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
