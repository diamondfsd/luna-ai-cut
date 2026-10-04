/** Process-local bounded cache. Keys include current source identity, time and output width. */
const entries = new Map<string, { value: string; expiresAt: number }>()
const MAX_BYTES = 32 * 1024 * 1024
const MAX_AGE_MS = 24 * 60 * 60 * 1000
let bytes = 0

export function getCachedInspectionFrame(key: string) {
  const entry = entries.get(key)
  if (!entry) return undefined
  entries.delete(key)
  if (entry.expiresAt <= Date.now()) { bytes -= entry.value.length; return undefined }
  entries.set(key, entry)
  return entry.value
}

export function cacheInspectionFrame(key: string, value: string) {
  const previous = entries.get(key)
  if (previous) { bytes -= previous.value.length; entries.delete(key) }
  if (value.length > MAX_BYTES) return
  entries.set(key, { value, expiresAt: Date.now() + MAX_AGE_MS })
  bytes += value.length
  while (bytes > MAX_BYTES) {
    const oldest = entries.keys().next().value!
    bytes -= entries.get(oldest)!.value.length
    entries.delete(oldest)
  }
}
