export interface RunMarker {
  status: 'running' | 'clean'
  pid: number
  startedAt?: string
  finishedAt?: string
  version?: string
  platform?: string
  arch?: string
}

export function serializeDiagnosticValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value instanceof Error) {
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    const errorWithCause = value as Error & { cause?: unknown }
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      cause: errorWithCause.cause === undefined
        ? undefined
        : serializeDiagnosticValue(errorWithCause.cause, seen),
    }
  }
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'symbol' || typeof value === 'function') return String(value)
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  if (Array.isArray(value)) return value.map((item) => serializeDiagnosticValue(item, seen))
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, serializeDiagnosticValue(item, seen)]),
  )
}

export function isUncleanRunMarker(value: unknown): value is RunMarker {
  if (!value || typeof value !== 'object') return false
  const marker = value as Partial<RunMarker>
  return marker.status === 'running' && typeof marker.pid === 'number'
}

export function isCrashDumpFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.dmp')
}

export function selectCrashDumpFilesToPrune(
  entries: Array<{ name: string; mtimeMs: number }>,
  maxFiles: number,
): string[] {
  return [...entries]
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(Math.max(0, maxFiles))
    .map((entry) => entry.name)
}
