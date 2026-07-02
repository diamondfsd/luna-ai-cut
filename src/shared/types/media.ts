export type MediaKind = 'image' | 'video' | 'lrv' | 'unknown'

export interface LunaFile {
  id: string
  storageId?: string
  storageLabel?: string
  sourceDeviceId?: string
  sourceDeviceName?: string
  cameraType?: string
  cameraSerial?: string
  watermarkProfileId?: string
  name: string
  href: string
  sourceUrl: string
  url: string
  dateText: string
  timeText: string
  sizeText: string
  bytes: number | null
  kind: MediaKind
  extension: string
  capturedAt: string | null
  groupDay: string
  groupHour: string
  videoKey: string | null
  previewName: string | null
  previewUrl: string | null
  cacheFilePath: string | null
  downloadFilePath: string | null
  thumbnailUrl: string | null
  isLivePhoto: boolean
  livePhotoVideoName: string | null
  livePhotoVideoUrl: string | null
  livePhotoCacheFilePath: string | null
  downloadName: string
  canPreview: boolean
  localPath?: string
  frameRate?: number
  duration?: number
}
