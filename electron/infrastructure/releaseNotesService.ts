import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const FILE_PREFIX = 'RELEASE_NOTES_v'
const FILE_SUFFIX = '.md'

export interface ReleaseNoteItem {
  version: string
  content: string
}

function versionParts(version: string): number[] {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(hot|rc|beta)\.?([0-9]+))?$/i)
  if (!match) return []
  const channelRank = match[4]?.toLowerCase() === 'hot'
    ? 3
    : match[4]?.toLowerCase() === 'rc'
      ? 1
      : match[4]?.toLowerCase() === 'beta'
        ? 0
        : 2
  return [Number(match[1]), Number(match[2]), Number(match[3]), channelRank, Number(match[5] ?? 0)]
}

function compareVersionsDescending(left: string, right: string): number {
  const leftParts = versionParts(left)
  const rightParts = versionParts(right)
  if (leftParts.length === 0 || rightParts.length === 0) {
    return right.localeCompare(left, undefined, { numeric: true })
  }
  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = rightParts[index] - leftParts[index]
    if (difference !== 0) return difference
  }
  return 0
}

export function listReleaseNotes(searchRoots: string[]): ReleaseNoteItem[] {
  const notesByVersion = new Map<string, ReleaseNoteItem>()

  for (const root of searchRoots) {
    for (const directory of [root, join(root, 'old-release-log')]) {
      if (!existsSync(directory)) continue
      for (const file of readdirSync(directory)) {
        if (!file.startsWith(FILE_PREFIX) || !file.endsWith(FILE_SUFFIX)) continue
        const version = file.slice(FILE_PREFIX.length, -FILE_SUFFIX.length)
        if (notesByVersion.has(version)) continue
        notesByVersion.set(version, {
          version,
          content: readFileSync(join(directory, file), 'utf8'),
        })
      }
    }
  }

  return [...notesByVersion.values()].sort((left, right) => (
    compareVersionsDescending(left.version, right.version)
  ))
}
