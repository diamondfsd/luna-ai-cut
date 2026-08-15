import { CheckCircle2, RefreshCw } from 'lucide-react'

import type { StorageMigrationResult } from '../shared/types'
import { Button, Dialog, LoadingIndicator } from '../ui'
import './StorageMigrationDialog.css'

interface StorageMigrationDialogProps {
  migrating: boolean
  result: StorageMigrationResult | null
  restarting: boolean
  onRestart: () => void
}

export function StorageMigrationDialog({
  migrating,
  result,
  restarting,
  onRestart,
}: StorageMigrationDialogProps) {
  const open = migrating || Boolean(result)

  return (
    <Dialog
      open={open}
      onOpenChange={() => undefined}
      closeOnMaskClick={false}
      showCloseButton={false}
      title={migrating ? '正在迁移本地存储' : '迁移完成'}
      description={migrating
        ? '正在移动项目和本地内容，完成前应用将暂时无法操作。'
        : '重新启动后，应用将从新的位置读取项目和本地内容。'}
      className="storage-migration-dialog"
      footer={result ? (
        <Button
          variant="primary"
          disabled={restarting}
          icon={<RefreshCw className={restarting ? 'spin' : undefined} size={16} />}
          onClick={onRestart}
        >
          {restarting ? '正在重启' : '重启应用'}
        </Button>
      ) : undefined}
    >
      <div className="storage-migration-dialog-body" role="status" aria-live="polite">
        {migrating ? (
          <LoadingIndicator size="large" label="正在迁移，请稍候" />
        ) : result ? (
          <>
            <CheckCircle2 className="storage-migration-dialog-success" size={34} aria-hidden="true" />
            <div>
              <strong>{result.oldDataRemoved ? '所有内容已迁移' : '新位置已经可以使用'}</strong>
              <span>{result.targetDir}</span>
              {!result.oldDataRemoved && <p>旧位置仍有部分内容未能清理，可在重启后手动处理。</p>}
            </div>
          </>
        ) : null}
      </div>
    </Dialog>
  )
}
