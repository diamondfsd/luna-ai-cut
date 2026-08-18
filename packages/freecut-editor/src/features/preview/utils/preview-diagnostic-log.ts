/**
 * Low-volume preview diagnostics for reproducing transport-specific render
 * failures. The Electron preload forwards these records to the renderer log
 * file, while browser-only development keeps them harmlessly local.
 */

// A short manual reproduction can cross 800 frame/path events before the
// relevant transition is reached. Keep the cap bounded, but large enough to
// retain one complete playback + scrub reproduction.
const MAX_DIAGNOSTIC_EVENTS = 4000

let diagnosticEventCount = 0
let lastDedupKey = ''
let lastDedupAt = 0

function getElectronLogger():
  | ((level: string, message: string, meta?: unknown) => void)
  | null {
  if (typeof window === 'undefined') return null
  const luna = (window as unknown as {
    luna?: { log?: (level: string, message: string, meta?: unknown) => void }
  }).luna
  return typeof luna?.log === 'function' ? luna.log.bind(luna) : null
}

export function logPreviewDiagnostic(
  event: string,
  data: Record<string, unknown>,
  options: { dedupKey?: string; minIntervalMs?: number } = {},
): void {
  if (!import.meta.env.DEV || diagnosticEventCount >= MAX_DIAGNOSTIC_EVENTS) return

  const now = performance.now()
  const dedupKey = options.dedupKey
  const minIntervalMs = options.minIntervalMs ?? 0
  if (dedupKey && dedupKey === lastDedupKey && now - lastDedupAt < minIntervalMs) {
    return
  }

  const log = getElectronLogger()
  if (!log) return

  diagnosticEventCount += 1
  lastDedupKey = dedupKey ?? ''
  lastDedupAt = now
  try {
    log('debug', `[PreviewDiagnostic] ${event}`, {
      ...data,
      performanceMs: Math.round(now),
    })
  } catch {
    // Diagnostics must never affect preview rendering.
  }
}

export function resetPreviewDiagnosticLog(): void {
  diagnosticEventCount = 0
  lastDedupKey = ''
  lastDedupAt = 0
}
