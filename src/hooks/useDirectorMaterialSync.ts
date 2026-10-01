import { useEffect, useRef } from 'react'
import type { DirectorLanPlanSummary } from '../shared/types'

export function useDirectorMaterialSync(active: boolean, enabled: boolean, endpoint: string | null,
  refresh: (plans: DirectorLanPlanSummary[]) => void) {
  const running = useRef(false)
  useEffect(() => {
    if (!active) return
    let disposed = false
    async function synchronize() {
      if (running.current || disposed) return
      running.current = true
      try {
        const plans = await window.luna.directorLab.listLocalPlans()
        if (!disposed) refresh(plans)
        if (enabled && endpoint) {
          for (const plan of plans) {
            if (disposed) break
            await window.luna.directorLab.syncMaterials(endpoint, plan.id).catch(() => undefined)
          }
          if (!disposed) refresh(await window.luna.directorLab.listLocalPlans())
        }
      } finally { running.current = false }
    }
    void synchronize().catch(() => undefined)
    const timer = window.setInterval(() => void synchronize().catch(() => undefined), 4000)
    const onFocus = () => void synchronize().catch(() => undefined)
    window.addEventListener('focus', onFocus)
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [active, enabled, endpoint, refresh])
}
