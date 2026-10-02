import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DirectorLabDownloadProgress, DirectorLabMediaMetadata, DirectorLanPlanSummary, DirectorPlanSchema } from '../shared/types'
import { useDirectorPlanSync } from './useDirectorPlanSync'
import { useDirectorMaterialSyncControl } from './useDirectorMaterialSyncControl'
import { directorPlanContentSignature, overlayDirectorLocalPlan } from '../lib/directorPlanSync'
import { buildDirectorAiPrompt } from '../lib/directorAiPrompt'
import { toast } from '../ui'
import { normalizeEndpoint, requestPlans, requestSchema } from '../lib/directorLanPlans'

const ENDPOINT_STORAGE_KEY = 'luna.director-lab.endpoint'

export function useDirectorLab(active: boolean) {
  const [connectedEndpoint, setConnectedEndpoint] = useState<string | null>(null)
  const [schema, setSchema] = useState<DirectorPlanSchema>({ schema_version: 2, shot_fields: [
    { id: 'content', label: '画面内容', storage_name: '画面内容', kind: 'multiline', max_length: 4000 },
    { id: 'framing', label: '景别', storage_name: '景别', kind: 'text', max_length: 4000 },
    { id: 'movement', label: '运镜方式', storage_name: '运镜方式', kind: 'multiline', max_length: 4000 },
  ] })
  const [importOpen, setImportOpen] = useState(false)
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
    const remotePlans = payload.plans.map((plan) => ({
      ...plan, remote_origin: new URL(connectedEndpoint).origin,
    }))
    mergePlans(remotePlans)
    return remotePlans
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
        current.filter((plan) => Boolean(connectedEndpoint) && plan.source === 'remote').map((plan) => [plan.id, plan.remote_plan ?? plan]),
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
  }, [connectedEndpoint])

  const [conflictsOpen, setConflictsOpen] = useState(false)
  const materialSyncControl = useDirectorMaterialSyncControl(active, connectedEndpoint, mergeLocalPlanCopies)
  const { status: syncStatus, synchronize, retrySynchronization, writeFailures, conflicts, resolvingPlanId, resolveConflict } = useDirectorPlanSync({
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
      await window.luna.copyText(buildDirectorAiPrompt(activePlan))
      toast.success('已复制 AI 提示词')
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
      : syncStatus === 'error'
        ? '同步失败'
        : syncStatus === 'offline'
        ? '等待连接'
        : '已同步'

    return {
    connectedEndpoint,
    schema,
    importOpen,
    setImportOpen,
    plans,
    setActivePlanId,
    shotQuery,
    setShotQuery,
    shotSort,
    setShotSort,
    editingPlanTitle,
    setEditingPlanTitle,
    planTitleDraft,
    setPlanTitleDraft,
    savingPlanTitle,
    setPreviewTakeId,
    loading,
    downloading,
    downloadProgress,
    activePlan,
    previewTake,
    previewShot,
    planShotCount,
    availableShotCount,
    availableTakeCount,
    missingTakeCount,
    visibleShots,
    setPlanWritePending,
    refreshLocalPlans,
    mergeLocalPlanCopies,
    conflictsOpen,
    setConflictsOpen,
    materialSyncControl,
    syncStatus,
    retrySynchronization,
    writeFailures,
    conflicts,
    resolvingPlanId,
    resolveConflict,
    handleLocalPlanChange,
    loadPlans,
    download,
    downloadPlan,
    copyAiPrompt,
    beginPlanTitleEdit,
    savePlanTitleEdit,
    openLocalPlanDirectory,
    syncStatusLabel,
  }
}
