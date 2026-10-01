import type { WebContents } from 'electron'
import type { DirectorMaterialSyncProgress } from '../../../src/shared/types'

export function createMaterialProgress(sender: WebContents, context: Pick<DirectorMaterialSyncProgress, 'operationId' | 'endpoint' | 'planId'>) {
  let current: DirectorMaterialSyncProgress | null = null
  let lastReported = 0
  function send() {
    if (current && !sender.isDestroyed()) sender.send('director-lab:material-sync-progress', { ...current })
    lastReported = Date.now()
  }
  return {
    queue(takeId: string, fileName: string, direction: 'upload' | 'download', total: number | null) {
      current = { ...context, takeId, fileName, direction, total, transferred: 0, status: 'pending' }
      send()
      current = null
    },
    start(takeId: string, fileName: string, direction: 'upload' | 'download', total: number | null) {
      current = { ...context, takeId, fileName, direction, total, transferred: 0, status: 'transferring' }
      send()
    },
    update(transferred: number, total?: number | null) {
      if (!current) return
      current.transferred = transferred
      if (total !== undefined) current.total = total
      if (Date.now() - lastReported >= 150) send()
    },
    done() {
      if (!current) return
      current.status = 'done'
      current.transferred = current.total ?? current.transferred
      send()
      current = null
    },
    fail() {
      if (!current) return
      current.status = 'failed'
      send()
      current = null
    },
  }
}
