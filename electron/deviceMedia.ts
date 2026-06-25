import type { LunaFile, MediaKind } from '../src/shared/types'

export interface DeviceMediaAdapter {
  extensionOf(name: string): string
  mediaKind(name: string): MediaKind
  capturedAt(name: string): Date | null
  videoKey(name: string): string | null
  livePhotoKey(name: string): string | null
  downloadName(name: string): string
  canPreview(file: Pick<LunaFile, 'kind' | 'previewUrl'>): boolean
  attachRelatedFiles(files: LunaFile[]): LunaFile[]
}

const LUNA_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'dng', 'insp', 'webp'])
const LUNA_VIDEO_EXTENSIONS = new Set(['mp4', 'mov'])

export const lunaMediaAdapter: DeviceMediaAdapter = {
  extensionOf(name: string): string {
    const index = name.lastIndexOf('.')
    return index >= 0 ? name.slice(index + 1).toLowerCase() : ''
  },

  mediaKind(name: string): MediaKind {
    const extension = this.extensionOf(name)
    if (extension === 'lrv') return 'lrv'
    if (LUNA_IMAGE_EXTENSIONS.has(extension)) return 'image'
    if (LUNA_VIDEO_EXTENSIONS.has(extension)) return 'video'
    return 'unknown'
  },

  capturedAt(name: string): Date | null {
    const match = name.match(/(?:VID|LRV|IMG|LIV|PIC|PANO)_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/i)
    if (!match) return null

    const [, year, month, day, hour, minute, second] = match
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    )
  },

  videoKey(name: string): string | null {
    const match = name.match(/^(?:VID|LRV|LIV)_(.+)\.(?:mp4|mov|lrv)$/i)
    return match ? match[1] : null
  },

  livePhotoKey(name: string): string | null {
    const match = name.match(/^LIV_(.+)\.(?:jpe?g|png|webp|dng|insp)$/i)
    return match ? match[1] : null
  },

  downloadName(name: string): string {
    if (/^LRV_(.+)\.lrv$/i.test(name)) {
      return name.replace(/^LRV_/i, 'VID_').replace(/\.lrv$/i, '.mp4')
    }
    return name
  },

  canPreview(file: Pick<LunaFile, 'kind' | 'previewUrl'>): boolean {
    return file.kind === 'image' || file.kind === 'lrv' || Boolean(file.previewUrl)
  },

  attachRelatedFiles(files: LunaFile[]): LunaFile[] {
    const previewByKey = new Map<string, Pick<LunaFile, 'name' | 'url' | 'sourceUrl' | 'downloadFilePath' | 'localPath'>>()
    const videoByKey = new Map<string, Pick<LunaFile, 'name' | 'url' | 'sourceUrl' | 'downloadFilePath' | 'localPath'>>()

    for (const file of files) {
      if (file.kind === 'lrv' && file.videoKey) {
        previewByKey.set(file.videoKey, file)
      }
      if (file.kind === 'video' && file.videoKey) {
        videoByKey.set(file.videoKey, file)
      }
    }

    return files
      .filter((file) => file.kind !== 'lrv')
      .map((file) => {
        const preview = file.kind === 'video' && file.videoKey ? previewByKey.get(file.videoKey) : null
        const livePhotoKey = this.livePhotoKey(file.name)
        const liveVideo = livePhotoKey ? previewByKey.get(livePhotoKey) ?? videoByKey.get(livePhotoKey) ?? null : null
        return {
          ...file,
          previewName: preview?.name ?? null,
          previewUrl: preview?.url ?? null,
          isLivePhoto: Boolean(livePhotoKey),
          livePhotoVideoName: liveVideo?.name ?? null,
          livePhotoVideoUrl: liveVideo?.sourceUrl ?? liveVideo?.url ?? null,
          livePhotoCacheFilePath: liveVideo?.downloadFilePath ?? liveVideo?.localPath ?? null,
          canPreview: file.kind === 'image' || Boolean(preview) || file.kind === 'video',
        }
      })
      .sort((a, b) => {
        const aTime = a.capturedAt ? Date.parse(a.capturedAt) : 0
        const bTime = b.capturedAt ? Date.parse(b.capturedAt) : 0
        return bTime - aTime || a.name.localeCompare(b.name)
      })
  },
}
