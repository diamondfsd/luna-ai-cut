import { useCallback, useState } from 'react'

import type { AppSettings, StorageMigrationResult } from '../shared/types'
import { toast } from '../ui'

export function useStorageMigration(
  settings: AppSettings | null,
  onMigrated: (settings: AppSettings) => void,
) {
  const [migrating, setMigrating] = useState(false)
  const [migrationResult, setMigrationResult] = useState<StorageMigrationResult | null>(null)
  const [restarting, setRestarting] = useState(false)

  const migrate = useCallback(async (): Promise<void> => {
    if (!settings || migrating) return
    setMigrationResult(null)
    setMigrating(true)
    try {
      const result = await window.luna.migrateLocalStorage()
      if (!result) return
      onMigrated(result.settings)
      setMigrationResult(result)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '迁移未完成，请稍后重试')
    } finally {
      setMigrating(false)
    }
  }, [migrating, onMigrated, settings])

  const restart = useCallback((): void => {
    if (!migrationResult || restarting) return
    setRestarting(true)
    void window.luna.relaunchApp()
  }, [migrationResult, restarting])

  return { migrating, migrationResult, restarting, migrate, restart }
}
