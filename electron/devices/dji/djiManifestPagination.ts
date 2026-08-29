import type { DjiManifestFile } from './djiManifest'

export const DJI_MANIFEST_PAGE_SIZE = 45
export const DJI_VIDEO_HANDLE_BASE = 0x40000000

type ManifestPageFile = Pick<DjiManifestFile, 'path' | 'handle' | 'storageId'>

export function manifestFileKey(file: ManifestPageFile): string {
  return `${file.storageId}:${file.path}`
}

export function seedManifestCursor(files: readonly ManifestPageFile[]): number {
  return files
    .map((file) => file.handle)
    .filter((handle) => handle >= DJI_VIDEO_HANDLE_BASE)
    .reduce<number | null>((oldest, handle) => oldest === null ? handle : Math.min(oldest, handle), null) ?? 0
}

export function olderManifestCursor(
  cursor: number,
  files: readonly ManifestPageFile[],
): number | null {
  return files
    .map((file) => file.handle)
    .filter((handle) => handle >= DJI_VIDEO_HANDLE_BASE && handle < cursor)
    .reduce<number | null>((oldest, handle) => oldest === null ? handle : Math.min(oldest, handle), null)
}

export function hasManifestPageAfter(pageSize: number, cursor: number): boolean {
  return cursor > 0 && pageSize >= DJI_MANIFEST_PAGE_SIZE
}

export interface ManifestPageStep {
  fresh: DjiManifestFile[]
  nextCursor: number
  moreAvailable: boolean
}

export function stepManifestPage(
  cursor: number,
  files: readonly DjiManifestFile[],
  seen: Set<string>,
): ManifestPageStep {
  const fresh = files.filter((file) => {
    const key = manifestFileKey(file)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const nextCursor = olderManifestCursor(cursor, files)
  return {
    fresh,
    nextCursor: nextCursor ?? cursor,
    moreAvailable: nextCursor !== null && fresh.length > 0,
  }
}
