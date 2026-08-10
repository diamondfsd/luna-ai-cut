import { useEffect, useState } from 'react'

import type { AppSettings, StorageMigrationResult } from '../shared/types'
import { Alert, Button, Dialog, toast } from '../ui'
import '../styles/storage-migration.css'

interface StorageMigrationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: AppSettings | null
  onMigrated: (settings: AppSettings) => void
}

export function StorageMigrationDialog({
  open,
  onOpenChange,
  settings,
  onMigrated,
}: StorageMigrationDialogProps) {
  const [migrating, setMigrating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<StorageMigrationResult | null>(null)

  useEffect(() => {
    if (open) return
    setError(null)
    setResult(null)
  }, [open])

  async function handleMigrate(): Promise<void> {
    if (!settings || migrating) return
    setMigrating(true)
    setError(null)
    try {
      const next = await window.luna.migrateLocalStorage()
      if (!next) return
      onMigrated(next.settings)
      setResult(next)
      if (next.oldDataRemoved) {
        onOpenChange(false)
        toast.success('本地存储已迁移')
      }
    } catch (migrationError) {
      setError(migrationError instanceof Error ? migrationError.message : '迁移未完成，请稍后重试')
    } finally {
      setMigrating(false)
    }
  }

  const completedWithOldData = Boolean(result && !result.oldDataRemoved)

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={completedWithOldData ? '已迁移到新位置' : '迁移本地存储'}
      description={completedWithOldData
        ? '新位置已经开始使用，但旧位置仍保留了部分内容。'
        : '已下载素材、项目、LUT 和导出内容会一起迁移到新的位置。'}
      className="storage-migration-dialog"
      closeOnMaskClick={!migrating}
      footer={completedWithOldData ? (
        <Button variant="primary" onClick={() => onOpenChange(false)}>关闭</Button>
      ) : (
        <>
          <Button variant="secondary" disabled={migrating} onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="primary" disabled={!settings || migrating} onClick={() => void handleMigrate()}>
            {migrating ? '迁移中' : '选择位置并迁移'}
          </Button>
        </>
      )}
    >
      <div className="storage-migration-dialog-body">
        <div className="storage-migration-location">
          <span>当前位置</span>
          <strong title={settings?.baseDir}>{settings?.baseDir || '正在读取'}</strong>
        </div>
        <p>迁移期间请保持应用打开，并暂时不要下载或导出内容。</p>
        {error && <Alert variant="error" message={error} />}
        {completedWithOldData && (
          <Alert variant="warning" message="旧位置中的部分内容暂时无法清理。请关闭可能正在使用这些内容的程序后，再手动清理旧位置。" />
        )}
      </div>
    </Dialog>
  )
}
