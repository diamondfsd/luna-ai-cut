import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'

export interface AiPersonIdentity {
  id: string
  name: string
  samples: number[][]
  createdAt: string
  updatedAt: string
}

interface AiPeopleStore {
  schemaVersion: 1
  identities: AiPersonIdentity[]
}

const STORE_FILE = 'people.json'
const MAX_SAMPLES_PER_IDENTITY = 32

export async function loadPeopleStore(rootDir: string): Promise<AiPersonIdentity[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(rootDir, STORE_FILE), 'utf8')) as AiPeopleStore
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.identities)) return []
    return parsed.identities.filter((identity) => identity.id && identity.name && Array.isArray(identity.samples))
  } catch {
    return []
  }
}

export async function savePeopleStore(rootDir: string, identities: AiPersonIdentity[]): Promise<void> {
  await fs.mkdir(rootDir, { recursive: true })
  const destination = path.join(rootDir, STORE_FILE)
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`
  try {
    const store: AiPeopleStore = { schemaVersion: 1, identities }
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
  return { id: `person_${randomUUID()}`, name, samples: [[...sample]], createdAt: now, updatedAt: now }
}

export function mergeIdentitySamples(target: AiPersonIdentity, samples: number[][]): void {
  const unique = new Map([...target.samples, ...samples].map((sample) => [sample.join(','), sample]))
  target.samples = [...unique.values()].slice(-MAX_SAMPLES_PER_IDENTITY)
  target.updatedAt = new Date().toISOString()
}
