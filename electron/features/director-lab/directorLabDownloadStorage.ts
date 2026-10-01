import { pathToFileURL } from 'node:url'
import type { DirectorLabMediaMetadata, DirectorLanPlanSummary } from '../../../src/shared/types'
import { serializePlanWrite, writeDirectorPlanFilesUnlocked } from './directorLabPlanStorage.ts'

export async function persistDirectorDownloads(directory: string, incoming: DirectorLanPlanSummary,
  files: Map<string, string>, metadata: Record<string, DirectorLabMediaMetadata>,
  readPlans: () => Promise<DirectorLanPlanSummary[]>) {
  await serializePlanWrite(async () => {
    const existing = (await readPlans()).find((plan) => plan.id === incoming.id)
    const base = existing ?? incoming
    const shots = base.shots.map((shot) => {
      const takes = shot.takes.map((take) => {
        const downloaded = files.get(take.id)
        return downloaded ? { ...take, available: true, stream_url: pathToFileURL(downloaded).toString() }
          : existing ? take : { ...take, available: false }
      })
      for (const take of incoming.shots.find((item) => item.id === shot.id)?.takes ?? []) {
        const downloaded = files.get(take.id)
        if (downloaded && !takes.some((item) => item.id === take.id)) {
          takes.push({ ...take, available: true, stream_url: pathToFileURL(downloaded).toString() })
        }
      }
      return { ...shot, takes }
    })
    await writeDirectorPlanFilesUnlocked(existing?.local_directory ?? directory, { ...base, shots }, metadata)
  })
}
