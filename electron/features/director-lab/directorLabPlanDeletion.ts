import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { serializePlanWrite } from './directorLabPlanStorage.ts'

export async function reconcileDirectorPlanDeletions(
  rootDirectory: string,
  endpoint: string,
  remotePlanIds: string[],
): Promise<string[]> {
  if (typeof endpoint !== 'string' || !Array.isArray(remotePlanIds)
    || remotePlanIds.some((id) => typeof id !== 'string' || !id.trim())) {
    throw new Error('计划同步数据无效')
  }
  const service = new URL(endpoint)
  if (service.protocol !== 'http:' && service.protocol !== 'https:') {
    throw new Error('手机地址无效')
  }
  const origin = service.origin
  const remoteIds = new Set(remotePlanIds)
  return serializePlanWrite(async () => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(rootDirectory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const removed: string[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const manifestPath = path.join(rootDirectory, entry.name, 'manifest.json')
      let manifest: Record<string, unknown>
      try {
        manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
      } catch (error) {
        if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      if (!manifest || manifest.format !== 'luna-director-plan-v1'
        || typeof manifest.plan_id !== 'string' || !Array.isArray(manifest.shots)
        || manifest.pending_create === true || manifest.remote_deleted === true
        || typeof manifest.synced_signature !== 'string'
        || (typeof manifest.remote_origin === 'string' && manifest.remote_origin !== origin)) continue
      const deleted = !remoteIds.has(manifest.plan_id)
      if (!deleted && manifest.remote_origin === origin) continue
      const next = { ...manifest, remote_origin: origin,
        ...(deleted ? { remote_deleted: true, remote_deleted_at: new Date().toISOString() } : {}) }
      const temporaryPath = `${manifestPath}.${randomUUID()}.tmp`
      try {
        await fs.writeFile(temporaryPath, JSON.stringify(next, null, 2), 'utf8')
        await fs.rename(temporaryPath, manifestPath)
      } finally {
        await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
      }
      if (deleted) removed.push(manifest.plan_id)
    }
    return removed
  })
}
