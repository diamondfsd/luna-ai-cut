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
  FileUp,
} from 'lucide-react'

import type {
  DirectorLabDownloadProgress,
  DirectorLabMediaMetadata,
  DirectorLanPlanAttribute,
  DirectorLanPlanSummary,
  DirectorPlanSchema,
  DirectorLanPlansResponse,
  DirectorLanShot,
} from '../shared/types'
import { useDirectorPlanSync } from '../hooks/useDirectorPlanSync'
import { useDirectorMaterialSync } from '../hooks/useDirectorMaterialSync'
import { DIRECTOR_PLAN_ATTRIBUTES, directorPlanContentSignature, overlayDirectorLocalPlan } from '../lib/directorPlanSync'
import { Button, IconButton, Input, LoadingIndicator, Select, Switch, Tooltip, toast } from '../ui'
import { DirectorMediaPreviewDialog } from './DirectorMediaPreviewDialog'
import { DirectorLabPlanList } from './DirectorLabPlanList'
import { DirectorLabShotList } from './DirectorLabShotList'
import { DirectorPlanConflictDialog } from './DirectorPlanConflictDialog'
import { DirectorPlanImportDialog } from './DirectorPlanImportDialog'
import './DirectorLabView.css'

interface DirectorLabViewProps {
  active: boolean
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

async function requestSchema(endpoint: string): Promise<DirectorPlanSchema> {
  const schema = await window.luna.lunaKaHttpClient.request<DirectorPlanSchema>(
    endpoint,
    '/api/v1/director/schema',
  )
  if (!Number.isSafeInteger(schema.schema_version) || schema.schema_version < 1
    || !Array.isArray(schema.shot_fields) || schema.shot_fields.length > 100
    || new Set(schema.shot_fields.map((field) => field.id)).size !== schema.shot_fields.length
    || schema.shot_fields.some((field) =>
      !/^[a-z][a-z0-9_]*$/.test(field.id)
      || !field.label?.trim()
      || !field.storage_name?.trim()
      || field.storage_name.length > 80
      || !['text', 'multiline'].includes(field.kind)
      || !Number.isSafeInteger(field.max_length)
      || field.max_length < 1 || field.max_length > 4000)) {
    throw new Error('手机返回的导演计划字段定义无效')
  }
  return schema
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

  return DIRECTOR_PLAN_ATTRIBUTES.map((attribute) => ({ ...attribute }))
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
        attributes: Array.isArray(shot.attributes) && shot.attributes.length > 0
          ? shot.attributes
          : attributes.map((attribute) => ({
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

export function DirectorLabView({ active, onBack }: DirectorLabViewProps) {
  const [connectedEndpoint, setConnectedEndpoint] = useState<string | null>(null)
  const [schema, setSchema] = useState<DirectorPlanSchema | null>({ schema_version: 2, shot_fields: [
    { id: 'content', label: '画面内容', storage_name: '画面内容', kind: 'multiline', max_length: 4000 },
    { id: 'framing', label: '景别', storage_name: '景别', kind: 'text', max_length: 4000 },
    { id: 'movement', label: '运镜方式', storage_name: '运镜方式', kind: 'multiline', max_length: 4000 },
  ] })
  const [importOpen, setImportOpen] = useState(false)
  const [syncMaterials, setSyncMaterials] = useState(() => localStorage.getItem('luna.director-lab.sync-materials') === 'true')
  const [plans, setPlans] = useState<DirectorLanPlanSummary[]>([])
  const [activePlanId, setActivePlanId] = useState<string | null>(null)
  const [shotQuery, setShotQuery] = useState('')
  const [shotSort, setShotSort] = useState('order')
  const [editingPlanTitle, setEditingPlanTitle] = useState(false)
  const [planTitleDraft, setPlanTitleDraft] = useState('')
  const [planTitleBaseSignature, setPlanTitleBaseSignature] = useState('')
  const [savingPlanTitle, setSavingPlanTitle] = useState(false)
  const [previewTakeId, setPreviewTakeId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<DirectorLabDownloadProgress | null>(null)
  const [mediaMetadata, setMediaMetadata] = useState<Record<string, DirectorLabMediaMetadata>>({})
  const metadataRequestRef = useRef(0)
  const pendingWritePlanIdsRef = useRef(new Set<string>())
  const discoveryTaskRef = useRef<Promise<boolean> | null>(null)

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
        current.filter((plan) => plan.local_directory).map((plan) => [plan.id, plan]),
      )
      const remoteIds = new Set(remotePlans.map((plan) => plan.id))
      const mergedRemote = remotePlans.map((remote) => {
        const local = localById.get(remote.id)
        const previous = currentById.get(remote.id)
        return local
          ? overlayDirectorLocalPlan(remote, local)
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
    const [payload, definitions] = await Promise.all([
      requestPlans(connectedEndpoint),
      requestSchema(connectedEndpoint),
    ])
    setSchema(definitions)
    mergePlans(payload.plans)
    return payload.plans
  }, [connectedEndpoint, mergePlans])

  const setPlanWritePending = useCallback((planId: string, pending: boolean): void => {
    if (pending) pendingWritePlanIdsRef.current.add(planId)
    else pendingWritePlanIdsRef.current.delete(planId)
  }, [])

  const isPlanWritePending = useCallback((planId: string): boolean =>
    pendingWritePlanIdsRef.current.has(planId), [])

  const handleSyncConflict = useCallback((plan: DirectorLanPlanSummary): void => {
    toast.error(`“${plan.title}”两端都有新修改，已保留本地副本`)
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
          ? overlayDirectorLocalPlan(remote, localPlan)
          : localPlan
      })
      return [
        ...mergedLocal,
        ...current.filter((plan) => plan.source === 'remote' && !localIds.has(plan.id)),
      ].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
    })
  }, [])

  const [conflictsOpen, setConflictsOpen] = useState(false)
  useDirectorMaterialSync(active, syncMaterials, connectedEndpoint, mergeLocalPlanCopies)
  const { status: syncStatus, synchronize, conflicts, resolvingPlanId, resolveConflict } = useDirectorPlanSync({
    enabled: active,
    endpoint: connectedEndpoint,
    requestRemotePlans: refreshRemotePlans,
    mergeRemotePlans: mergePlans,
    mergeLocalPlans: mergeLocalPlanCopies,
    isPlanWritePending,
    setPlanWritePending,
    onConflict: handleSyncConflict,
  })

  function handleLocalPlanChange(plan: DirectorLanPlanSummary): void {
    setPlans((current) => {
      const previous = current.find((item) => item.id === plan.id)
      const remote = previous?.remote_plan ?? (previous?.source === 'remote' ? previous : null)
      return [remote ? overlayDirectorLocalPlan(remote, plan) : plan, ...current.filter((item) => item.id !== plan.id)]
    })
    window.setTimeout(() => void synchronize().catch(() => undefined), 0)
  }

  useEffect(() => {
    if (!active || !activePlan) {
      setMediaMetadata({})
      return
    }
    const requests = activePlan.shots
      .flatMap((shot) => shot.takes)
      .filter((take) => take.kind === 'video' && take.available && take.stream_url)
      .map((take) => ({ takeId: take.id, url: take.stream_url! }))
    metadataRequestRef.current += 1
    const requestId = metadataRequestRef.current
    if (requests.length === 0) {
      return
    }
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
  }, [active, activePlan])

  useEffect(() => {
    if (!active || !connectedEndpoint || !activePlan) return
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
  }, [active, activePlan, connectedEndpoint])

  useEffect(() => {
    if (!active || !connectedEndpoint) return
    let disposed = false
    let reconnectTimer: number | null = null
    let reconnectAttempt = 0
    let connecting = false
    let endpointOrigin: string
    try {
      endpointOrigin = new URL(connectedEndpoint).origin
    } catch {
      return
    }

    const scheduleReconnect = (): void => {
      if (disposed || reconnectTimer != null) return
      const delay = Math.min(30_000, 1_000 * (2 ** reconnectAttempt))
      reconnectAttempt += 1
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null
        void connect()
      }, delay)
    }

    const connect = async (): Promise<void> => {
      if (disposed || connecting) return
      connecting = true
      try {
        await window.luna.lunaKaHttpClient.connectChannel(connectedEndpoint)
        reconnectAttempt = 0
        void synchronize().catch(() => undefined)
      } catch {
        scheduleReconnect()
      } finally {
        connecting = false
      }
    }

    const unsubscribeMessage = window.luna.lunaKaHttpClient.onChannelMessage((event) => {
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
      void synchronize().catch(() => undefined)
    })
    const unsubscribeStatus = window.luna.lunaKaHttpClient.onChannelStatus((event) => {
      if (event.endpoint !== endpointOrigin || disposed) return
      if (event.state === 'open') {
        reconnectAttempt = 0
        void synchronize().catch(() => undefined)
      } else {
        scheduleReconnect()
      }
    })
    void connect()
    return () => {
      disposed = true
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer)
      unsubscribeMessage()
      unsubscribeStatus()
      void window.luna.lunaKaHttpClient.disconnectChannel(connectedEndpoint).catch(() => undefined)
    }
  }, [active, connectedEndpoint, synchronize])

  const loadPlans = useCallback(async (value: string): Promise<boolean> => {
    if (!active) return false
    let normalized: string
    try {
      normalized = normalizeEndpoint(value)
    } catch {
      return false
    }

    setLoading(true)
    try {
      const [payload, definitions] = await Promise.all([
        requestPlans(normalized), requestSchema(normalized),
      ])
      setSchema(definitions)
      mergePlans(payload.plans)
      setConnectedEndpoint(normalized)
      setActivePlanId((current) => payload.plans.some((plan) => plan.id === current)
        ? current
        : null)
      localStorage.setItem(ENDPOINT_STORAGE_KEY, normalized)
      return true
    } catch {
      setConnectedEndpoint(null)
      setSchema(null)
      return false
    } finally {
      setLoading(false)
    }
  }, [active, mergePlans])

  const discover = useCallback(async (): Promise<boolean> => {
    if (!active) return false
    if (discoveryTaskRef.current) return discoveryTaskRef.current
    const task = (async () => {
      setLoading(true)
      try {
        const result = await window.luna.directorLab.discover()
        for (const service of result.services) {
          if (await loadPlans(service.baseUrl)) return true
        }
        return false
      } catch {
        return false
      } finally {
        setLoading(false)
      }
    })()
    discoveryTaskRef.current = task
    try {
      return await task
    } finally {
      if (discoveryTaskRef.current === task) discoveryTaskRef.current = null
    }
  }, [active, loadPlans])

  useEffect(() => {
    if (!active) return
    let canceled = false
    void refreshLocalPlans().then((local) => {
      if (canceled) return
      if (local.length > 0) {
        setPlans(local)
      }
      const saved = localStorage.getItem(ENDPOINT_STORAGE_KEY)
      if (saved) {
        void loadPlans(saved).then((connected) => {
          if (!canceled && !connected) void discover()
        })
      } else if (!canceled) {
        void discover()
      }
    })
    return () => {
      canceled = true
    }
  }, [active, discover, loadPlans, refreshLocalPlans])

  useEffect(() => {
    if (!active || syncStatus !== 'offline') return
    void discover()
    const timer = window.setInterval(() => void discover(), 12_000)
    return () => window.clearInterval(timer)
  }, [active, discover, syncStatus])

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
    setPlanTitleBaseSignature(activePlan.local_content_signature ?? directorPlanContentSignature(activePlan))
    setEditingPlanTitle(true)
  }

  async function savePlanTitleEdit(): Promise<void> {
    if (
      !activePlan
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
      handleLocalPlanChange(await window.luna.directorLab.saveLocalPlan({ ...activePlan,
        synced_signature: activePlan.synced_signature ?? directorPlanContentSignature(activePlan),
        title: planTitleDraft.trim() }, planTitleBaseSignature))
      setEditingPlanTitle(false)
      toast.success('计划名称已保存')
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError)
      if (message.includes('HTTP 409') || message.includes('其他端修改') || message.includes('计划已更新')) {
        try {
          const latest = await refreshLocalPlans()
          mergeLocalPlanCopies(latest)
          const latestPlan = latest.find((plan) => plan.id === activePlan.id)
          if (latestPlan) {
            setPlanTitleBaseSignature(latestPlan.local_content_signature ?? directorPlanContentSignature(latestPlan))
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

  const syncStatusLabel = syncStatus === 'syncing'
    ? '同步中'
    : syncStatus === 'conflict'
      ? '有冲突'
      : syncStatus === 'offline'
        ? '等待连接'
        : '已同步'

  return (
    <div className="lab-page lab-director-page">
      <header className="lab-director-page-header">
        <div className="lab-title-block">
          <Tooltip content={activePlan ? '返回计划列表' : '返回实验室'}>
            <IconButton
              variant="ghost"
              size="compact"
              icon={<ArrowLeft size={15} />}
              aria-label={activePlan ? '返回计划列表' : '返回实验室'}
              onClick={() => {
                if (!activePlan) {
                  onBack()
                  return
                }
                setActivePlanId(null)
                setEditingPlanTitle(false)
                setPreviewTakeId(null)
                setShotQuery('')
                setShotSort('order')
              }}
            />
          </Tooltip>
          <h1>导演计划</h1>
        </div>
        <Button size="compact" variant="secondary" icon={<FileUp size={15} />}
          onClick={() => setImportOpen(true)}>导入计划</Button>
        {connectedEndpoint && (
          <div className="lab-director-sync-actions">
            <span
              className={`lab-sync-status is-${syncStatus}`}
              aria-live="polite"
            >
              {syncStatusLabel}
            </span>
            {conflicts.length > 0 && <Button size="compact" onClick={() => setConflictsOpen(true)}>
              处理冲突 ({conflicts.length})
            </Button>}
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
          </div>
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
                {schema && (
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
              <div className="lab-plan-meta">
                <span>{availableShotCount}/{planShotCount} 个镜头已有素材</span>
                <span>{missingTakeCount > 0
                  ? `${availableTakeCount} 段可用 · ${missingTakeCount} 段缺失`
                  : `${availableTakeCount} 段可用素材`}</span>
                <span>创建于 {formatPlanCreatedAt(activePlan.created_at)}</span>
              </div>
            </div>
            <div className="lab-director-actions">
              {activePlan.local_directory && (
                <IconButton
                  variant="outline"
                  size="compact"
                  icon={<FolderOpen size={15} />}
                  aria-label="打开素材文件夹"
                  title="打开素材文件夹"
                  onClick={() => void openLocalPlanDirectory()}
                />
              )}
              <label className="lab-material-sync"><span>同步素材</span><Switch checked={syncMaterials} ariaLabel="同步素材"
                onCheckedChange={(checked) => { localStorage.setItem('luna.director-lab.sync-materials', String(checked)); setSyncMaterials(checked) }} /></label>
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
          <div className="lab-director-workspace">
            <div className="lab-director-content">
              <DirectorLabShotList
                tools={
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
                }
                schema={schema}
                plan={activePlan}
                shots={visibleShots}
                onLocalPlanChange={handleLocalPlanChange}
                refreshPlans={async () => {
                  const local = await refreshLocalPlans()
                  mergeLocalPlanCopies(local)
                  return local
                }}
                onWriteStateChange={setPlanWritePending}
                onOpenTake={(take) => setPreviewTakeId(take.id)}
              />
            </div>
          </div>
        </section>
      )}
      <DirectorPlanImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={(plan) => {
        handleLocalPlanChange(plan)
        setActivePlanId(plan.id)
        setShotQuery('')
        setShotSort('order')
        setEditingPlanTitle(false)
        setPreviewTakeId(null)
      }} />
      <DirectorPlanConflictDialog
        open={conflictsOpen}
        onOpenChange={setConflictsOpen}
        conflicts={conflicts}
        resolvingPlanId={resolvingPlanId}
        onResolve={resolveConflict}
      />
      {previewTake && previewShot && activePlan && (
        <DirectorMediaPreviewDialog
          take={previewTake}
          shot={previewShot}
          takes={takes}
          planTitle={activePlan.title}
          downloading={downloading === `take:${previewTake.id}`}
          downloadProgress={downloadProgress}
          onSelectTake={(take) => {
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
