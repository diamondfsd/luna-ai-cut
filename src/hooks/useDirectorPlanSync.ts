import { useCallback, useEffect, useRef, useState } from 'react'

import {
  buildDirectorPlanUpdate,
  directorPlanContentSignature,
  directorPlanRevision,
  nextDirectorPlanBaseline,
  type DirectorPlanSyncBaseline,
} from '../lib/directorPlanSync'
import type { DirectorLanPlanSummary } from '../shared/types'

export type DirectorPlanSyncStatus = 'idle' | 'syncing' | 'synced' | 'conflict' | 'offline'

interface UseDirectorPlanSyncOptions {
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
  endpoint,
  requestRemotePlans,
  mergeRemotePlans,
  mergeLocalPlans,
  isPlanWritePending,
  setPlanWritePending,
  onConflict,
}: UseDirectorPlanSyncOptions) {
  const [status, setStatus] = useState<DirectorPlanSyncStatus>(endpoint ? 'idle' : 'offline')
  const baselinesRef = useRef(new Map<string, DirectorPlanSyncBaseline>())
  const syncTaskRef = useRef<Promise<void> | null>(null)
  const conflictPlanIdsRef = useRef(new Set<string>())
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    baselinesRef.current.clear()
    conflictPlanIdsRef.current.clear()
    setStatus(endpoint ? 'idle' : 'offline')
  }, [endpoint])

  const synchronize = useCallback(async (): Promise<void> => {
    if (!endpoint) {
      setStatus('offline')
      return
    }
    if (syncTaskRef.current) return syncTaskRef.current
    const activeEndpoint = endpoint

    const task = (async () => {
      setStatus('syncing')
      try {
        const [remotePlans, initialLocalPlans] = await Promise.all([
          requestRemotePlans(),
          window.luna.directorLab.listLocalPlans().catch((): DirectorLanPlanSummary[] => []),
        ])
        if (!mountedRef.current) return

        mergeRemotePlans(remotePlans)
        let localPlans = initialLocalPlans
        let localCopiesChanged = false
        let remoteRefreshNeeded = false
        let hasConflict = false

        for (const remote of remotePlans) {
          const local = localPlans.find((plan) => plan.id === remote.id)
          if (!local || isPlanWritePending(remote.id)) {
            if (local) {
              const baseline = baselinesRef.current.get(remote.id)
              if (!baseline) baselinesRef.current.set(remote.id, nextDirectorPlanBaseline(remote, local))
            }
            continue
          }

          const remoteSignature = directorPlanContentSignature(remote)
          const localSignature = directorPlanContentSignature(local)
          let baseline = baselinesRef.current.get(remote.id)

          if (!baseline) {
            const localIsNewer = directorPlanRevision(local) > directorPlanRevision(remote)
              || (
                directorPlanRevision(local) === directorPlanRevision(remote)
                && localSignature !== remoteSignature
              )
            if (localIsNewer) {
              try {
                await pushLocalPlan(local, remote)
                remoteRefreshNeeded = true
                localCopiesChanged = true
                baseline = nextDirectorPlanBaseline(remote, local)
              } catch (error) {
                if (!isRevisionConflict(error)) throw error
                hasConflict = true
                notifyConflict(remote)
                continue
              }
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
              baselinesRef.current.set(remote.id, nextDirectorPlanBaseline(remote, local))
            } catch (error) {
              if (!isRevisionConflict(error)) throw error
              hasConflict = true
              notifyConflict(remote)
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
          notifyConflict(remote)
        }

        if (remoteRefreshNeeded) {
          const refreshedRemotePlans = await requestRemotePlans()
          if (mountedRef.current) mergeRemotePlans(refreshedRemotePlans)
          for (const remote of refreshedRemotePlans) {
            const local = localPlans.find((plan) => plan.id === remote.id)
            if (local) baselinesRef.current.set(remote.id, nextDirectorPlanBaseline(remote, local))
          }
        }

        if (localCopiesChanged) {
          localPlans = await window.luna.directorLab.listLocalPlans().catch(() => localPlans)
          if (mountedRef.current) mergeLocalPlans(localPlans)
        }

        if (mountedRef.current) setStatus(hasConflict ? 'conflict' : 'synced')
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

    function notifyConflict(plan: DirectorLanPlanSummary): void {
      if (conflictPlanIdsRef.current.has(plan.id)) return
      conflictPlanIdsRef.current.add(plan.id)
      onConflict(plan)
    }
  }, [
    endpoint,
    isPlanWritePending,
    mergeLocalPlans,
    mergeRemotePlans,
    onConflict,
    requestRemotePlans,
    setPlanWritePending,
  ])

  useEffect(() => {
    if (!endpoint) return
    void synchronize()
    const timer = window.setInterval(() => void synchronize(), 4_000)
    return () => window.clearInterval(timer)
  }, [endpoint, synchronize])

  return { status, synchronize, origin: endpoint ? originForEndpoint(endpoint) : null }
}
