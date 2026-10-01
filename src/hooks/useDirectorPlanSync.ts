import { useCallback, useEffect, useRef, useState } from 'react'

import {
  buildDirectorPlanUpdate,
  directorPlanContentSignature,
  directorPlanRevision,
  directorPlanHasSameShots,
  nextDirectorPlanBaseline,
  type DirectorPlanSyncBaseline,
} from '../lib/directorPlanSync'
import type { DirectorLanPlanSummary } from '../shared/types'

export type DirectorPlanSyncStatus = 'idle' | 'syncing' | 'synced' | 'conflict' | 'offline'

export interface DirectorPlanConflict {
  remote: DirectorLanPlanSummary
  local: DirectorLanPlanSummary
}

interface UseDirectorPlanSyncOptions {
  enabled: boolean
  endpoint: string | null
  requestRemotePlans: () => Promise<DirectorLanPlanSummary[]>
  mergeRemotePlans: (plans: DirectorLanPlanSummary[]) => void
  mergeLocalPlans: (plans: DirectorLanPlanSummary[]) => void
  isPlanWritePending: (planId: string) => boolean
  setPlanWritePending: (planId: string, pending: boolean) => void
  onConflict: (plan: DirectorLanPlanSummary) => void
}

function originForEndpoint(endpoint: string): string | null {
  try {
    return new URL(endpoint).origin
  } catch {
    return null
  }
}

