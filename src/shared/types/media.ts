export type MediaKind = 'image' | 'video' | 'lrv' | 'unknown'

export interface RelatedMediaFile {
  name: string
  sourceUrl: string
  url: string
  bytes: number | null
  downloadName: string
  downloadFilePath: string | null
  localPath?: string
}

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
  dolbyVision?: boolean
  dolbyVisionProfile?: number
  iLog?: boolean
  rawCompanion: RelatedMediaFile | null
}

export interface CameraDeleteFailure {
  path: string
  error: string
}

export interface CameraDeleteResult {
  deleted: string[]
  failed: CameraDeleteFailure[]
}
