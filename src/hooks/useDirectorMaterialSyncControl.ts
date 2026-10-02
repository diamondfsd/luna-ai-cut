import { useState } from 'react'
import type { DirectorLanPlanSummary } from '../shared/types'
import { useDirectorMaterialSync } from './useDirectorMaterialSync'

export function useDirectorMaterialSyncControl(active: boolean, endpoint: string | null, refresh: (plans: DirectorLanPlanSummary[]) => void) {
  const [enabled, setEnabled] = useState(() => localStorage.getItem('luna.director-lab.sync-materials') === 'true')
  const progress = useDirectorMaterialSync(active, enabled, endpoint, refresh)
  function onEnabledChange(checked: boolean) {
    localStorage.setItem('luna.director-lab.sync-materials', String(checked))
    setEnabled(checked)
  }
  return { enabled, onEnabledChange, progress }
}
