const ARM_ARCHITECTURES = /^(arm|arm64|aarch64)$/i
const X64_ARCHITECTURES = /^(x86|x86_64|x64|amd64)$/i
const APPLE_SILICON_RENDERERS = /apple\s+(?:m\d|gpu)|apple.*(?:m\d|silicon)/i
const INTEL_MAC_RENDERERS = /intel|amd|ati|radeon/i

export function isMacBrowser(browser = navigator) {
  const userAgent = browser.userAgent || ''
  const platform = browser.userAgentData?.platform || browser.platform || ''
  return /macintosh|mac os x/i.test(userAgent) || /mac/i.test(platform)
}

export function readGpuRenderer(pageDocument = document) {
  try {
    const canvas = pageDocument.createElement('canvas')
    const context = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
    if (!context) return ''

    const debugInfo = context.getExtension('WEBGL_debug_renderer_info')
    return debugInfo
      ? context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || ''
      : context.getParameter(context.RENDERER) || ''
  } catch {
    return ''
  }
}

export async function detectMacArchitecture(browser = navigator, renderer = '') {
  const normalizedRenderer = renderer.trim()

  // Apple Silicon browsers retain an Apple GPU renderer even when their
  // compatibility user agent says "Intel".
  if (APPLE_SILICON_RENDERERS.test(normalizedRenderer)) {
    return { chip: 'arm64', confidence: 'high' }
  }

  try {
    const userAgentData = browser.userAgentData
    if (userAgentData && typeof userAgentData.getHighEntropyValues === 'function') {
      const hints = await userAgentData.getHighEntropyValues(['architecture', 'bitness'])
      const architecture = hints.architecture || ''
      if (ARM_ARCHITECTURES.test(architecture)) {
        return { chip: 'arm64', confidence: 'high' }
      }
      if (X64_ARCHITECTURES.test(architecture)) {
        return { chip: 'x64', confidence: 'high' }
      }
    }
  } catch {
    // Privacy settings may deny high-entropy browser hints.
  }

  if (INTEL_MAC_RENDERERS.test(normalizedRenderer)) {
    return { chip: 'x64', confidence: 'high' }
  }

  if (/arm64|aarch64/i.test(browser.userAgent || '')) {
    return { chip: 'arm64', confidence: 'high' }
  }

  // Mac browsers commonly report MacIntel on both architectures. When the
  // browser withholds hardware details, recommend the current Mac default.
  return { chip: 'arm64', confidence: 'recommended' }
}

export async function detectDownloadPlatform(browser = navigator, pageDocument = document) {
  if (!isMacBrowser(browser)) {
    const isWindows = /windows/i.test(browser.userAgent || '') || /win/i.test(browser.platform || '')
    return { platform: isWindows ? 'windows' : 'other', chip: null, confidence: 'high' }
  }

  const renderer = readGpuRenderer(pageDocument)
  const architecture = await detectMacArchitecture(browser, renderer)
  return { platform: 'mac', ...architecture }
}
