import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Box,
  CalendarDays,
  Camera,
  Clock3,
  CloudOff,
  Film,
  FolderSync,
  FolderDown,
  Link2,
  RadioTower,
  RefreshCw,
  WandSparkles,
} from 'lucide-react'

import type {
  DirectorLabDiscoveredService,
  DirectorLabDownloadProgress,
  DirectorLabMediaMetadata,
  DirectorLanPlanSummary,
  DirectorLanPlansResponse,
  DirectorLanTake,
} from '../shared/types'
import { Button, IconButton, Input, LoadingIndicator, Tooltip, toast } from '../ui'
import { formatBytes } from '../lib/format'
import { DirectorMediaPreviewDialog } from './DirectorMediaPreviewDialog'

interface DirectorLabViewProps {
  onBack: () => void
}

const ENDPOINT_STORAGE_KEY = 'luna.director-lab.endpoint'

function normalizeEndpoint(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) throw new Error('请输入手机地址')
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  const url = new URL(withScheme)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('仅支持 HTTP 地址')
  if (!url.port) url.port = '47821'
  url.pathname = ''
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

async function requestPlans(endpoint: string): Promise<DirectorLanPlansResponse> {
  const response = await fetch(`${endpoint}/api/v1/director/plans`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`连接失败：HTTP ${response.status}`)
  const payload = await response.json() as DirectorLanPlansResponse
  if (payload.service !== 'luna-ka-director' || !Array.isArray(payload.plans)) {
    throw new Error('手机返回的数据格式不兼容')
  }
  return normalizePlanUrls(payload, endpoint)
}

function normalizeServiceUrl(endpoint: string, value: string | null): string | null {
  if (!value) return null
  try {
    const target = new URL(endpoint)
    const resolved = new URL(value, target)
    // Older phone builds omitted the HTTP port in absolute URLs. Keep the
    // actual connected origin so playback and downloads never fall back to :80.
    resolved.protocol = target.protocol
    resolved.hostname = target.hostname
    resolved.port = target.port
    return resolved.toString()
  } catch {
    return value
  }
}

function normalizePlanUrls(
  payload: DirectorLanPlansResponse,
  endpoint: string,
): DirectorLanPlansResponse {
  return {
    ...payload,
    plans: payload.plans
      .map((plan) => ({
        ...plan,
        source: 'remote' as const,
        archive_url: normalizeServiceUrl(endpoint, plan.archive_url) ?? plan.archive_url,
        shots: plan.shots.map((shot) => ({
          ...shot,
          takes: shot.takes.map((take) => ({
            ...take,
            stream_url: normalizeServiceUrl(endpoint, take.stream_url),
            download_url: normalizeServiceUrl(endpoint, take.download_url),
          })),
        })),
      }))
      .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at)),
  }
}

function takeLabel(take: DirectorLanTake, index: number): string {
  return `${take.kind === 'photo' ? '照片' : '视频'} ${String(index + 1).padStart(2, '0')}`
}

