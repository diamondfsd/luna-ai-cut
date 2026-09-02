export const BUILD_DEPENDENCY_RELEASE_VERSION = '1.0.0'
export const BUILD_DEPENDENCY_RELEASE_TAG = `build-dependencies-v${BUILD_DEPENDENCY_RELEASE_VERSION}`
export const BUILD_DEPENDENCY_OWNER = 'diamondfsd'
export const BUILD_DEPENDENCY_REPO = 'luna-ai-cut-package-release'
export const BUILD_DEPENDENCY_DOWNLOAD_BASE = `https://gitcode.com/${BUILD_DEPENDENCY_OWNER}/${BUILD_DEPENDENCY_REPO}/releases/download/${BUILD_DEPENDENCY_RELEASE_TAG}`

export function isGitHubActionsBuild() {
  return process.env.GITHUB_ACTIONS?.toLowerCase() === 'true'
}

export function buildDependencyUrl(fileName, upstreamUrl) {
  if (isGitHubActionsBuild()) return upstreamUrl
  return `${BUILD_DEPENDENCY_DOWNLOAD_BASE}/${encodeURIComponent(fileName)}`
}
