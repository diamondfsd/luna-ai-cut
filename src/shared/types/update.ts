export interface UpdateInfo {
  version: string
  downloadUrl: string
  releaseUrl: string
  releaseNotes?: string
  publishedAt?: string
}

export interface HotUpdateManifest {
  version: string
  zipName: string
  minAppVersion: string
}

export interface HotUpdateCheckResult {
  version: string
  downloadUrl: string
  manifest: HotUpdateManifest
  notes?: string
}

export interface ReleaseNoteItem {
  version: string
  content: string
}
