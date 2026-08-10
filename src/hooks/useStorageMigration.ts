import { useCallback, useState } from 'react'

import type { AppSettings } from '../shared/types'
import { toast } from '../ui'

export function useStorageMigration(
  settings: AppSettings | null,
  onMigrated: (settings: AppSettings) => void,
) {
  const [migrating, setMigrating] = useState(false)

  const migrate = useCallback(async (): Promise<void> => {
    if (!settings || migrating) return
    setMigrating(true)
    try {
      const result = await window.luna.migrateLocalStorage()
      if (!result) return
      onMigrated(result.settings)
      if (result.oldDataRemoved) toast.success('本地存储已迁移')
      else toast.error('新位置已经开始使用，但旧位置还有部分内容未能清理')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '迁移未完成，请稍后重试')
    } finally {
      setMigrating(false)
    }
  }, [migrating, onMigrated, settings])

  return { migrating, migrate }
}
