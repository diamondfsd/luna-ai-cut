import { z } from 'zod'
import { useProjectStore } from '@freecut/features/editor/deps/projects'
import { useTimelineStore } from '@freecut/features/editor/deps/timeline-store'
import {
  addItemsOnNewTracks,
  applyMotionModifierToItems,
  applyTextMotionEffect,
  createOverlayLayerTrack,
  createTextTemplateItem,
} from '@freecut/features/editor/deps/timeline-contract'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@freecut/shared/projects/defaults'
import { createTextMotionEffect } from '@freecut/shared/typography/text-motion'
import { buildProjectEvidence } from '../evidence'
import { composeTimelineFromMedia } from '../media-composition-service'
import type { AiEditingToolModule } from '../types'
import { defineAiEditingTool, objectSchema } from './tool-utils'

const DEFAULT_STILL_DURATION_SECONDS = 8

function titleItem(params: {
  trackId: string
  from: number
  durationInFrames: number
  text: string
  label: string
  canvasWidth: number
  canvasHeight: number
  fps: number
}) {
  return createTextTemplateItem({
    placement: params,
    text: params.text,
    label: params.label,
    textStylePresetId: 'clean-title',
  })
}

const buildProductShowcase = defineAiEditingTool({
  id: 'timeline.build_product_showcase',
  title: '制作产品展示短片',
  description: '把已完成画面分析的产品素材制作成短片：画面编排、静态图动效、开场、展示和收尾文字都会一并完成。单张静态图会制作成动态预告，不会伪装成多镜头视频。不会覆盖已有时间轴内容。',
  risk: 'edit',
  execution: 'async',
  inputSchema: objectSchema({
    mediaIds: { type: 'array', items: { type: 'string' }, description: '已分析的产品画面素材 ID，按展示顺序排列。' },
    headline: { type: 'string', description: '开场主标题。' },
    detail: { type: 'string', description: '展示重点。' },
    ending: { type: 'string', description: '收尾文案。' },
  }, ['mediaIds', 'headline', 'detail', 'ending']),
  schema: z.object({
    mediaIds: z.array(z.string().min(1)).min(1).max(3),
    headline: z.string().trim().min(1).max(60),
    detail: z.string().trim().min(1).max(80),
    ending: z.string().trim().min(1).max(60),
  }),
  summarize: (args) => `制作 ${args.mediaIds.length} 个素材的产品展示短片`,
  execute: async (args) => {
    const evidence = await buildProjectEvidence()
    const selected = args.mediaIds.map((id) => evidence.media.find((media) => media.mediaId === id))
    if (selected.some((media) => !media)) return { ok: false, message: '有素材已不在当前素材库中，请重新选择。' }
    if (selected.some((media) => media!.kind !== 'image' && media!.kind !== 'video')) {
      return { ok: false, message: '产品展示短片目前只支持图片或视频素材。' }
    }
    if (selected.some((media) => media!.visual.length === 0)) {
      return { ok: false, message: '请先分析选中的产品画面，再开始制作短片。' }
    }

    const beforeIds = new Set(useTimelineStore.getState().items.map((item) => item.id))
    const composed = await composeTimelineFromMedia({
      selections: selected.map((media) => ({
        mediaId: media!.mediaId,
        ...(media!.kind === 'image' ? { durationSeconds: DEFAULT_STILL_DURATION_SECONDS } : {}),
      })),
      includeOriginalAudio: true,
    })
    if (!composed.ok) return composed

    const timeline = useTimelineStore.getState()
    const fps = timeline.fps > 0 ? timeline.fps : 30
    const mediaItems = timeline.items.filter((item) => !beforeIds.has(item.id) && (
      item.type === 'image' || item.type === 'video'
    ))
    applyMotionModifierToItems(mediaItems.map((item, index) => ({
      itemId: item.id,
      modifier: {
        id: crypto.randomUUID(),
        type: 'float-drift' as const,
        enabled: true,
        amplitude: 0.25,
        frequency: 0.08,
        phaseFrames: index * 12,
        seed: index + 1,
      },
    })))

    const overlay = createOverlayLayerTrack({ tracks: timeline.tracks, activeTrackId: null })
    if (!overlay) return { ok: false, message: '无法为短片文字创建图层。' }
    const project = useProjectStore.getState().currentProject
    const canvasWidth = project?.metadata.width ?? DEFAULT_PROJECT_WIDTH
    const canvasHeight = project?.metadata.height ?? DEFAULT_PROJECT_HEIGHT
    const start = Math.min(...mediaItems.map((item) => item.from))
    const end = Math.max(...mediaItems.map((item) => item.from + item.durationInFrames))
    const total = Math.max(1, end - start)
    const firstDuration = Math.max(1, Math.round(total * 0.28))
    const secondDuration = Math.max(1, Math.round(total * 0.44))
    const titleItems = [
      titleItem({ trackId: overlay.trackId, from: start, durationInFrames: firstDuration, text: args.headline, label: '开场', canvasWidth, canvasHeight, fps }),
      titleItem({ trackId: overlay.trackId, from: start + firstDuration, durationInFrames: secondDuration, text: args.detail, label: '展示重点', canvasWidth, canvasHeight, fps }),
      titleItem({ trackId: overlay.trackId, from: start + firstDuration + secondDuration, durationInFrames: Math.max(1, end - (start + firstDuration + secondDuration)), text: args.ending, label: '收尾', canvasWidth, canvasHeight, fps }),
    ]
    addItemsOnNewTracks(titleItems, overlay.tracks)
    applyTextMotionEffect(titleItems.map((item) => item.id), 'in', createTextMotionEffect('fade-up'))

    return {
      ok: true,
      message: `已制作 ${selected.length === 1 ? '动态产品预告' : '产品展示短片'}，包含开场、展示重点和收尾。`,
      data: { mediaCount: selected.length, durationSeconds: total / fps },
    }
  },
})

export const aiEditingToolModule: AiEditingToolModule = {
  createTools: () => [buildProductShowcase],
}
