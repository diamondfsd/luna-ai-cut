import { useEffect, useRef, useState } from 'react'
import type { DirectorLanPlanSummary, DirectorMaterialSyncProgress } from '../shared/types'
import { toast } from '../ui/toast'

export function useDirectorMaterialSync(active: boolean, enabled: boolean, endpoint: string | null,
  refresh: (plans: DirectorLanPlanSummary[]) => void) {
  const running = useRef(false)
  const [progress, setProgress] = useState<DirectorMaterialSyncProgress[]>([])
  useEffect(() => {
    setProgress([])
    if (!active) return
    let disposed = false
    let failureNotified = false
    const operations = new Map<string, string>()
    const unsubscribe = window.luna.directorLab.onMaterialSyncProgress((update) => {
      if (disposed || !enabled || update.endpoint !== endpoint || operations.get(update.planId) !== update.operationId) return
      setProgress((current) => {
        const index = current.findIndex(item => item.planId === update.planId && item.takeId === update.takeId && item.direction === update.direction)
        return index < 0 ? [...current, update] : current.map((item, itemIndex) => itemIndex === index ? update : item)
      })
    })
    function notifyFailure(error: unknown) {
      if (disposed || !enabled || !endpoint || failureNotified) return
      failureNotified = true
      window.luna.log('ERROR', '素材同步失败', {
        endpoint,
        error: error instanceof Error ? error.message : String(error),
      })
      toast.error('素材同步失败')
    }
    async function synchronize() {
      if (running.current || disposed) return
      running.current = true
      try {
        const plans = await window.luna.directorLab.listLocalPlans()
        if (!disposed) refresh(plans)
        if (enabled && endpoint) {
          let failed = false
          for (const plan of plans) {
            if (disposed) break
            const operationId = crypto.randomUUID()
            operations.set(plan.id, operationId)
            try {
              await window.luna.directorLab.syncMaterials(endpoint, plan.id, operationId)
            } catch (error) {
              failed = true
              notifyFailure(error)
            }
          }
          if (!disposed) refresh(await window.luna.directorLab.listLocalPlans())
          if (!disposed && !failed) failureNotified = false
        }
      } catch (error) {
        notifyFailure(error)
      } finally { running.current = false }
    }
    void synchronize().catch(() => undefined)
    const timer = window.setInterval(() => void synchronize().catch(() => undefined), 4000)
    const onFocus = () => void synchronize().catch(() => undefined)
    window.addEventListener('focus', onFocus)
    return () => { disposed = true; unsubscribe(); window.clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [active, enabled, endpoint, refresh])
  return progress
}