function formatDurationMs(value: number | null | undefined): string {
  if (!value || value <= 0) return '—'
  const totalSeconds = Math.round(value / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatMediaTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function formatPlanCreatedAt(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function earliestDate(values: Array<string | null | undefined>): string | null {
  const timestamps = values
    .map((value) => value ? Date.parse(value) : Number.NaN)
    .filter((value) => Number.isFinite(value))
  if (timestamps.length === 0) return null
  return new Date(Math.min(...timestamps)).toISOString()
}

function shotMetadata(
  shot: DirectorLanPlanSummary['shots'][number],
  metadata: Record<string, DirectorLabMediaMetadata>,
) {
  const metadataForTakes = shot.takes.map((take) => metadata[take.id]).filter(Boolean)
  const durationMs = metadataForTakes.reduce((total, item) => total + (item.durationMs ?? 0), 0)
  const resolution = metadataForTakes.find((item) => item.width && item.height)
  return {
    createdAt: earliestDate(shot.takes.map((take) => take.created_at)),
    capturedAt: earliestDate(metadataForTakes.map((item) => item.capturedAt)),
    durationMs: durationMs > 0 ? durationMs : null,
    resolution: resolution?.width && resolution.height
      ? `${resolution.width}×${resolution.height}`
      : null,
    metadataPending: shot.takes.some(
      (take) => take.kind === 'video' && take.available && !metadata[take.id],
    ),
  }
}

function buildAiPrompt(
  plan: DirectorLanPlanSummary,
  endpoint: string | null,
): string {
  const remote = plan.source === 'remote' ? plan : plan.remote_plan
  const lines = [
    '你是处理 Luna咔导演计划素材的 AI。',
    '',
    `当前计划：${plan.title}`,
    `计划 ID：${plan.id}`,
    `创建时间：${plan.created_at}`,
    `更新时间：${plan.updated_at}`,
    '',
    '任务：读取完整导演计划、镜头/素材元数据和媒体文件，按 shot 和 take 组织处理。不要修改原素材。',
    '',
  ]
  if (plan.local_directory) {
    lines.push(
      '本地素材目录：',
      plan.local_directory,
      '',
      '本地读取方式：',
      `1. 读取 ${plan.local_directory}/manifest.json，获得 shots、takes、selected_range。`,
      `2. 读取 ${plan.local_directory}/README.md，获得镜头说明。`,
      '3. manifest 中每个 media.path 是相对计划目录的媒体路径。',
      '4. 直接读取这些本地视频/图片文件；selected_range 仅表示选取区间，不要裁剪原文件。',
      '',
    )
  }
  if (remote && endpoint) {
    lines.push(
      `手机服务地址：${endpoint}`,
      '远程读取方式：',
      `1. GET ${endpoint}/api/v1/director/plans`,
      `2. GET ${endpoint}/api/v1/director/plans/${encodeURIComponent(remote.id)}`,
      '3. 使用计划中的 shots[].takes[]，每条 take 包含 stream_url、download_url、selected_range。',
      '4. stream_url 用于读取/播放，download_url 用于下载原文件；请求支持 HTTP Range。',
      '5. 需要整包时 GET archive_url；需要更新本地副本时，重新下载 active plan 并覆盖本地目录。',
      '',
    )
  } else if (!plan.local_directory) {
    lines.push(
      '当前没有可用的本地目录数据。请先连接手机并下载计划，或指定已下载的导演计划目录。',
      '',
    )
  }
  lines.push(
    '输出要求：',
    '- 保持镜头顺序和 take 顺序。',
    '- 引用素材时同时给出 shot.name、take.id、本地路径或远程 download_url。',
    '- selected_range.start_ms/end_ms 是原视频时间轴范围，单位为毫秒。',
  )
  return lines.join('\n')
}

export function DirectorLabView({ onBack }: DirectorLabViewProps) {
  const [endpoint, setEndpoint] = useState(() => localStorage.getItem(ENDPOINT_STORAGE_KEY) ?? '')
  const [connectedEndpoint, setConnectedEndpoint] = useState<string | null>(null)
  const [plans, setPlans] = useState<DirectorLanPlanSummary[]>([])
  const [activePlanId, setActivePlanId] = useState<string | null>(null)
  const [activeTakeId, setActiveTakeId] = useState<string | null>(null)
  const [previewTakeId, setPreviewTakeId] = useState<string | null>(null)
  const [discovered, setDiscovered] = useState<DirectorLabDiscoveredService[]>([])
  const [discovering, setDiscovering] = useState(false)
  const [scanSummary, setScanSummary] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<DirectorLabDownloadProgress | null>(null)
  const [mediaMetadata, setMediaMetadata] = useState<Record<string, DirectorLabMediaMetadata>>({})
  const [metadataLoading, setMetadataLoading] = useState(false)
  const metadataRequestRef = useRef(0)

  const activePlan = useMemo(
    () => plans.find((plan) => plan.id === activePlanId) ?? plans[0] ?? null,
    [activePlanId, plans],
  )
  const takes = useMemo(
    () => activePlan?.shots.flatMap((shot) => shot.takes) ?? [],
    [activePlan],
  )
  const activeTake = useMemo(
    () => takes.find((take) => take.id === activeTakeId) ?? takes[0] ?? null,
    [activeTakeId, takes],
  )
  const previewTake = useMemo(
    () => takes.find((take) => take.id === previewTakeId) ?? null,
    [previewTakeId, takes],
  )

  const mergePlans = useCallback((remotePlans: DirectorLanPlanSummary[]): void => {
    setPlans((current) => {
      const remoteById = new Map(remotePlans.map((plan) => [plan.id, plan]))
      const local = current
        .filter((plan) => plan.source === 'local')
        .map((plan) => {
          const remote = remoteById.get(plan.id)
          return remote
            ? {
                ...plan,
                remote_plan: remote,
                update_available: Date.parse(remote.updated_at) > Date.parse(plan.updated_at),
              }
            : plan
        })
      const localIds = new Set(local.map((plan) => plan.id))
      return [
        ...local,
        ...remotePlans.filter((plan) => !localIds.has(plan.id)),
      ].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
    })
  }, [])

  useEffect(() => window.luna.directorLab.onDownloadProgress(setDownloadProgress), [])

  const refreshLocalPlans = useCallback(async (): Promise<DirectorLanPlanSummary[]> => {
    try {
      const next = await window.luna.directorLab.listLocalPlans()
      return next
    } catch {
      return []
    }
  }, [])

  useEffect(() => {
    setActiveTakeId((current) => {
      if (current && takes.some((take) => take.id === current)) return current
      return takes[0]?.id ?? null
    })
  }, [takes])

  useEffect(() => {
    if (!activePlan) {
      setMediaMetadata({})
      setMetadataLoading(false)
      return
    }
    const requests = activePlan.shots
      .flatMap((shot) => shot.takes)
      .filter((take) => take.kind === 'video' && take.available && take.stream_url)
      .map((take) => ({ takeId: take.id, url: take.stream_url! }))
    metadataRequestRef.current += 1
    const requestId = metadataRequestRef.current
    if (requests.length === 0) {
      setMetadataLoading(false)
      return
    }
    setMetadataLoading(true)
    void window.luna.directorLab.probeMedia(requests)
      .then((results) => {
        if (metadataRequestRef.current !== requestId) return
        setMediaMetadata((current) => {
          const next = { ...current }
          for (const result of results) next[result.takeId] = result
          return next
        })
      })
      .catch(() => undefined)
      .finally(() => {
        if (metadataRequestRef.current === requestId) setMetadataLoading(false)
      })
  }, [activePlan])

  useEffect(() => {
    if (!connectedEndpoint || !activePlan) return
    let disposed = false
    const heartbeatUrl = `${connectedEndpoint}/api/v1/director/keepalive`
    const send = (active: boolean): void => {
      if (disposed && active) return
      void fetch(`${heartbeatUrl}?active=${active ? '1' : '0'}`, {
        cache: 'no-store',
      }).catch(() => undefined)
    }
    send(true)
    const timer = window.setInterval(() => send(true), 15_000)
    return () => {
      disposed = true
      window.clearInterval(timer)
      send(false)
    }
  }, [activePlan, connectedEndpoint])

  const loadPlans = useCallback(async (value: string, notify = true): Promise<boolean> => {
    let normalized: string
    try {
      normalized = normalizeEndpoint(value)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
      return false
    }

    setLoading(true)
    setError(null)
    try {
      const payload = await requestPlans(normalized)
      mergePlans(payload.plans)
      setConnectedEndpoint(normalized)
      setEndpoint(normalized)
      setActivePlanId((current) => payload.plans.some((plan) => plan.id === current)
        ? current
        : payload.plans[0]?.id ?? null)
      localStorage.setItem(ENDPOINT_STORAGE_KEY, normalized)
      if (notify) toast.success(`已连接，发现 ${payload.plans.length} 个导演计划`)
      return true
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError)
      setConnectedEndpoint(null)
      setError(message)
      if (notify) toast.error(message)
      return false
    } finally {
      setLoading(false)
    }
  }, [mergePlans])

  const discover = useCallback(async (notify = true): Promise<void> => {
    setDiscovering(true)
    setError(null)
    setScanSummary(null)
    try {
      const result = await window.luna.directorLab.discover()
      setDiscovered(result.services)
      if (result.udpResponderCount > 0) {
        setScanSummary(`UDP 发现 ${result.udpResponderCount} 台设备`)
      } else if (result.scannedHostCount > 0) {
        setScanSummary(`已扫描 ${result.scannedHostCount} 个地址`)
      }
      if (result.services.length === 1) {
        await loadPlans(result.services[0].baseUrl, false)
        if (notify) toast.success(`已发现 ${result.services[0].name}`)
      } else if (result.services.length === 0 && notify) {
        toast.error('没有发现运行导演服务的手机')
      }
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError)
      setError(message)
      if (notify) toast.error(message)
    } finally {
      setDiscovering(false)
    }
  }, [loadPlans])

  useEffect(() => {
    void refreshLocalPlans().then((local) => {
      if (local.length > 0) {
        setPlans(local)
        setActivePlanId((current) => current ?? local[0]?.id ?? null)
      }
      const saved = localStorage.getItem(ENDPOINT_STORAGE_KEY)
      if (saved) {
        void loadPlans(saved, false).then((connected) => {
          if (!connected && local.length === 0) void discover(false)
        })
      } else if (local.length === 0) {
        void discover(false)
      }
    })
  }, [discover, loadPlans, refreshLocalPlans])

  async function download(
    key: string,
    url: string | null,
    fileName: string,
    planTitle: string,
    context?: { shotOrder: number; shotName: string; takeIndex: number },
  ): Promise<void> {
    if (!url) {
      toast.error('素材文件不可用')
      return
    }
    setDownloading(key)
    const operationId = `${key}-${Date.now()}`
    try {
      const result = await window.luna.directorLab.download({
        operationId,
        url,
        fileName,
        planTitle,
        ...context,
      })
      toast.success(`已保存 ${result.fileName}`)
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setDownloading(null)
    }
  }

  async function downloadPlan(plan: DirectorLanPlanSummary): Promise<void> {
    const operationId = `plan:${plan.id}:${Date.now()}`
    setDownloading(`plan:${plan.id}`)
    try {
      const result = await window.luna.directorLab.downloadPlan({ plan, operationId })
      toast.success(`已保存 ${result.fileCount} 个原素材到文件夹`)
      const local = await refreshLocalPlans()
      setPlans((current) => {
        const localIds = new Set(local.map((item) => item.id))
        return [
          ...local,
          ...current.filter((item) => item.source === 'remote' && !localIds.has(item.id)),
        ]
      })
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setDownloading(null)
    }
  }

  async function copyAiPrompt(): Promise<void> {
    if (!activePlan) return
    try {
      await window.luna.copyText(buildAiPrompt(activePlan, connectedEndpoint))
      toast.success('已复制完整 AI 提示词')
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : '复制失败')
    }
  }

  return (
    <div className="lab-page">
      <header className="lab-header">
        <div className="lab-title-block">
          <Button
            variant="ghost"
            size="compact"
            icon={<ArrowLeft size={15} />}
            onClick={onBack}
          >
            实验室
          </Button>
          <h1>导演计划</h1>
        </div>
        <div className="lab-connection">
          <Button
            variant="primary"
            size="compact"
            icon={<RadioTower size={15} />}
            disabled={discovering}
            onClick={() => void discover()}
          >
            {discovering ? '扫描中' : '自动发现'}
          </Button>
          <Input
            aria-label="手机地址"
            variant="compact"
            icon={<Link2 size={15} />}
            fullWidth
            value={endpoint}
            placeholder="也可输入 192.168.1.20:47821"
            onChange={(event) => setEndpoint(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void loadPlans(endpoint)
            }}
          />
          <Button
            variant="secondary"
            size="compact"
            disabled={loading}
            onClick={() => void loadPlans(endpoint)}
          >
            {loading ? '连接中' : '连接'}
          </Button>
          {connectedEndpoint && (
            <Tooltip content="刷新导演计划">
              <IconButton
                variant="outline"
                size="compact"
                icon={<RefreshCw size={15} />}
                aria-label="刷新导演计划"
                disabled={loading}
                onClick={() => void loadPlans(connectedEndpoint, false)}
              />
            </Tooltip>
          )}
        </div>
      </header>

      {(discovering || discovered.length > 1 || scanSummary) && !connectedEndpoint && (
        <section className="lab-discovery">
          <div className="lab-discovery-heading">
            <span className="lab-eyebrow">DEVICES</span>
            <strong>{discovering ? '正在查找手机' : scanSummary ?? '发现的设备'}</strong>
          </div>
          {discovering ? (
            <LoadingIndicator label="UDP 广播优先，失败后将扫描本机网段" />
          ) : discovered.length > 0 ? (
            <div className="lab-device-list">
              {discovered.map((service) => (
                <button
                  key={service.id}
                  className="lab-device-item"
                  type="button"
                  onClick={() => void loadPlans(service.baseUrl)}
                >
                  <span className="lab-device-icon"><RadioTower size={17} /></span>
                  <span>
                    <strong>{service.name}</strong>
                    <small>{service.host}:{service.port} · {service.discoveryMethod === 'udp' ? 'UDP' : '网段扫描'}</small>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      )}

      {!connectedEndpoint && !discovering && plans.length === 0 && (
        <div className="lab-empty">
          {error ? <CloudOff size={24} /> : <RadioTower size={24} />}
          <strong>{error ? '无法连接手机' : '等待连接手机'}</strong>
          <span>{error ?? '点击自动发现，或手动输入手机局域网地址'}</span>
        </div>
      )}

      {connectedEndpoint && loading && plans.length === 0 && (
        <div className="lab-empty">
          <LoadingIndicator label="正在读取导演计划" />
        </div>
      )}

      {connectedEndpoint && !loading && plans.length === 0 && (
        <div className="lab-empty">
          <Box size={24} />
          <strong>还没有导演计划</strong>
          <span>在手机端创建并拍摄后刷新</span>
        </div>
      )}

      {activePlan && (
        <>
          <div className="lab-director-heading">
            <div>
              <span className="lab-eyebrow">PLANS</span>
              <h2>{activePlan.title}</h2>
              <small className="lab-plan-created">
                创建于 {formatPlanCreatedAt(activePlan.created_at)} · 更新于 {formatPlanCreatedAt(activePlan.updated_at)}
              </small>
            </div>
            <div className="lab-director-actions">
              <span className="lab-plan-summary">
                {activePlan.shot_count} 个镜头 · {activePlan.take_count} 段素材
              </span>
              <Button
                variant="secondary"
                size="compact"
                icon={<FolderDown size={15} />}
                disabled={downloading != null || (activePlan.source === 'local' && !activePlan.update_available)}
                onClick={() => void downloadPlan(activePlan.remote_plan ?? activePlan)}
              >
                {activePlan.source === 'local' && activePlan.update_available
                  ? '更新本地版本'
                  : activePlan.source === 'local'
                    ? '已保存到本地'
                  : downloading === `plan:${activePlan.id}`
                    ? '下载中'
                    : '下载到文件夹'}
              </Button>
              <Button
                variant="secondary"
                size="compact"
                icon={<WandSparkles size={15} />}
                onClick={() => void copyAiPrompt()}
              >
                AI 提示词
              </Button>
              {activePlan.update_available && (
                <span className="lab-update-badge">
                  <FolderSync size={13} /> 手机上有新版本
                </span>
              )}
            </div>
          </div>
          {downloadProgress && (downloadProgress.phase !== 'done' || downloading != null) && (
            <div className="lab-download-progress">
              <span>{downloadProgress.currentFile ?? '正在准备素材'}</span>
              <strong>{downloadProgress.percent}%</strong>
              <div><i style={{ width: `${downloadProgress.percent}%` }} /></div>
            </div>
          )}
          <div className="lab-director-body">
            <aside className="lab-plan-list">
              {plans.map((plan) => {
                const progress = plan.shot_count > 0
                  ? Math.round(plan.completed_shot_count / plan.shot_count * 100)
                  : 0
                return (
                  <button
                    key={plan.id}
                    className={`lab-plan-item${plan.id === activePlan.id ? ' active' : ''}`}
                    type="button"
                    onClick={() => setActivePlanId(plan.id)}
                  >
                    <span className="lab-plan-item-icon"><Film size={17} /></span>
                    <span className="lab-plan-item-copy">
                      <strong>{plan.title}</strong>
                      <small>
                        {plan.source === 'local' ? '本地' : '手机'} · {formatPlanCreatedAt(plan.created_at)} · {plan.shot_count} 镜头 · {plan.take_count} 素材
                      </small>
                      {plan.update_available && <em>有更新</em>}
                    </span>
                    <span className="lab-plan-progress">{progress}%</span>
                  </button>
                )
              })}
            </aside>

            <div className="lab-shot-board">
              {activePlan.shots.map((shot) => {
                const stats = shotMetadata(shot, mediaMetadata)
                return (
                  <section className="lab-shot" key={shot.id}>
                    <header>
                      <span>{String(shot.order).padStart(2, '0')}</span>
                      <div>
                        <strong>{shot.name}</strong>
                        <small>计划 {(shot.duration_ms / 1000).toFixed(1)} 秒 · {shot.takes.length} 段素材</small>
                      </div>
                    </header>
                    <div className="lab-shot-stats">
                      <span>
                        <CalendarDays size={13} />
                        创建 {formatMediaTime(stats.createdAt)}
                      </span>
                      <span>
                        <Camera size={13} />
                        拍摄 {formatMediaTime(stats.capturedAt)}
                      </span>
                      <span>
                        <Clock3 size={13} />
                        时长 {stats.metadataPending && metadataLoading
                          ? '读取中'
                          : formatDurationMs(stats.durationMs)}
                      </span>
                      {stats.resolution && <span className="lab-shot-resolution">{stats.resolution}</span>}
                    </div>
                    {shot.visual_description && <p>{shot.visual_description}</p>}
                    {shot.takes.length > 0 ? (
                      <div className="lab-take-grid">
                        {shot.takes.map((take, index) => {
                          const takeMetadata = mediaMetadata[take.id]
                          return (
                            <button
                              className={`lab-take-card${take.id === activeTake?.id ? ' active' : ''}`}
                              type="button"
                              key={take.id}
                              onClick={() => {
                                setActiveTakeId(take.id)
                                setPreviewTakeId(take.id)
                              }}
                            >
                              <span className="lab-take-media">
                                {take.available && take.stream_url ? (
                                  take.kind === 'video' ? (
                                    <video src={take.stream_url} muted preload="metadata" />
                                  ) : (
                                    <img src={take.stream_url} alt="" loading="lazy" />
                                  )
                                ) : (
                                  <CloudOff size={20} />
                                )}
                              </span>
                              <span className="lab-take-copy">
                                <strong>{takeLabel(take, index)}</strong>
                                <small>
                                  {take.kind === 'video'
                                    ? formatDurationMs(takeMetadata?.durationMs)
                                    : '照片'}
                                  {' · '}
                                  {take.size_bytes ? formatBytes(take.size_bytes) : '文件缺失'}
                                </small>
                                <small>
                                  {takeMetadata?.capturedAt
                                    ? `拍摄 ${formatMediaTime(takeMetadata.capturedAt)}`
                                    : `创建 ${formatMediaTime(take.created_at)}`}
                                </small>
                              </span>
                              <span className="lab-take-open">查看</span>
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="lab-shot-empty">暂无素材</div>
                    )}
                  </section>
                )
              })}
            </div>

          </div>
        </>
      )}
      {previewTake && activePlan && (
        <DirectorMediaPreviewDialog
          take={previewTake}
          takes={takes}
          planTitle={activePlan.title}
          downloading={downloading === `take:${previewTake.id}`}
          downloadProgress={downloadProgress}
          onSelectTake={(take) => {
            setActiveTakeId(take.id)
            setPreviewTakeId(take.id)
          }}
          onDownload={(take) => {
            const shotIndex = activePlan.shots.findIndex((shot) =>
              shot.takes.some((item) => item.id === take.id))
            const shot = activePlan.shots[shotIndex]
            const takeIndex = shot?.takes.findIndex((item) => item.id === take.id) ?? -1
            void download(
              `take:${take.id}`,
              take.download_url,
              take.file_name,
              activePlan.title,
              {
                shotOrder: shot?.order ?? shotIndex + 1,
                shotName: shot?.name ?? 'shot',
                takeIndex: takeIndex + 1,
              },
            )
          }}
          onClose={() => setPreviewTakeId(null)}
        />
      )}
    </div>
  )
}
