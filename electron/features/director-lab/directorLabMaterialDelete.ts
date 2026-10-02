import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import type { DirectorLanPlanSummary } from '../../../src/shared/types/directorLab'

export async function deleteDirectorLocalMaterial(plan: DirectorLanPlanSummary, takeId: string,
  persist: (plan: DirectorLanPlanSummary) => Promise<void>): Promise<DirectorLanPlanSummary> {
  const take = plan.shots.flatMap(shot => shot.takes).find(take => take.id === takeId)
  if (!plan.local_directory || !take?.stream_url?.startsWith('file:')) throw new Error('只能删除计划中的本地素材')
  const directory = await fs.realpath(plan.local_directory)
  const file = fileURLToPath(take.stream_url)
  const resolved = await fs.realpath(file).catch(async error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      const parent = await fs.realpath(path.dirname(file)).catch(parentError => {
        if ((parentError as NodeJS.ErrnoException).code !== 'ENOENT') throw parentError
        return path.resolve(directory, path.relative(path.resolve(plan.local_directory!), path.dirname(file)))
      })
      return path.join(parent, path.basename(file))
    }
    throw error
  })
  const relative = path.relative(directory, resolved)
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)
    || relative.split(path.sep).length < 2) throw new Error('素材不在计划素材目录中')
  const next: DirectorLanPlanSummary = { ...plan,
    deleted_local_take_ids: [...new Set([...plan.deleted_local_take_ids ?? [], takeId])],
    pending_take_ids: plan.pending_take_ids?.filter(id => id !== takeId),
    shots: plan.shots.map(shot => ({ ...shot, takes: shot.takes.map(item => item.id === takeId
      ? { ...item, available: false, stream_url: null, download_url: null, stream_path: null, download_path: null } : item),
      completed_takes: shot.takes.filter(item => item.id !== takeId && item.available).length })),
  }
  next.completed_shot_count = next.shots.filter(shot => shot.completed_takes > 0).length
  const staged = `${file}.deleting-${randomUUID()}`
  let moved = false
  try {
    await fs.rename(file, staged)
    moved = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  try {
    await persist(next)
  } catch (error) {
    if (moved) await fs.rename(staged, file)
    throw error
  }
  if (moved) await fs.rm(staged, { force: true })
  return next
}
