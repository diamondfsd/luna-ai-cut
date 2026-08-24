import { statSync } from 'node:fs'
import path from 'node:path'

const MAX_DRAG_FILES = 500

export function existingDragFiles(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const unique = new Set<string>()
  for (const candidate of value.slice(0, MAX_DRAG_FILES)) {
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) continue
    const normalized = path.normalize(candidate)
    try {
      if (statSync(normalized).isFile()) unique.add(normalized)
    } catch {
      // A removable volume may disappear between selection and drag.
    }
  }
  return [...unique]
}
