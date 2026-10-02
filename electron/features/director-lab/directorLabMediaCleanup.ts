import * as fs from 'node:fs/promises'
import * as path from 'node:path'

interface MediaManifest {
  format?: unknown
  plan_id?: unknown
  shots?: Array<{ media?: Array<{ path?: unknown }> }>
}

function mediaPaths(manifest: MediaManifest): Set<string> {
  return new Set((manifest.shots ?? []).flatMap(shot => (shot.media ?? [])
    .flatMap(media => typeof media.path === 'string' ? [media.path.replace(/\\/g, '/')] : [])))
}

export async function cleanupDirectorMedia(directory: string, previous: MediaManifest | null,
  current: MediaManifest): Promise<void> {
  if (previous?.format !== 'luna-director-plan-v1' || previous.plan_id !== current.plan_id) return
  const retained = mediaPaths(current)
  const entries = await fs.readdir(directory)
  for (const name of entries.filter(name => /^manifest\.conflict-.*\.json$/.test(name))) {
    const backup = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')) as MediaManifest
    for (const mediaPath of mediaPaths(backup)) retained.add(mediaPath)
  }
  const root = await fs.realpath(directory)
  for (const mediaPath of mediaPaths(previous)) {
    if (retained.has(mediaPath)) continue
    const segments = mediaPath.split('/')
    if (segments[0] !== 'media' || segments.length < 3 || segments.some(segment => !segment || segment === '.' || segment === '..')) continue
    const file = path.join(root, ...segments)
    const resolved = await fs.realpath(file).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    })
    if (!resolved || resolved !== file || !(await fs.lstat(file)).isFile()) continue
    await fs.unlink(file)
  }
}
