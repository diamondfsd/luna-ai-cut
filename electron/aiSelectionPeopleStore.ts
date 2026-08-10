import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'

export interface AiPersonSourceFace {
  itemId: string
  bounds: { x: number; y: number; width: number; height: number }
}

export interface AiPersonIdentity {
  id: string
  name: string
  samples: number[][]
  avatarDataUrl: string | null
  coverUrl: string | null
  coverBounds: { x: number; y: number; width: number; height: number } | null
  mergedIntoId: string | null
  sourceGroupId: string | null
  sourceFace: AiPersonSourceFace | null
  sourceFaces: AiPersonSourceFace[]
  automaticMatching: boolean
  hidden: boolean
  confirmed: boolean
  createdAt: string
  updatedAt: string
}

interface AiPeopleStore {
  schemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  identities: Array<Omit<AiPersonIdentity, 'coverUrl' | 'coverBounds' | 'mergedIntoId' | 'sourceGroupId' | 'sourceFace' | 'sourceFaces' | 'automaticMatching' | 'hidden' | 'confirmed'> & {
    coverUrl?: string | null
    coverBounds?: { x?: unknown; y?: unknown; width?: unknown; height?: unknown } | null
    mergedIntoId?: string | null
    sourceGroupId?: string | null
    sourceFace?: { itemId?: unknown; bounds?: unknown } | null
    sourceFaces?: Array<{ itemId?: unknown; bounds?: unknown }> | null
    automaticMatching?: boolean
    hidden?: boolean
    confirmed?: boolean
  }>
}

const STORE_FILE = 'people.json'

function validCoverBounds(value: AiPeopleStore['identities'][number]['coverBounds']): AiPersonIdentity['coverBounds'] {
  if (!value || typeof value !== 'object') return null
  const { x, y, width, height } = value
  if (typeof x !== 'number' || !Number.isFinite(x)
    || typeof y !== 'number' || !Number.isFinite(y)
    || typeof width !== 'number' || !Number.isFinite(width)
    || typeof height !== 'number' || !Number.isFinite(height)) return null
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) return null
  return { x, y, width, height }
}

function validSourceFace(value: AiPeopleStore['identities'][number]['sourceFace']): AiPersonIdentity['sourceFace'] {
  if (!value || typeof value !== 'object' || typeof value.itemId !== 'string' || !value.itemId) return null
  const bounds = validCoverBounds(value.bounds as AiPeopleStore['identities'][number]['coverBounds'])
  return bounds ? { itemId: value.itemId, bounds } : null
}

function sameSourceFace(left: AiPersonSourceFace, right: AiPersonSourceFace): boolean {
  return left.itemId === right.itemId
    && Math.abs(left.bounds.x - right.bounds.x) < 0.0001
    && Math.abs(left.bounds.y - right.bounds.y) < 0.0001
}

function validSourceFaces(value: AiPeopleStore['identities'][number]['sourceFaces']): AiPersonSourceFace[] {
  if (!Array.isArray(value)) return []
  const sourceFaces: AiPersonSourceFace[] = []
  for (const candidate of value) {
    const sourceFace = validSourceFace(candidate)
    if (sourceFace && !sourceFaces.some((existing) => sameSourceFace(existing, sourceFace))) sourceFaces.push(sourceFace)
  }
  return sourceFaces
}

export async function loadPeopleStore(rootDir: string): Promise<AiPersonIdentity[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(rootDir, STORE_FILE), 'utf8')) as AiPeopleStore
    if (![1, 2, 3, 4, 5, 6, 7, 8].includes(parsed.schemaVersion) || !Array.isArray(parsed.identities)) return []
    const identities = parsed.identities.filter((identity) => identity.id && identity.name && Array.isArray(identity.samples)).map((identity) => ({
      ...identity,
      avatarDataUrl: typeof identity.avatarDataUrl === 'string' && identity.avatarDataUrl.startsWith('data:image/')
        ? identity.avatarDataUrl
        : null,
      coverUrl: typeof identity.coverUrl === 'string' ? identity.coverUrl : null,
      coverBounds: validCoverBounds(identity.coverBounds),
      mergedIntoId: typeof identity.mergedIntoId === 'string' ? identity.mergedIntoId : null,
      sourceGroupId: typeof identity.sourceGroupId === 'string' ? identity.sourceGroupId : null,
      sourceFace: validSourceFace(identity.sourceFace),
      sourceFaces: validSourceFaces(identity.sourceFaces),
      // Naming a group must not be treated as a request to automatically merge
      // every visually similar person. Existing data starts in the safe mode.
      automaticMatching: identity.automaticMatching === true
        || identity.hidden === true
        || typeof identity.mergedIntoId === 'string',
      hidden: identity.hidden === true,
      // Older versions stored every automatic group globally. Only retain cross-task matching
      // for identities the user has actually confirmed through a person action.
      confirmed: identity.confirmed === true
        || identity.hidden === true
        || typeof identity.mergedIntoId === 'string'
        || !/^人物 \d+$/.test(identity.name)
        || (typeof identity.avatarDataUrl === 'string' && identity.avatarDataUrl.startsWith('data:image/')),
    })).map((identity) => {
      if (identity.sourceFace && !identity.sourceFaces.some((sourceFace) => sameSourceFace(sourceFace, identity.sourceFace!))) {
        identity.sourceFaces.unshift(identity.sourceFace)
      }
      if (!identity.sourceFace) identity.sourceFace = identity.sourceFaces[0] ?? null
      return identity
    })
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
    for (const identity of identities) {
      if (identity.mergedIntoId) rootIdentity(identity, byId).confirmed = true
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
    const store: AiPeopleStore = { schemaVersion: 8, identities }
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

function rootIdentity(identity: AiPersonIdentity, byId: Map<string, AiPersonIdentity>): AiPersonIdentity {
  const seen = new Set([identity.id])
  let current = identity
  while (current.mergedIntoId) {
    if (seen.has(current.mergedIntoId)) break
    const next = byId.get(current.mergedIntoId)
    if (!next) break
    seen.add(next.id)
    current = next
  }
  return current
}

export function createPersonIdentity(
  name: string,
  samples: number[] | number[][],
  sourceGroupId: string | null = null,
  cover: Pick<AiPersonIdentity, 'coverUrl' | 'coverBounds'> = { coverUrl: null, coverBounds: null },
  sourceFace: AiPersonSourceFace | null = null,
): AiPersonIdentity {
  const now = new Date().toISOString()
  const normalized = Array.isArray(samples[0]) ? samples as number[][] : [samples as number[]]
  return {
    id: `person_${randomUUID()}`,
    name,
    samples: normalized.map((sample) => [...sample]),
    avatarDataUrl: null,
    coverUrl: cover.coverUrl,
    coverBounds: cover.coverBounds ? { ...cover.coverBounds } : null,
    mergedIntoId: null,
    sourceGroupId,
    sourceFace: sourceFace ? { itemId: sourceFace.itemId, bounds: { ...sourceFace.bounds } } : null,
    sourceFaces: sourceFace ? [{ itemId: sourceFace.itemId, bounds: { ...sourceFace.bounds } }] : [],
    automaticMatching: false,
    hidden: false,
    confirmed: true,
    createdAt: now,
    updatedAt: now,
  }
}