export function useDirectorPlanSync({
  enabled,
  endpoint,
  requestRemotePlans,
  mergeRemotePlans,
  mergeLocalPlans,
  isPlanWritePending,
  setPlanWritePending,
  onConflict,
}: UseDirectorPlanSyncOptions) {
  const [status, setStatus] = useState<DirectorPlanSyncStatus>(enabled && endpoint ? 'idle' : 'offline')
  const baselinesRef = useRef(new Map<string, DirectorPlanSyncBaseline>())
  const syncTaskRef = useRef<Promise<void> | null>(null)
  const conflictPlanIdsRef = useRef(new Set<string>())
  const mountedRef = useRef(true)
  const endpointRef = useRef(endpoint)
  endpointRef.current = endpoint
  const conflictsRef = useRef(new Map<string, DirectorPlanConflict>())
  const [conflicts, setConflicts] = useState<DirectorPlanConflict[]>([])
  const [resolvingPlanId, setResolvingPlanId] = useState<string | null>(null)
  const resolvingRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    baselinesRef.current.clear()
    conflictPlanIdsRef.current.clear()
    conflictsRef.current.clear()
    setConflicts([])
    setStatus(enabled && endpoint ? 'idle' : 'offline')
  }, [enabled, endpoint])

  const synchronize = useCallback(async (): Promise<void> => {
    if (!enabled || !endpoint) {
      setStatus('offline')
      return
    }
    if (syncTaskRef.current) return syncTaskRef.current
    if (resolvingRef.current) return
    const activeEndpoint = endpoint
    const nextConflicts = new Map(conflictsRef.current)

    const task = (async () => {
      setStatus('syncing')
      try {
        const [remotePlans, initialLocalPlans] = await Promise.all([
          requestRemotePlans(),
          window.luna.directorLab.listLocalPlans().catch((): DirectorLanPlanSummary[] => []),
        ])
        if (!mountedRef.current || endpointRef.current !== activeEndpoint) return

        mergeRemotePlans(remotePlans)
        let localPlans = initialLocalPlans
        let localCopiesChanged = false
        let remoteRefreshNeeded = false
        let hasConflict = false
        let finalRemotePlans = remotePlans
        for (const planId of nextConflicts.keys()) {
          if (!remotePlans.some((plan) => plan.id === planId)) nextConflicts.delete(planId)
        }
        const pushedPlanIds = new Set<string>()

        for (const remote of remotePlans) {
          if (!mountedRef.current || endpointRef.current !== activeEndpoint) return
          const local = localPlans.find((plan) => plan.id === remote.id)
          if (!local || isPlanWritePending(remote.id)) {
            if (!local) {
              await reconcileRemotePlan(remote)
              localCopiesChanged = true
            }
            continue
          }

          const remoteSignature = directorPlanContentSignature(remote)
          const localSignature = directorPlanContentSignature(local)
          nextConflicts.delete(remote.id)
          if (conflictsRef.current.has(remote.id) && remoteSignature !== localSignature) {
            hasConflict = true
            notifyConflict(remote, local)
            continue
          }
          let baseline = baselinesRef.current.get(remote.id)
          if (!baseline && typeof local.synced_signature === 'string'
            && Number.isSafeInteger(local.synced_revision)) {
            baseline = {
              revision: local.synced_revision!,
              remoteSignature: local.synced_signature,
              localSignature: local.synced_signature,
            }
          }

          if (!baseline) {
            const localIsNewer = directorPlanRevision(local) > directorPlanRevision(remote)
            if (localIsNewer) {
              try {
                await pushLocalPlan(local, remote)
                remoteRefreshNeeded = true
                localCopiesChanged = true
                pushedPlanIds.add(remote.id)
                baseline = nextDirectorPlanBaseline(remote, local)
              } catch (error) {
                if (!isRevisionConflict(error)) throw error
                hasConflict = true
                notifyConflict(remote, local)
                continue
              }
            } else if (directorPlanRevision(local) === directorPlanRevision(remote)
              && remoteSignature !== localSignature) {
              hasConflict = true
              notifyConflict(remote, local)
              continue
            } else if (remoteSignature !== localSignature) {
              await reconcileRemotePlan(remote)
              localCopiesChanged = true
              baseline = nextDirectorPlanBaseline(remote, remote)
            } else {
              baseline = nextDirectorPlanBaseline(remote, local)
            }
            baselinesRef.current.set(remote.id, baseline)
            continue
          }

          const remoteChanged = directorPlanRevision(remote) !== baseline.revision
            || remoteSignature !== baseline.remoteSignature
          const localChanged = localSignature !== baseline.localSignature

          if (!remoteChanged && !localChanged) continue
          if (remoteSignature === localSignature) {
            baselinesRef.current.set(remote.id, nextDirectorPlanBaseline(remote, local))
            continue
          }
          if (localChanged && !remoteChanged) {
            try {
              await pushLocalPlan(local, remote)
              remoteRefreshNeeded = true
              localCopiesChanged = true
              pushedPlanIds.add(remote.id)
              baselinesRef.current.set(remote.id, nextDirectorPlanBaseline(remote, local))
            } catch (error) {
              if (!isRevisionConflict(error)) throw error
              hasConflict = true
              notifyConflict(remote, local)
            }
            continue
          }
          if (remoteChanged && !localChanged) {
            await reconcileRemotePlan(remote)
            localCopiesChanged = true
            baselinesRef.current.set(remote.id, nextDirectorPlanBaseline(remote, remote))
            continue
          }

          hasConflict = true
          notifyConflict(remote, local)
        }

        if (remoteRefreshNeeded) {
          const refreshedRemotePlans = await requestRemotePlans()
          finalRemotePlans = refreshedRemotePlans
          if (mountedRef.current) mergeRemotePlans(refreshedRemotePlans)
          for (const remote of refreshedRemotePlans) {
            if (pushedPlanIds.has(remote.id)) await reconcileRemotePlan(remote)
          }
        }

        if (localCopiesChanged) {
          localPlans = await window.luna.directorLab.listLocalPlans().catch(() => localPlans)
          if (mountedRef.current) mergeLocalPlans(localPlans)
        }

        if (remoteRefreshNeeded) {
          for (const local of localPlans) {
            if (!pushedPlanIds.has(local.id)) continue
            const remote = finalRemotePlans.find((plan) => plan.id === local.id)
            if (remote) baselinesRef.current.set(local.id, nextDirectorPlanBaseline(remote, local))
          }
        }

        if (mountedRef.current && endpointRef.current === activeEndpoint) {
          conflictsRef.current = nextConflicts
          setConflicts([...nextConflicts.values()])
          for (const planId of conflictPlanIdsRef.current) {
            if (!nextConflicts.has(planId)) conflictPlanIdsRef.current.delete(planId)
          }
          setStatus(hasConflict || nextConflicts.size ? 'conflict' : 'synced')
        }
      } catch {
        if (mountedRef.current) setStatus('offline')
        throw new Error('导演计划同步失败')
      }
    })()

    syncTaskRef.current = task
    try {
      await task
    } catch {
      // The caller may trigger another synchronization after the connection recovers.
    } finally {
      if (syncTaskRef.current === task) syncTaskRef.current = null
    }

    async function pushLocalPlan(
      local: DirectorLanPlanSummary,
      remote: DirectorLanPlanSummary,
    ): Promise<void> {
      setPlanWritePending(local.id, true)
      try {
        await window.luna.lunaKaHttpClient.request<DirectorLanPlanSummary>(
          activeEndpoint,
          `/api/v1/director/plans/${encodeURIComponent(local.id)}`,
          {
            method: 'PATCH',
            body: buildDirectorPlanUpdate(local, directorPlanRevision(remote)),
          },
        )
      } finally {
        setPlanWritePending(local.id, false)
      }
    }

    async function reconcileRemotePlan(remote: DirectorLanPlanSummary): Promise<void> {
      await window.luna.directorLab.reconcileLocalPlan(remote)
    }

    function isRevisionConflict(error: unknown): boolean {
      const message = error instanceof Error ? error.message : String(error)
      return message.includes('HTTP 409') || message.includes('其他端修改')
    }

    function notifyConflict(plan: DirectorLanPlanSummary, local: DirectorLanPlanSummary): void {
      nextConflicts.set(plan.id, { remote: plan, local })
      if (conflictPlanIdsRef.current.has(plan.id)) return
      conflictPlanIdsRef.current.add(plan.id)
      onConflict(plan)
    }
  }, [
    enabled,
    endpoint,
    isPlanWritePending,
    mergeLocalPlans,
    mergeRemotePlans,
    onConflict,
    requestRemotePlans,
    setPlanWritePending,
  ])

  const resolveConflict = useCallback(async (planId: string, source: 'remote' | 'local', reviewed: DirectorPlanConflict) => {
    if (!enabled || !endpoint) throw new Error('手机尚未连接')
    if (resolvingRef.current) throw new Error('正在处理冲突')
    resolvingRef.current = true
    setResolvingPlanId(planId)
    try {
      await syncTaskRef.current
      if (!conflictsRef.current.has(planId)) throw new Error('冲突已变化，请刷新后重试')
      const [remotePlans, localPlans] = await Promise.all([
        requestRemotePlans(), window.luna.directorLab.listLocalPlans(),
      ])
      if (!mountedRef.current || endpointRef.current !== endpoint) throw new Error('连接已变化，请重试')
      const remote = remotePlans.find((plan) => plan.id === planId)
      const local = localPlans.find((plan) => plan.id === planId)
      if (!remote || !local) throw new Error('计划不可用，请刷新后重试')
      if (directorPlanRevision(remote) !== directorPlanRevision(reviewed.remote)
        || directorPlanContentSignature(remote) !== directorPlanContentSignature(reviewed.remote)
        || directorPlanContentSignature(local) !== directorPlanContentSignature(reviewed.local)) {
        conflictsRef.current.set(planId, { remote, local })
        setConflicts([...conflictsRef.current.values()])
        throw new Error('计划又有新修改，请核对后重试')
      }
      setPlanWritePending(planId, true)
      let selected = remote
      if (source === 'local') {
        if (!directorPlanHasSameShots(remote, local)) {
          throw new Error('两端镜头不同，请采用手机版本；电脑副本会先备份')
        }
        selected = await window.luna.lunaKaHttpClient.request<DirectorLanPlanSummary>(
          endpoint, `/api/v1/director/plans/${encodeURIComponent(planId)}`, {
            method: 'PATCH',
            body: buildDirectorPlanUpdate(local, directorPlanRevision(remote)),
          },
        )
      }
      if (!mountedRef.current || endpointRef.current !== endpoint) throw new Error('连接已变化，请重试')
      await window.luna.directorLab.reconcileLocalPlan(selected, true)
      const refreshedLocal = await window.luna.directorLab.listLocalPlans()
      const saved = refreshedLocal.find((plan) => plan.id === planId)
      if (!mountedRef.current || endpointRef.current !== endpoint) throw new Error('连接已变化，请重试')
      if (!saved || directorPlanContentSignature(saved) !== directorPlanContentSignature(selected)) {
        throw new Error('本地副本更新失败，请重试')
      }
      mergeLocalPlans(refreshedLocal)
      mergeRemotePlans(await requestRemotePlans())
      baselinesRef.current.set(planId, nextDirectorPlanBaseline(selected, saved))
      conflictsRef.current.delete(planId)
      conflictPlanIdsRef.current.delete(planId)
      setConflicts([...conflictsRef.current.values()])
      setStatus(conflictsRef.current.size ? 'conflict' : 'synced')
    } finally {
      setPlanWritePending(planId, false)
      resolvingRef.current = false
      setResolvingPlanId(null)
    }
  }, [enabled, endpoint, mergeLocalPlans, mergeRemotePlans, requestRemotePlans, setPlanWritePending])

  useEffect(() => {
    if (!enabled || !endpoint) return
    void synchronize()
    const timer = window.setInterval(() => void synchronize(), 4_000)
    return () => window.clearInterval(timer)
  }, [enabled, endpoint, synchronize])

  return { status, synchronize, conflicts, resolvingPlanId, resolveConflict,
    origin: endpoint ? originForEndpoint(endpoint) : null }
}
