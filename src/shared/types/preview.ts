import type { MediaKind } from './media'

export interface PreviewResult {
  fileName: string
  kind: MediaKind
  source: string | null
  cachedPath: string | null
  message?: string
}

export interface MetadataEntry {
  key: string
  value: string
}

export interface MetadataGroup {
  name: string
  entries: MetadataEntry[]
}

export interface MediaMetadata {
  groups: MetadataGroup[]
}
