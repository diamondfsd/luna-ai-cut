import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Box,
  FolderSync,
  FolderDown,
  FolderOpen,
  ListFilter,
  Pencil,
  RefreshCw,
  Save,
  Search,
  WandSparkles,
  X,
} from 'lucide-react'

import type {
  DirectorLabDownloadProgress,
  DirectorLabMediaMetadata,
  DirectorLanPlanAttribute,
  DirectorLanPlanSummary,
  DirectorLanPlansResponse,
  DirectorLanShot,
  DirectorLanTake,
} from '../shared/types'
import { Button, IconButton, Input, LoadingIndicator, Select, Tooltip, toast } from '../ui'
import { DirectorMediaPreviewDialog } from './DirectorMediaPreviewDialog'
import { DirectorLabPlanList } from './DirectorLabPlanList'
import { DirectorLabShotList } from './DirectorLabShotList'

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
  const payload = await window.luna.lunaKaHttpClient.request<DirectorLanPlansResponse>(
    endpoint,
    '/api/v1/director/plans',
  )
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
      .map((plan) => normalizeRemotePlan(plan, endpoint))
      .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at)),
  }
}

function normalizePlanAttributeDefinitions(
  plan: DirectorLanPlanSummary,
): DirectorLanPlanAttribute[] {
  const candidate = plan as DirectorLanPlanSummary & { attribute_definitions?: unknown }
  const rawDefinitions = Array.isArray(candidate.attributes)
    ? candidate.attributes
    : Array.isArray(candidate.attribute_definitions)
      ? candidate.attribute_definitions
      : []
  const definitions = rawDefinitions
    .filter((attribute): attribute is { id?: unknown; name: unknown } =>
      !!attribute
      && typeof attribute === 'object'
      && typeof attribute.name === 'string'
      && attribute.name.trim().length > 0)
    .map((attribute, index) => ({
      id: typeof attribute.id === 'string' && attribute.id
        ? attribute.id
        : `${plan.id}-attribute-${index}`,
      name: (attribute.name as string).trim(),
    }))
  if (definitions.length > 0) return definitions

  const firstLegacyShot = plan.shots.find((shot) => Array.isArray(shot.attributes))
  return (firstLegacyShot?.attributes ?? [])
    .filter((attribute) => attribute.name.trim())
    .map((attribute, index) => ({
      id: attribute.id || `${plan.id}-attribute-${index}`,
      name: attribute.name.trim(),
    }))
}

function legacyShotDescriptions(shot: DirectorLanShot): Map<string, string> {
  const descriptions = new Map<string, string>()
  if (Array.isArray(shot.attributes)) {
    for (const attribute of shot.attributes) {
      if (attribute.name?.trim()) {
        descriptions.set(attribute.name.trim(), attribute.description?.trim() ?? '')
        if (attribute.id) descriptions.set(attribute.id, attribute.description?.trim() ?? '')
      }
    }
  }
  const legacy: Array<{ name: string; description?: string }> = [
    { name: '画面说明', description: shot.visual_description },
    { name: '运镜说明', description: shot.movement_description },
  ]
  for (const attribute of legacy) {
    if (attribute.description?.trim() && !descriptions.has(attribute.name)) {
      descriptions.set(attribute.name, attribute.description.trim())
    }
  }
  return descriptions
}

