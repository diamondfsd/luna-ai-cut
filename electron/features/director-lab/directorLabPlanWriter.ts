import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import type { DirectorLanPlanSummary } from '../../../src/shared/types/directorLab.ts'
import { directorPlanContentSignature } from '../../../src/lib/directorPlanSync.ts'
import { planDirectory, serializePlanWrite, writeDirectorPlanFilesUnlocked } from './directorLabPlanStorage.ts'

export function createDirectorPlanWriter(listPlans: () => Promise<DirectorLanPlanSummary[]>, getRoot: () => Promise<string>) {
  return async function save(plan: DirectorLanPlanSummary, modify: (current: DirectorLanPlanSummary) => DirectorLanPlanSummary,
    beforeCommit?: () => void, mustExist = false): Promise<DirectorLanPlanSummary> {
    if (!plan || typeof plan.id !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(plan.id)
      || typeof plan.title !== 'string' || !Array.isArray(plan.shots)) throw new Error('计划参数无效')
    return serializePlanWrite(async () => {
      const existing = (await listPlans()).find((item) => item.id === plan.id)
      if (mustExist && !existing) throw new Error('本地计划不存在')
      beforeCommit?.()
      const current = existing ?? { ...plan, source: 'local' as const,
        synced_revision: plan.synced_revision ?? plan.revision ?? 0,
        synced_signature: plan.synced_signature ?? directorPlanContentSignature(plan),
        shots: plan.shots.map((shot) => ({ ...shot, takes: shot.takes.map((take) => ({ ...take, available: false })) })) }
      const next = modify(current)
      const root = await getRoot()
      const directory = existing?.local_directory ?? path.join(root, `${planDirectory(plan.title)}_${plan.id}`)
      if (!existing) {
        const entry = await fs.lstat(directory).catch(error => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
          throw error
        })
        if (entry && (!entry.isDirectory() || (await fs.readdir(directory)).length > 0)) {
          throw new Error('计划目录已有内容，请检查后重试')
        }
      }
      beforeCommit?.()
      if (next === current && existing) return existing
      await writeDirectorPlanFilesUnlocked(directory, next, {}, beforeCommit)
      return { ...next, source: 'local', local_directory: directory,
        local_content_signature: directorPlanContentSignature(next) }
    })
  }
}
