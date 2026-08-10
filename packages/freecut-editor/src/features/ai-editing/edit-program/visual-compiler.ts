import type { EasingType } from '@freecut/types/keyframe'
import type { MotionAnimationLayer, MotionLayerTrack } from '@freecut/types/motion'
import type { TimelineItem } from '@freecut/types/timeline'
import type { TransformProperties } from '@freecut/types/transform'
import type { AgentCameraMove, AgentFraming, AgentFramingPose } from './types'

function easing(value: AgentCameraMove['easing']): EasingType {
  return value ?? 'ease-in-out'
}

export function transformForPose(params: {
  pose: AgentFramingPose
  mode: AgentFraming['mode']
  sourceWidth: number
  sourceHeight: number
  canvasWidth: number
  canvasHeight: number
}): Required<Pick<TransformProperties, 'x' | 'y' | 'width' | 'height' | 'rotation'>> {
  const scale = params.mode === 'cover'
    ? Math.max(params.canvasWidth / params.sourceWidth, params.canvasHeight / params.sourceHeight)
    : Math.min(params.canvasWidth / params.sourceWidth, params.canvasHeight / params.sourceHeight)
  const width = params.sourceWidth * scale * params.pose.zoom
  const height = params.sourceHeight * scale * params.pose.zoom
  return {
    x: (0.5 - params.pose.center[0]) * width,
    y: (0.5 - params.pose.center[1]) * height,
    width,
    height,
    rotation: params.pose.rotation ?? 0,
  }
}

function motionTrack(
  property: MotionLayerTrack['property'],
  blend: MotionLayerTrack['blend'],
  endFrame: number,
  endValue: number,
  motionEasing: EasingType,
): MotionLayerTrack {
  return {
    property,
    blend,
    keyframes: [
      { id: crypto.randomUUID(), frame: 0, value: blend === 'multiply' ? 1 : 0, easing: motionEasing },
      { id: crypto.randomUUID(), frame: endFrame, value: endValue, easing: motionEasing },
    ],
  }
}

export function compileVisualState(params: {
  item: TimelineItem
  framing?: AgentFraming
  cameraMove?: AgentCameraMove | null
  canvasWidth: number
  canvasHeight: number
}): Partial<TimelineItem> {
  if (params.item.type !== 'video' && params.item.type !== 'image') {
    if (params.framing || params.cameraMove) throw new Error('只有画面片段可以设置取景和运镜。')
    return {}
  }
  const sourceWidth = params.item.sourceWidth ?? params.canvasWidth
  const sourceHeight = params.item.sourceHeight ?? params.canvasHeight
  const mode = params.framing?.mode ?? 'cover'
  const startPose = params.cameraMove?.from ?? params.framing?.pose
  const transform = startPose
    ? transformForPose({
        pose: startPose,
        mode,
        sourceWidth,
        sourceHeight,
        canvasWidth: params.canvasWidth,
        canvasHeight: params.canvasHeight,
      })
    : params.item.transform

  const retainedLayers = (params.item.motionLayers ?? [])
    .filter((layer) => layer.sourcePresetId !== 'ai-edit-program')
  if (!params.cameraMove) {
    return {
      ...(transform ? { transform } : {}),
      ...(params.cameraMove === null ? { motionLayers: retainedLayers } : {}),
    }
  }

  const start = transformForPose({
    pose: params.cameraMove.from,
    mode,
    sourceWidth,
    sourceHeight,
    canvasWidth: params.canvasWidth,
    canvasHeight: params.canvasHeight,
  })
  const end = transformForPose({
    pose: params.cameraMove.to,
    mode,
    sourceWidth,
    sourceHeight,
    canvasWidth: params.canvasWidth,
    canvasHeight: params.canvasHeight,
  })
  const endFrame = Math.max(1, params.item.durationInFrames - 1)
  const motionEasing = easing(params.cameraMove.easing)
  const layer: MotionAnimationLayer = {
    id: crypto.randomUUID(),
    name: 'AI 运镜',
    enabled: true,
    source: 'built-in-preset',
    sourcePresetId: 'ai-edit-program',
    tracks: [
      motionTrack('x', 'add', endFrame, end.x - start.x, motionEasing),
      motionTrack('y', 'add', endFrame, end.y - start.y, motionEasing),
      motionTrack('width', 'multiply', endFrame, end.width / start.width, motionEasing),
      motionTrack('height', 'multiply', endFrame, end.height / start.height, motionEasing),
      motionTrack('rotation', 'add', endFrame, end.rotation - start.rotation, motionEasing),
    ],
  }
  return { transform: start, motionLayers: [...retainedLayers, layer] }
}
