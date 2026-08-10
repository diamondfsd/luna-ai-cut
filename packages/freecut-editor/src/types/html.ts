export type HtmlRenderMode = 'static' | 'animated'

export interface HtmlViewport {
  width: number
  height: number
  deviceScaleFactor: number
}

export type HtmlAssetKind = 'image' | 'font' | 'video' | 'audio'

/**
 * A project-owned resource exposed to an HTML item through its future
 * luna-asset:// URL. Raw filesystem paths are intentionally not persisted.
 */
export interface HtmlAssetReference {
  id: string
  kind: HtmlAssetKind
  source:
    | {
        type: 'media'
        mediaId: string
      }
    | {
        type: 'project'
        relativePath: string
      }
  mimeType?: string
  contentHash?: string
}
