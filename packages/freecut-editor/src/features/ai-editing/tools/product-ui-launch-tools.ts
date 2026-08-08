import { z } from 'zod'
import { useProjectStore } from '@freecut/features/editor/deps/projects'
import { useTimelineStore } from '@freecut/features/editor/deps/timeline-store'
import {
  addItemsOnNewTracks,
  applyMotionModifierToItems,
  applyTextMotionEffect,
  createOverlayLayerTrack,
  createTextTemplateItem,
  getTrackKind,
  removeItems,
  updateItem,
} from '@freecut/features/editor/deps/timeline-contract'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@freecut/shared/projects/defaults'
import { createTextMotionEffect } from '@freecut/shared/typography/text-motion'
import { buildProjectEvidence } from '../evidence'
import { composeTimelineFromMedia } from '../media-composition-service'
import { productUiLaunchBlueprintSchema } from '../production-blueprint/validation'
import type { ProductUiLaunchBlueprint, ProductUiShotRegion } from '../production-blueprint/types'
import type { AiEditingToolModule } from '../types'
import { defineAiEditingTool, objectSchema } from './tool-utils'

function cropForRegion(region: ProductUiShotRegion) {
  switch (region) {
    case 'top-left': return { right: 0.48, bottom: 0.42, refit: true }
    case 'toolbar': return { top: 0.32, bottom: 0.34, refit: true }
    case 'timeline': return { top: 0.63, refit: true }
    case 'center': return { left: 0.18, right: 0.18, top: 0.14, bottom: 0.16, refit: true }
    case 'overview': return undefined
  }
}

function motionForShot(index: number, camera: ProductUiLaunchBlueprint['shots'][number]['camera']) {
  const base = {
    id: crypto.randomUUID(),
    enabled: true,
    amplitude: camera === 'hold' ? 0.08 : camera === 'push-in' || camera === 'pull-out' ? 0.16 : 0.12,
    frequency: camera === 'hold' ? 0.035 : 0.065,
    phaseFrames: index * 11,
    seed: index + 1,
  }
  if (camera === 'pan-left' || camera === 'pan-right') {
    return { ...base, type: 'sway' as const, channelGains: { x: camera === 'pan-left' ? -0.7 : 0.7, y: 0, rotation: 0 } }
  }
  return { ...base, type: 'float-drift' as const, channelGains: { x: 0.25, y: 0.18, rotation: 0 } }
}

async function compileProductUiLaunch(blueprint: ProductUiLaunchBlueprint) {
  const evidence = await buildProjectEvidence()
  const mediaById = new Map(evidence.media.map((media) => [media.mediaId, media]))
  if (blueprint.shots.some((shot) => mediaById.get(shot.mediaId)?.kind !== 'image')) {
    return { ok: false as const, message: '这次界面短片试验目前只支持已分析的图片素材。' }
  }
  const videoTrack = useTimelineStore.getState().tracks.find(
    (track) => track.name === `V${blueprint.videoTrack}` && !track.isGroup && !track.locked && getTrackKind(track) === 'video',
  )
  if (!videoTrack) return { ok: false as const, message: `V${blueprint.videoTrack} 当前不可用于放置画面。` }
  if (blueprint.replaceExisting) removeItems(useTimelineStore.getState().items.map((item) => item.id))

  const beforeIds = new Set(useTimelineStore.getState().items.map((item) => item.id))
  const composed = await composeTimelineFromMedia({
    selections: blueprint.shots.map((shot) => ({ mediaId: shot.mediaId, durationSeconds: shot.durationSeconds })),
    startSeconds: blueprint.replaceExisting ? 0 : undefined,
    includeOriginalAudio: false,
    targetTrackId: videoTrack.id,
  })
  if (!composed.ok) return composed

  const timeline = useTimelineStore.getState()
  const fps = timeline.fps > 0 ? timeline.fps : 30
  const visualItems = timeline.items
    .filter((item) => !beforeIds.has(item.id) && item.type === 'image')
    .sort((left, right) => left.from - right.from)
  if (visualItems.length !== blueprint.shots.length) {
    return { ok: false as const, message: '制作计划没有完整落到时间轴，请重新生成。' }
  }

  visualItems.forEach((item, index) => {
    const shot = blueprint.shots[index]!
    updateItem(item.id, {
      label: `${shot.id} ${shot.purpose}`,
      crop: cropForRegion(shot.region),
    })
  })
  applyMotionModifierToItems(visualItems.map((item, index) => ({
    itemId: item.id,
    modifier: motionForShot(index, blueprint.shots[index]!.camera),
  })))

  const overlay = createOverlayLayerTrack({ tracks: useTimelineStore.getState().tracks, activeTrackId: null })
  if (!overlay) return { ok: false as const, message: '无法为界面短片创建文字图层。' }
  const project = useProjectStore.getState().currentProject
  const canvasWidth = project?.metadata.width ?? DEFAULT_PROJECT_WIDTH
  const canvasHeight = project?.metadata.height ?? DEFAULT_PROJECT_HEIGHT
  const titleItems = visualItems.flatMap((item, index) => {
    const shot = blueprint.shots[index]!
    const caption = shot.caption
    if (!caption) return []
    return [createTextTemplateItem({
      placement: {
        trackId: overlay.trackId,
        from: item.from,
        durationInFrames: item.durationInFrames,
        canvasWidth,
        canvasHeight,
        fps,
      },
      text: caption,
      label: `${shot.id} 文案`,
      textStylePresetId: 'clean-title',
    })]
  })
  addItemsOnNewTracks(titleItems, overlay.tracks)
  applyTextMotionEffect(titleItems.map((item) => item.id), 'in', createTextMotionEffect('fade-up'))

  return {
    ok: true as const,
    message: `已按 ${blueprint.shots.length} 个镜头制作界面短片。`,
    data: {
      shotCount: blueprint.shots.length,
      durationSeconds: visualItems.reduce((total, item) => total + item.durationInFrames / fps, 0),
      startSeconds: visualItems[0]!.from / fps,
      endSeconds: (visualItems.at(-1)!.from + visualItems.at(-1)!.durationInFrames) / fps,
      videoTrack: videoTrack.name,
    },
  }
}

const buildProductUiLaunch = defineAiEditingTool({
  id: 'timeline.compile_product_ui_launch',
  title: '编排界面发布短片',
  description: '依据已校验的制作蓝图，将真实界面图片编排为具名镜头、局部展示、动效与文字节奏。',
  risk: 'edit',
  execution: 'async',
  inputSchema: objectSchema({ blueprint: { type: 'object', description: '已校验的界面短片制作蓝图。' } }, ['blueprint']),
  schema: z.object({ blueprint: productUiLaunchBlueprintSchema }),
  summarize: (args) => `按制作蓝图编排 ${args.blueprint.shots.length} 个界面镜头`,
  execute: ({ blueprint }) => compileProductUiLaunch(blueprint),
})

export const aiEditingToolModule: AiEditingToolModule = {
  createTools: () => [buildProductUiLaunch],
}