function normalizeRemotePlan(
  plan: DirectorLanPlanSummary,
  endpoint: string,
): DirectorLanPlanSummary {
  const attributes = normalizePlanAttributeDefinitions(plan)
  return {
    ...plan,
    source: 'remote' as const,
    attributes,
    archive_url: normalizeServiceUrl(endpoint, plan.archive_url) ?? plan.archive_url,
    shots: plan.shots.map((shot) => {
      const descriptions = legacyShotDescriptions(shot)
      return {
        ...shot,
        attributes: attributes.map((attribute) => ({
          id: attribute.id,
          name: attribute.name,
          description: descriptions.get(attribute.id) ?? descriptions.get(attribute.name) ?? '',
        })),
        remark: typeof shot.remark === 'string' ? shot.remark : '',
        takes: shot.takes.map((take) => ({
          ...take,
          stream_url: normalizeServiceUrl(endpoint, take.stream_url),
          download_url: normalizeServiceUrl(endpoint, take.download_url),
        })),
      }
    }),
  }
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

function buildAiPrompt(
  plan: DirectorLanPlanSummary,
  endpoint: string | null,
): string {
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
  if (endpoint) {
    lines.push(
      `手机服务地址：${endpoint}`,
      '远程读取方式：',
      `1. GET ${endpoint}/api/v1/director/plans`,
      `2. GET ${endpoint}/api/v1/director/plans/${encodeURIComponent(plan.id)}`,
      '3. 使用计划中的 shots[].takes[]，每条 take 包含 stream_url、download_url、selected_range。',
      '4. stream_url 用于读取/播放，download_url 用于下载原文件；请求支持 HTTP Range。',
      '5. 需要整包时 GET archive_url；需要更新本地副本时，重新下载 active plan 并覆盖本地目录。',
      '6. 服务需要手机端批准设备授权；非 Luna AI Cut 客户端须先 POST /api/v1/auth/authorize，再在 Authorization: Bearer 和 X-Luna-Client-Id 请求头中携带授权信息。',
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
  const [connectedEndpoint, setConnectedEndpoint] = useState<string | null>(null)
  const [plans, setPlans] = useState<DirectorLanPlanSummary[]>([])
  const [activePlanId, setActivePlanId] = useState<string | null>(null)
  const [shotQuery, setShotQuery] = useState('')
  const [shotSort, setShotSort] = useState('order')
  const [editingPlanTitle, setEditingPlanTitle] = useState(false)
  const [planTitleDraft, setPlanTitleDraft] = useState('')
  const [planTitleBaseRevision, setPlanTitleBaseRevision] = useState(0)
  const [savingPlanTitle, setSavingPlanTitle] = useState(false)
  const [previewTakeId, setPreviewTakeId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<DirectorLabDownloadProgress | null>(null)
  const [mediaMetadata, setMediaMetadata] = useState<Record<string, DirectorLabMediaMetadata>>({})
  const [metadataLoading, setMetadataLoading] = useState(false)
  const metadataRequestRef = useRef(0)
  const pendingWritePlanIdsRef = useRef(new Set<string>())

  const activePlan = useMemo(
    () => plans.find((plan) => plan.id === activePlanId) ?? null,
    [activePlanId, plans],
  )
  const takes = useMemo(
    () => activePlan?.shots.flatMap((shot) => shot.takes) ?? [],
    [activePlan],
  )
  const previewTake = useMemo(
    () => takes.find((take) => take.id === previewTakeId) ?? null,
    [previewTakeId, takes],
  )
  const previewShot = useMemo(
    () => activePlan?.shots.find((shot) => shot.takes.some((take) => take.id === previewTakeId)) ?? null,
    [activePlan, previewTakeId],
  )
  const planShotCount = activePlan?.shots.length ?? 0
  const availableShotCount = activePlan?.shots.filter((shot) =>
    shot.takes.some((take) => take.available)).length ?? 0
  const availableTakeCount = takes.filter((take) => take.available).length
  const missingTakeCount = takes.length - availableTakeCount
  const visibleShots = useMemo(() => {
    const query = shotQuery.trim().toLocaleLowerCase()
    const filtered = (activePlan?.shots ?? []).filter((shot) => {
      if (!query) return true
      const values = [
        shot.name,
        ...shot.attributes.flatMap((attribute) => [attribute.name, attribute.description]),
        ...shot.takes.map((take) => take.file_name),
      ]
      return values.some((value) => value.toLocaleLowerCase().includes(query))
    })
    if (shotSort === 'name') {
      return [...filtered].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
    }
    if (shotSort === 'takes') {
      return [...filtered].sort((left, right) => right.takes.length - left.takes.length || left.order - right.order)
    }
    return [...filtered].sort((left, right) => left.order - right.order)
  }, [activePlan, shotQuery, shotSort])

  const mergePlans = useCallback((remotePlans: DirectorLanPlanSummary[]): void => {
    setPlans((current) => {
      const currentById = new Map(current.map((plan) => [plan.id, plan]))
      const localById = new Map(
        current.filter((plan) => plan.source === 'local').map((plan) => [plan.id, plan]),
      )
      const remoteIds = new Set(remotePlans.map((plan) => plan.id))
      const mergedRemote = remotePlans.map((remote) => {
        const local = localById.get(remote.id)
        const previous = currentById.get(remote.id)
        return local
          ? {
              ...remote,
              local_directory: local.local_directory,
              update_available: (remote.revision ?? 0) > (local.revision ?? 0)
                || Date.parse(remote.updated_at) > Date.parse(local.updated_at),
            }
          : previous?.local_directory
            ? {
                ...remote,
                local_directory: previous.local_directory,
                update_available: Boolean(previous.update_available)
                  || (remote.revision ?? 0) > (previous.revision ?? 0),
              }
            : remote
      })
      return [
        ...mergedRemote,
        ...current.filter((plan) => plan.source === 'local' && !remoteIds.has(plan.id)),
      ].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
    })
  }, [])

  const refreshRemotePlans = useCallback(async (): Promise<DirectorLanPlanSummary[]> => {
    if (!connectedEndpoint) return []
    const payload = await requestPlans(connectedEndpoint)
    mergePlans(payload.plans)
    return payload.plans
  }, [connectedEndpoint, mergePlans])

  const setPlanWritePending = useCallback((planId: string, pending: boolean): void => {
    if (pending) pendingWritePlanIdsRef.current.add(planId)
    else pendingWritePlanIdsRef.current.delete(planId)
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

  const mergeLocalPlanCopies = useCallback((local: DirectorLanPlanSummary[]): void => {
    setPlans((current) => {
      const remoteById = new Map(
        current.filter((plan) => plan.source === 'remote').map((plan) => [plan.id, plan]),
      )
      const localIds = new Set(local.map((plan) => plan.id))
      const mergedLocal = local.map((localPlan) => {
        const remote = remoteById.get(localPlan.id)
        return remote
          ? {
              ...remote,
              local_directory: localPlan.local_directory,
              update_available: (remote.revision ?? 0) > (localPlan.revision ?? 0)
                || Date.parse(remote.updated_at) > Date.parse(localPlan.updated_at),
            }
          : localPlan
      })
      return [
        ...mergedLocal,
        ...current.filter((plan) => plan.source === 'remote' && !localIds.has(plan.id)),
      ].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
    })
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
    const send = (active: boolean): void => {
      if (disposed && active) return
      void window.luna.lunaKaHttpClient.request<unknown>(
        connectedEndpoint,
        `/api/v1/director/keepalive?active=${active ? '1' : '0'}`,
      ).catch(() => undefined)
    }
    send(true)
    const timer = window.setInterval(() => send(true), 15_000)
    return () => {
      disposed = true
      window.clearInterval(timer)
      send(false)
    }
  }, [activePlan, connectedEndpoint])

  useEffect(() => {
    if (!connectedEndpoint) return
    let disposed = false
    const unsubscribe = window.luna.lunaKaHttpClient.onChannelMessage((event) => {
      if (event.endpoint !== new URL(connectedEndpoint).origin || disposed) return
      const message = event.message as {
        type?: unknown
        name?: unknown
        payload?: { plan_id?: unknown }
      } | null
      if (
        message?.type !== 'event'
        || (message.name !== 'director.plan.updated' && message.name !== 'director.plan.deleted')
      ) return
      const planId = message.payload?.plan_id
      if (typeof planId === 'string' && pendingWritePlanIdsRef.current.has(planId)) return
      if (message.name === 'director.plan.deleted') {
        setActivePlanId((current) => current === planId ? null : current)
      }
      void requestPlans(connectedEndpoint)
        .then((payload) => {
          if (!disposed) mergePlans(payload.plans)
        })
        .catch(() => undefined)
    })
    void window.luna.lunaKaHttpClient.connectChannel(connectedEndpoint).catch(() => undefined)
    return () => {
      disposed = true
      unsubscribe()
      void window.luna.lunaKaHttpClient.disconnectChannel(connectedEndpoint).catch(() => undefined)
    }
  }, [connectedEndpoint, mergePlans])

  const loadPlans = useCallback(async (value: string): Promise<boolean> => {
    let normalized: string
    try {
      normalized = normalizeEndpoint(value)
    } catch {
      return false
    }

    setLoading(true)
    try {
      const payload = await requestPlans(normalized)
      mergePlans(payload.plans)
      void Promise.all(payload.plans.map((plan) => window.luna.directorLab.reconcileLocalPlan(plan)))
        .then(async (reconciled) => {
          if (reconciled.some(Boolean)) mergeLocalPlanCopies(await refreshLocalPlans())
        })
        .catch(() => undefined)
      setConnectedEndpoint(normalized)
      setActivePlanId((current) => payload.plans.some((plan) => plan.id === current)
        ? current
        : null)
      localStorage.setItem(ENDPOINT_STORAGE_KEY, normalized)
      return true
    } catch {
      setConnectedEndpoint(null)
      return false
    } finally {
      setLoading(false)
    }
  }, [mergeLocalPlanCopies, mergePlans, refreshLocalPlans])

  const discover = useCallback(async (): Promise<boolean> => {
    setLoading(true)
    try {
      const result = await window.luna.directorLab.discover()
      return result.services.length > 0
        ? loadPlans(result.services[0].baseUrl)
        : false
    } catch {
      return false
    } finally {
      setLoading(false)
    }
  }, [loadPlans])

  useEffect(() => {
    void refreshLocalPlans().then((local) => {
      if (local.length > 0) {
        setPlans(local)
      }
      const saved = localStorage.getItem(ENDPOINT_STORAGE_KEY)
      if (saved) {
        void loadPlans(saved).then((connected) => {
          if (!connected) void discover()
        })
      } else {
        void discover()
      }
    })
  }, [discover, loadPlans, refreshLocalPlans])

  async function download(
    key: string,
    url: string | null,
    fileName: string,
    planTitle: string,
    context?: {
      shotOrder: number
      shotName: string
      takeIndex: number
      takeId: string
      plan: DirectorLanPlanSummary
    },
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
        metadata: mediaMetadata,
        ...context,
      })
      toast.success(`已保存 ${result.fileName}`)
      if (context) {
        void refreshLocalPlans().then((local) => {
          if (local.length > 0) mergeLocalPlanCopies(local)
        })
      }
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
      const result = await window.luna.directorLab.downloadPlan({
        plan,
        operationId,
        metadata: mediaMetadata,
      })
      toast.success(`已保存 ${result.fileCount} 个原素材到文件夹`)
      const local = await refreshLocalPlans()
      mergeLocalPlanCopies(local)
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

  function beginPlanTitleEdit(): void {
    if (!activePlan) return
    setPlanTitleDraft(activePlan.title)
    setPlanTitleBaseRevision(activePlan.revision ?? 0)
    setEditingPlanTitle(true)
  }

  async function savePlanTitleEdit(): Promise<void> {
    if (
      !activePlan
      || !connectedEndpoint
      || !planTitleDraft.trim()
    ) return
    if (planTitleDraft.trim().length > 120) {
      toast.error('计划名称不能超过 120 个字符')
      return
    }
    if (planTitleDraft.trim() === activePlan.title) {
      setEditingPlanTitle(false)
      return
    }
    setSavingPlanTitle(true)
    setPlanWritePending(activePlan.id, true)
    try {
      await window.luna.lunaKaHttpClient.request<DirectorLanPlanSummary>(
        connectedEndpoint,
        `/api/v1/director/plans/${encodeURIComponent(activePlan.id)}`,
        {
          method: 'PATCH',
          body: {
            expected_revision: planTitleBaseRevision,
            title: planTitleDraft.trim(),
            attributes: activePlan.attributes,
            shots: activePlan.shots.map((shot) => ({
              id: shot.id,
              name: shot.name,
              duration_ms: shot.duration_ms,
              remark: shot.remark,
              attributes: shot.attributes.map((attribute) => ({
                id: attribute.id,
                name: attribute.name,
                description: attribute.description,
              })),
            })),
          },
        },
      )
      setEditingPlanTitle(false)
      toast.success('计划名称已保存')
      void refreshRemotePlans().catch(() => undefined)
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError)
      if (message.includes('HTTP 409') || message.includes('其他端修改')) {
        try {
          const latest = await refreshRemotePlans()
          const revision = latest.find((plan) => plan.id === activePlan.id)?.revision
          if (revision != null) {
            setPlanTitleBaseRevision(revision)
            toast.error('计划已在其他端修改，再次保存以应用新名称')
          } else {
            toast.error('版本冲突，远端刷新失败')
          }
        } catch {
          toast.error('版本冲突，远端刷新失败')
        }
      } else {
        toast.error(message)
      }
    } finally {
      setPlanWritePending(activePlan.id, false)
      setSavingPlanTitle(false)
    }
  }

  async function openLocalPlanDirectory(): Promise<void> {
    if (!activePlan?.local_directory) return
    await window.luna.openPath(activePlan.local_directory)
  }

  async function openTakeDirectory(take: DirectorLanTake): Promise<void> {
    if (!activePlan) return
    if (take.stream_path && !/^https?:\/\//i.test(take.stream_path)) {
      await window.luna.revealFile(take.stream_path)
      return
    }
    const shotIndex = activePlan.shots.findIndex((shot) =>
      shot.takes.some((item) => item.id === take.id))
    const shot = activePlan.shots[shotIndex]
    if (!activePlan.local_directory || !shot) return
    const shotFolder = `${String(shot.order).padStart(2, '0')}_${shot.name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim()}`
    await window.luna.openPath(`${activePlan.local_directory}/media/${shotFolder}`)
  }

  async function openTakeFile(take: DirectorLanTake): Promise<void> {
    if (!take.stream_path || /^https?:\/\//i.test(take.stream_path)) return
    await window.luna.openPath(take.stream_path)
  }

  return (
    <div className="lab-page lab-director-page">
      <header className="lab-director-page-header">
        <div className="lab-title-block">
          <Tooltip content="返回实验室">
            <IconButton
              variant="ghost"
              size="compact"
              icon={<ArrowLeft size={15} />}
              aria-label="返回实验室"
              onClick={onBack}
            />
          </Tooltip>
          <h1>导演计划</h1>
        </div>
        {connectedEndpoint && (
          <Tooltip content="刷新导演计划">
            <IconButton
              variant="outline"
              size="compact"
              icon={<RefreshCw size={15} />}
              aria-label="刷新导演计划"
              disabled={loading}
              onClick={() => void loadPlans(connectedEndpoint)}
            />
          </Tooltip>
        )}
      </header>

      {loading && plans.length === 0 && (
        <div className="lab-director-state">
          <LoadingIndicator label="正在同步导演计划" />
        </div>
      )}

      {!loading && plans.length === 0 && (
        <div className="lab-director-state">
          <Box size={24} />
          <strong>暂无导演计划</strong>
        </div>
      )}

      {!activePlan && plans.length > 0 && (
        <DirectorLabPlanList
          plans={plans}
          onSelect={(planId) => {
            setActivePlanId(planId)
            setDirectorView('shots')
            setShotQuery('')
            setShotSort('order')
            setEditingPlanTitle(false)
          }}
        />
      )}

      {activePlan && (
        <section className="lab-plan-shell">
          <header className="lab-plan-header">
            <div className="lab-plan-heading-main">
              <div className="lab-plan-title-row">
                <Tooltip content="返回计划列表">
                  <IconButton
                    variant="ghost"
                    size="compact"
                    icon={<ArrowLeft size={15} />}
                    aria-label="返回计划列表"
                    onClick={() => {
                      setActivePlanId(null)
                      setEditingPlanTitle(false)
                      setPreviewTakeId(null)
                      setShotQuery('')
                      setShotSort('order')
                    }}
                  />
                </Tooltip>
                {editingPlanTitle ? (
                  <Input
                    aria-label="计划名称"
                    variant="compact"
                    className="lab-plan-title-input"
                    value={planTitleDraft}
                    maxLength={120}
                    onChange={(event) => setPlanTitleDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void savePlanTitleEdit()
                      if (event.key === 'Escape') setEditingPlanTitle(false)
                    }}
                  />
                ) : <h2>{activePlan.title}</h2>}
                {connectedEndpoint && (
                  editingPlanTitle ? (
                    <>
                      <Tooltip content="保存计划名称">
                        <IconButton
                          variant="outline"
                          size="compact"
                          icon={<Save size={14} />}
                          aria-label="保存计划名称"
                          disabled={savingPlanTitle || !planTitleDraft.trim()}
                          onClick={() => void savePlanTitleEdit()}
                        />
                      </Tooltip>
                      <Tooltip content="取消重命名">
                        <IconButton
                          variant="ghost"
                          size="compact"
                          icon={<X size={14} />}
                          aria-label="取消重命名"
                          disabled={savingPlanTitle}
                          onClick={() => setEditingPlanTitle(false)}
                        />
                      </Tooltip>
                    </>
                  ) : (
                    <Tooltip content="重命名计划">
                      <IconButton
                        variant="ghost"
                        size="compact"
                        icon={<Pencil size={14} />}
                        aria-label="重命名计划"
                        onClick={beginPlanTitleEdit}
                      />
                    </Tooltip>
                  )
                )}
              </div>
              <span className="lab-plan-meta">
                创建于 {formatPlanCreatedAt(activePlan.created_at)} · {activePlan.shot_count} 个镜头 · {activePlan.take_count} 段素材
              </span>
            </div>
            <div className="lab-director-actions">
              {activePlan.local_directory && (
                <Button
                  variant="secondary"
                  size="compact"
                  icon={<FolderOpen size={15} />}
                  onClick={() => void openLocalPlanDirectory()}
                >
                  打开本地副本
                </Button>
              )}
              {connectedEndpoint && (!activePlan.local_directory || activePlan.update_available) && (
                <Button
                  variant={activePlan.update_available ? 'primary' : 'secondary'}
                  size="compact"
                  icon={<FolderDown size={15} />}
                  disabled={downloading != null}
                  onClick={() => void downloadPlan(activePlan)}
                >
                  {downloading === `plan:${activePlan.id}`
                    ? '下载中'
                    : activePlan.update_available
                      ? '更新本地副本'
                      : '下载到文件夹'}
                </Button>
              )}
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
                  <FolderSync size={13} /> 本地副本待更新
                </span>
              )}
            </div>
          </header>
          {downloadProgress && (downloadProgress.phase !== 'done' || downloading != null) && (
            <div className="lab-download-progress">
              <span>{downloadProgress.currentFile ?? '正在准备素材'}</span>
              <strong>{downloadProgress.percent}%</strong>
              <div><i style={{ width: `${downloadProgress.percent}%` }} /></div>
            </div>
          )}
          <section className="lab-director-progress" aria-label="拍摄进度">
            <div className="lab-director-progress-copy">
              <strong>{availableShotCount}/{planShotCount} 个镜头已有素材</strong>
              <span>
                {missingTakeCount > 0
                  ? `${availableTakeCount} 段可用 · ${missingTakeCount} 段缺失`
                  : `${availableTakeCount} 段可用素材`}
              </span>
            </div>
            <div
              className="lab-director-progress-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={Math.max(planShotCount, 1)}
              aria-valuenow={availableShotCount}
            >
              <i style={{ width: `${planShotCount ? availableShotCount / planShotCount * 100 : 0}%` }} />
            </div>
          </section>
          <div className="lab-director-workspace">
            <div className="lab-director-toolbar">
              <ButtonGroup
                ariaLabel="素材视图"
                value={directorView}
                onChange={setDirectorView}
                className="lab-director-view-switch"
                options={[
                  { value: 'shots', label: '分镜' },
                  { value: 'media', label: `素材 ${takes.length}` },
                ]}
              />
              <div className="lab-director-tools">
                <Input
                  aria-label="搜索镜头、属性或素材"
                  variant="compact"
                  icon={<Search size={14} />}
                  wrapperClassName="lab-shot-search"
                  placeholder="搜索镜头 / 属性 / 素材"
                  value={shotQuery}
                  onChange={(event) => setShotQuery(event.target.value)}
                />
                <Select
                  variant="compact"
                  icon={<ListFilter size={14} />}
                  placeholder="排序方式"
                  value={shotSort}
                  onValueChange={setShotSort}
                  options={[
                    { value: 'order', label: '按镜头序号' },
                    { value: 'name', label: '按名称' },
                    { value: 'takes', label: '按素材数量' },
                  ]}
                  className="lab-shot-sort"
                />
              </div>
            </div>
            <div className={`lab-director-content lab-director-content-${directorView}`}>
              {directorView === 'shots' ? (
                <DirectorLabShotList
                  plan={activePlan}
                  shots={visibleShots}
                  endpoint={activePlan.source === 'remote' ? connectedEndpoint : null}
                  refreshPlans={refreshRemotePlans}
                  onWriteStateChange={setPlanWritePending}
                  onOpenTake={(take) => {
                    setActiveTakeId(take.id)
                    setPreviewTakeId(take.id)
                  }}
                />
              ) : (
                <div className="lab-material-board">
                  {visibleShots.map((shot) => {
                    const stats = shotMetadata(shot, mediaMetadata)
                    return (
                      <section className="lab-material-shot" key={shot.id}>
                        <header>
                          <div>
                            <strong>{String(shot.order).padStart(2, '0')} · {shot.name}</strong>
                            {shot.attributes[0] && (
                              <small>{shot.attributes[0].name}：{shot.attributes[0].description}</small>
                            )}
                            {shot.remark && <small>备注：{shot.remark}</small>}
                          </div>
                          <span>{shot.takes.length} 段素材</span>
                        </header>
                        {shot.takes.length > 0 && (
                          <div className="lab-shot-stats">
                            <span><CalendarDays size={13} />创建 {formatMediaTime(stats.createdAt)}</span>
                            <span><Camera size={13} />拍摄 {formatMediaTime(stats.capturedAt)}</span>
                            <span>
                              <Clock3 size={13} />时长 {stats.metadataPending && metadataLoading
                                ? '读取中'
                                : formatDurationMs(stats.durationMs)}
                            </span>
                            {stats.resolution && <span className="lab-shot-resolution">{stats.resolution}</span>}
                          </div>
                        )}
                        {shot.takes.length > 0 ? (
                          <div className="lab-take-grid">
                            {shot.takes.map((take, index) => {
                              const takeDetails = takeMetadata(take, mediaMetadata)
                              return (
                                <ContextMenu key={take.id}>
                                  <ContextMenuTrigger asChild>
                                    <button
                                      className={`lab-take-card${take.id === activeTake?.id ? ' active' : ''}`}
                                      type="button"
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
                                            ? formatDurationMs(takeDetails?.durationMs)
                                            : '照片'}
                                          {' · '}
                                          {take.size_bytes ? formatBytes(take.size_bytes) : '文件缺失'}
                                        </small>
                                        <small>
                                          {takeDetails?.capturedAt
                                            ? `拍摄 ${formatMediaTime(takeDetails.capturedAt)}`
                                            : `创建 ${formatMediaTime(take.created_at)}`}
                                        </small>
                                      </span>
                                      <span className="lab-take-open">查看</span>
                                    </button>
                                  </ContextMenuTrigger>
                                  <ContextMenuContent>
                                    <ContextMenuItem onSelect={() => void openTakeFile(take)} disabled={!take.stream_path || /^https?:\/\//i.test(take.stream_path)}>
                                      打开文件
                                    </ContextMenuItem>
                                    <ContextMenuItem onSelect={() => void openTakeDirectory(take)} disabled={!take.available}>
                                      打开所在文件夹
                                    </ContextMenuItem>
                                  </ContextMenuContent>
                                </ContextMenu>
                              )
                            })}
                          </div>
                        ) : (
                          <div className="lab-shot-empty">暂无素材</div>
                        )}
                      </section>
                    )
                  })}
                  {visibleShots.length === 0 && (
                    <div className="lab-shot-empty">
                      {activePlan.shots.length === 0 ? '暂无素材' : '没有匹配的素材'}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      )}
      {previewTake && previewShot && activePlan && (
        <DirectorMediaPreviewDialog
          take={previewTake}
          shot={previewShot}
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
                takeId: take.id,
                plan: activePlan,
              },
            )
          }}
          onClose={() => setPreviewTakeId(null)}
        />
      )}
    </div>
  )
}
