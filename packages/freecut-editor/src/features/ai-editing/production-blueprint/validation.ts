import { z } from 'zod'
import type { AiProjectEvidence } from '../types'
import {
  PRODUCT_UI_LAUNCH_BLUEPRINT_VERSION,
  type ProductUiLaunchBlueprint,
  type ProductUiLaunchReview,
} from './types'

const shotSchema = z.object({
  id: z.string().trim().regex(/^SHOT-[0-9]{2}$/),
  mediaId: z.string().trim().min(1),
  region: z.enum(['overview', 'top-left', 'toolbar', 'timeline', 'center']),
  durationSeconds: z.number().min(1.2).max(8),
  purpose: z.string().trim().min(4).max(100),
  evidence: z.string().trim().min(4).max(160),
  camera: z.enum(['push-in', 'pan-right', 'pan-left', 'pull-out', 'hold']),
  caption: z.string().trim().min(1).max(80).optional(),
}).strict()

export const productUiLaunchBlueprintSchema = z.object({
  version: z.literal(PRODUCT_UI_LAUNCH_BLUEPRINT_VERSION),
  title: z.string().trim().min(4).max(80),
  audience: z.string().trim().min(2).max(80),
  promise: z.string().trim().min(4).max(160),
  tone: z.string().trim().min(2).max(60),
  aspectRatio: z.string().trim().min(3).max(12),
  replaceExisting: z.boolean().default(false),
  shots: z.array(shotSchema).min(4).max(6),
}).strict()

function visualMediaIds(evidence: AiProjectEvidence): Set<string> {
  return new Set(evidence.media
    .filter((media) => media.kind === 'image' || media.kind === 'video')
    .filter((media) => media.visual.length > 0)
    .map((media) => media.mediaId))
}

export function parseProductUiLaunchBlueprint(raw: string, evidence: AiProjectEvidence): ProductUiLaunchBlueprint {
  const json = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('制作计划格式无效，未开始修改时间轴。')
  }
  const blueprint = productUiLaunchBlueprintSchema.parse(parsed)
  const eligibleMediaIds = visualMediaIds(evidence)
  const uniqueShotIds = new Set(blueprint.shots.map((shot) => shot.id))
  if (uniqueShotIds.size !== blueprint.shots.length) throw new Error('制作计划中的镜头编号重复，未开始修改时间轴。')
  if (blueprint.shots.some((shot) => !eligibleMediaIds.has(shot.mediaId))) {
    throw new Error('制作计划引用了未完成画面分析的素材，未开始修改时间轴。')
  }
  if (blueprint.shots.filter((shot) => Boolean(shot.caption)).length < 3) {
    throw new Error('制作计划缺少开场、展示和收尾文案，未开始修改时间轴。')
  }
  if (!blueprint.shots.some((shot) => shot.region === 'overview') || !blueprint.shots.some((shot) => shot.region === 'timeline')) {
    throw new Error('界面短片必须包含完整界面和时间轴的真实展示，未开始修改时间轴。')
  }
  return blueprint
}

export function reviewProductUiLaunch(
  blueprint: ProductUiLaunchBlueprint,
  evidence: AiProjectEvidence,
): ProductUiLaunchReview {
  const reasons: string[] = []
  const visualClips = evidence.clips.filter((clip) => clip.type === 'image' || clip.type === 'video')
  const textClips = evidence.clips.filter((clip) => clip.type === 'text')
  const expectedDuration = blueprint.shots.reduce((total, shot) => total + shot.durationSeconds, 0)
  if (visualClips.length < blueprint.shots.length) reasons.push('实际画面镜头少于制作计划。')
  if (textClips.length < 3) reasons.push('实际时间轴缺少完整的开场、展示和收尾文案。')
  if (Math.abs(evidence.durationSeconds - expectedDuration) > 0.15) reasons.push('实际片长与制作计划不一致。')
  return {
    passed: reasons.length === 0,
    reasons,
    expectedShotCount: blueprint.shots.length,
    actualVisualCount: visualClips.length,
  }
}
