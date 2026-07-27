import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'

export interface AiPersonIdentity {
  id: string
  name: string
  samples: number[][]
  avatarDataUrl: string | null
  mergedIntoId: string | null
  createdAt: string
  updatedAt: string
}

interface AiPeopleStore {
  schemaVersion: 1 | 2
  identities: Array<Omit<AiPersonIdentity, 'mergedIntoId'> & { mergedIntoId?: string | null }>
}

const STORE_FILE = 'people.json'

export async function loadPeopleStore(rootDir: string): Promise<AiPersonIdentity[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(rootDir, STORE_FILE), 'utf8')) as AiPeopleStore
    if (![1, 2].includes(parsed.schemaVersion) || !Array.isArray(parsed.identities)) return []
    const identities = parsed.identities.filter((identity) => identity.id && identity.name && Array.isArray(identity.samples)).map((identity) => ({
      ...identity,
      avatarDataUrl: typeof identity.avatarDataUrl === 'string' && identity.avatarDataUrl.startsWith('data:image/')
        ? identity.avatarDataUrl
        : null,
      mergedIntoId: typeof identity.mergedIntoId === 'string' ? identity.mergedIntoId : null,
    }))
    const byId = new Map(identities.map((identity) => [identity.id, identity]))
    for (const identity of identities) {
      if (!identity.mergedIntoId || identity.mergedIntoId === identity.id || !byId.has(identity.mergedIntoId)) {
        identity.mergedIntoId = null
        continue
      }
      const seen = new Set([identity.id])
      let current = identity
      while (current.mergedIntoId) {
        if (seen.has(current.mergedIntoId)) { identity.mergedIntoId = null; break }
        seen.add(current.mergedIntoId)
        const next = byId.get(current.mergedIntoId)
        if (!next) { identity.mergedIntoId = null; break }
        current = next
      }
    }
    return identities
  } catch {
    return []
  }
}

export async function savePeopleStore(rootDir: string, identities: AiPersonIdentity[]): Promise<void> {
  await fs.mkdir(rootDir, { recursive: true })
  const destination = path.join(rootDir, STORE_FILE)
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`
  try {
    const store: AiPeopleStore = { schemaVersion: 2, identities }
    await fs.writeFile(temporary, `${JSON.stringify(store)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    try {
      await fs.rename(temporary, destination)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EACCES' && code !== 'EEXIST' && code !== 'EPERM') throw error
      await fs.rm(destination, { force: true })
      await fs.rename(temporary, destination)
    }
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
  }
}

export function createPersonIdentity(name: string, sample: number[]): AiPersonIdentity {
  const now = new Date().toISOString()
  return { id: `person_${randomUUID()}`, name, samples: [[...sample]], avatarDataUrl: null, mergedIntoId: null, createdAt: now, updatedAt: now }
}
