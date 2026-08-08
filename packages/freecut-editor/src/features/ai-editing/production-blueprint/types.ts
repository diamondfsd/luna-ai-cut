export const PRODUCT_UI_LAUNCH_BLUEPRINT_VERSION = 1 as const

export type ProductUiShotRegion = 'overview' | 'top-left' | 'toolbar' | 'timeline' | 'center'
export type ProductUiCameraMove = 'push-in' | 'pan-right' | 'pan-left' | 'pull-out' | 'hold'

export interface ProductUiLaunchShot {
  id: string
  mediaId: string
  region: ProductUiShotRegion
  durationSeconds: number
  purpose: string
  evidence: string
  camera: ProductUiCameraMove
  caption?: string
}

export interface ProductUiLaunchBlueprint {
  version: typeof PRODUCT_UI_LAUNCH_BLUEPRINT_VERSION
  title: string
  audience: string
  promise: string
  tone: string
  aspectRatio: string
  replaceExisting: boolean
  shots: ProductUiLaunchShot[]
}

export interface ProductUiLaunchReview {
  passed: boolean
  reasons: string[]
  expectedShotCount: number
  actualVisualCount: number
}
