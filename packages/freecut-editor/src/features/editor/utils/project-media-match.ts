import type { ProjectResolution } from '@freecut/types/project'
import type { MediaMetadata } from '@freecut/types/storage'
import { formatFpsValue, resolveAutoMatchProjectFps } from '@freecut/features/editor/deps/projects'
import { resizeCanvasToAspectRatio } from '@freecut/shared/projects/canvas-aspect-ratio'

export interface ProjectMediaMatchSuggestion {
  width: number
  height: number
  fps: number
  sourceFpsLabel: string
  matchedFpsLabel: string
  fpsWasRounded: boolean
  sizeDiffers: boolean
  fpsDiffers: boolean
  hasChanges: boolean
}

function normalizeDimension(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0
  }

  const rounded = Math.round(value)
  return rounded % 2 === 0 ? rounded : rounded + 1
}

export function isProjectMatchableVisual(media: MediaMetadata): boolean {
  return (
    (media.mimeType.startsWith('video/') || media.mimeType.startsWith('image/')) &&
    Number.isFinite(media.width) &&
    media.width > 0 &&
    Number.isFinite(media.height) &&
    media.height > 0
  )
}

type ProjectMediaMatchSource = Pick<MediaMetadata, 'width' | 'height'> & { fps?: number }

export function getProjectMediaMatchSuggestion(
  project: ProjectResolution,
  media: ProjectMediaMatchSource,
): ProjectMediaMatchSuggestion {
  const sourceWidth = normalizeDimension(media.width)
  const sourceHeight = normalizeDimension(media.height)
  const matchedCanvas = resizeCanvasToAspectRatio(project, sourceWidth / sourceHeight)
  const hasSourceFps = Number.isFinite(media.fps) && (media.fps ?? 0) > 0
  const fpsMatch = resolveAutoMatchProjectFps(hasSourceFps ? media.fps! : project.fps)
  const fps = fpsMatch.fps

  const sizeDiffers =
    sourceWidth > 0 &&
    sourceHeight > 0 &&
    (project.width !== matchedCanvas.width || project.height !== matchedCanvas.height)
  const fpsDiffers = hasSourceFps && project.fps !== fps

  return {
    width: matchedCanvas.width,
    height: matchedCanvas.height,
    fps,
    sourceFpsLabel: formatFpsValue(hasSourceFps ? media.fps! : project.fps),
    matchedFpsLabel: formatFpsValue(fps),
    fpsWasRounded: !fpsMatch.exact,
    sizeDiffers,
    fpsDiffers,
    hasChanges: sizeDiffers || fpsDiffers,
  }
}
