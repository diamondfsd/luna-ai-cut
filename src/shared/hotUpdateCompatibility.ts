const STABLE_VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/
const BETA_VERSION = /^v?(\d+)\.(\d+)\.(\d+)-beta\.(\d+)$/i
const STABLE_HOT_VERSION = /^v?(\d+)\.(\d+)\.(\d+)-hot\.(\d+)$/i
const BETA_HOT_VERSION = /^v?(\d+)\.(\d+)\.(\d+)-beta\.(\d+)-hot\.(\d+)$/i

export type UpdateChannel = 'stable' | 'beta'
export type BuildChannel = 'stable' | 'test'

export interface ReleaseChannel {
  channel: UpdateChannel
  buildChannel: BuildChannel
  version: string
  baseVersion: string
  releaseTag: string
}

interface ParsedReleaseVersion extends ReleaseChannel {
  betaNumber?: number
}

function baseVersion(match: RegExpMatchArray): string {
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`
}

function parseReleaseVersion(version: string): ParsedReleaseVersion | null {
  const value = version.trim()
  const betaMatch = value.match(BETA_VERSION)
  if (betaMatch) {
    const normalized = `${baseVersion(betaMatch)}-beta.${Number(betaMatch[4])}`
    return {
      channel: 'beta',
      buildChannel: 'stable',
      version: normalized,
      baseVersion: baseVersion(betaMatch),
      releaseTag: `beta/v${normalized}`,
      betaNumber: Number(betaMatch[4]),
    }
  }

  const stableMatch = value.match(STABLE_VERSION)
  if (!stableMatch) return null
  const normalized = baseVersion(stableMatch)
  return {
    channel: 'stable',
    buildChannel: 'stable',
    version: normalized,
    baseVersion: normalized,
    releaseTag: `v${normalized}`,
  }
}

export function releaseChannelForVersion(version: string): ReleaseChannel | null {
  return releaseChannelForBuild(version, 'stable')
}

export function releaseChannelForBuild(version: string, buildChannel: BuildChannel): ReleaseChannel | null {
  const parsed = parseReleaseVersion(version)
  if (!parsed) return null
  return {
    ...parsed,
    buildChannel,
    releaseTag: buildChannel === 'test' ? `test/${parsed.releaseTag}` : parsed.releaseTag,
  }
}

export function stableReleaseVersion(version: string): string | null {
  const parsed = parseReleaseVersion(version)
  return parsed?.channel === 'stable' ? parsed.version : null
}

export function betaReleaseVersion(version: string): string | null {
  const parsed = parseReleaseVersion(version)
  return parsed?.channel === 'beta' ? parsed.version : null
}

/** Parse the channel-specific GitCode tag back to the application version. */
export function releaseVersionFromTag(tag: string): ReleaseChannel | null {
  const rawValue = tag.trim()
  const buildChannel: BuildChannel = rawValue.startsWith('test/') ? 'test' : 'stable'
  const value = buildChannel === 'test' ? rawValue.slice('test/'.length) : rawValue
  if (value.startsWith('beta/v')) {
    const parsed = parseReleaseVersion(value.slice('beta/'.length))
    return parsed?.channel === 'beta' ? { ...parsed, buildChannel, releaseTag: rawValue } : null
  }
  if (value.startsWith('v')) {
    const parsed = parseReleaseVersion(value)
    return parsed?.channel === 'stable' ? { ...parsed, buildChannel, releaseTag: rawValue } : null
  }
  return null
}

function compareCoreVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/** Compare install versions. Stable is newer than a beta of the same base. */
export function compareReleaseVersions(left: string, right: string): number {
  const leftParsed = parseReleaseVersion(left)
  const rightParsed = parseReleaseVersion(right)
  if (!leftParsed || !rightParsed) return left.localeCompare(right, undefined, { numeric: true })

  const coreDifference = compareCoreVersions(leftParsed.baseVersion, rightParsed.baseVersion)
  if (coreDifference !== 0) return coreDifference
  if (leftParsed.channel !== rightParsed.channel) return leftParsed.channel === 'stable' ? 1 : -1
  return (leftParsed.betaNumber ?? 0) - (rightParsed.betaNumber ?? 0)
}

function hotUpdateParts(version: string): { baseVersion: string; build: number } | null {
  const value = version.trim()
  const betaMatch = value.match(BETA_HOT_VERSION)
  if (betaMatch) {
    return {
      baseVersion: `${baseVersion(betaMatch)}-beta.${Number(betaMatch[4])}`,
      build: Number(betaMatch[5]),
    }
  }
  const stableMatch = value.match(STABLE_HOT_VERSION)
  if (!stableMatch) return null
  return { baseVersion: baseVersion(stableMatch), build: Number(stableMatch[4]) }
}

export function hotUpdateBaseVersion(version: string | null): string | null {
  if (!version) return null
  return hotUpdateParts(version)?.baseVersion ?? null
}

export function hotUpdateBuildNumber(version: string): number | null {
  return hotUpdateParts(version)?.build ?? null
}

export function compareHotUpdateVersions(left: string, right: string): number {
  const leftParsed = hotUpdateParts(left)
  const rightParsed = hotUpdateParts(right)
  if (!leftParsed || !rightParsed) return left.localeCompare(right, undefined, { numeric: true })
  const baseDifference = compareReleaseVersions(leftParsed.baseVersion, rightParsed.baseVersion)
  return baseDifference !== 0 ? baseDifference : leftParsed.build - rightParsed.build
}

/** Hot updates are valid only for the exact installer and update channel they target. */
export function canLoadHotUpdate(appVersion: string, hotVersion: string | null): boolean {
  const appRelease = parseReleaseVersion(appVersion)
  const hotBase = hotUpdateBaseVersion(hotVersion)
  return appRelease !== null && hotBase === appRelease.version
}
