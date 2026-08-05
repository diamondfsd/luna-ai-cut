const RELEASE_VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/
const HOT_UPDATE_VERSION = /^v?(\d+)\.(\d+)\.(\d+)-hot\.\d+$/

function releaseBase(match: RegExpMatchArray): string {
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`
}

export function stableReleaseVersion(version: string): string | null {
  const match = version.trim().match(RELEASE_VERSION)
  return match ? releaseBase(match) : null
}

export function hotUpdateBaseVersion(version: string | null): string | null {
  if (!version) return null
  const match = version.trim().match(HOT_UPDATE_VERSION)
  return match ? releaseBase(match) : null
}

/** Hot updates are valid only for the exact stable installer they were built for. */
export function canLoadHotUpdate(appVersion: string, hotVersion: string | null): boolean {
  const stableApp = stableReleaseVersion(appVersion)
  const hotBase = hotUpdateBaseVersion(hotVersion)
  return stableApp !== null && hotBase === stableApp
}
