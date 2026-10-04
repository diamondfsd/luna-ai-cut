import type { AiEditorLocalMedia } from '../../../src/shared/types'

export interface DirectorShotObservation {
  description: string
  subject: string
  framing: string
  movement: string
  usability: string
  confidence: number
}

export interface DirectorEditSegment {
  mediaId: string
  shotId: string
  takeId: string
  inPoint: number
  outPoint: number
  timelineStart: number
  /** Omitted by legacy callers means visual-inspection. */
  selectionBasis?: 'director-plan' | 'visual-inspection'
  observation?: DirectorShotObservation
  reason: string
  /** Actual inspected source timestamps supporting the selection. */
  observedFrameTimes?: number[]
}
export interface DirectorEditPlan {
  planId: string
  planSignature: string
  omittedShots?: { shotId: string; reason: string }[]
  segments: DirectorEditSegment[]
}

/** Pure validation; the caller must resolve files and probe durations immediately before applying. */
export function validateDirectorEditPlan(input: unknown, media: readonly AiEditorLocalMedia[]) {
  if (!input || typeof input !== 'object') throw new Error('剪辑方案无效')
  const plan = input as DirectorEditPlan
  if (typeof plan.planId !== 'string' || !plan.planId || typeof plan.planSignature !== 'string'
    || !Array.isArray(plan.segments) || !plan.segments.length || plan.segments.length > 500) throw new Error('剪辑方案无效')
  const byId = new Map(media.map(item => [item.mediaId, item]))
  let previousEnd = 0
  const used = new Set<string>()
  for (const segment of plan.segments) {
    if (!segment || typeof segment !== 'object') throw new Error('片段无效')
    const file = byId.get(segment.mediaId)
    const context = file?.directorContexts?.find(item => item.planId === plan.planId
      && item.shotId === segment.shotId && item.takeId === segment.takeId)
    if (!file || !context) throw new Error('素材不属于指定镜头')
    if (context.planSignature !== plan.planSignature) throw new Error('拍摄计划已更新，请重新分析')
    const { inPoint, outPoint, timelineStart } = segment
    if (![inPoint, outPoint, timelineStart].every(value => typeof value === 'number' && Number.isFinite(value))
      || inPoint < 0 || outPoint <= inPoint || timelineStart < previousEnd - 0.000001) throw new Error('片段时间范围无效或重叠')
    if (file.kind === 'video') {
      if (!Number.isFinite(file.duration) || !file.duration || outPoint > file.duration + 0.000001) throw new Error('片段超出原片时长或时长未知')
      const range = context.selectedRange
      if (range && (inPoint < range.start_ms / 1000 - 0.000001 || outPoint > range.end_ms / 1000 + 0.000001)) throw new Error('片段超出人工选取范围')
    } else if (file.kind !== 'image' || inPoint !== 0) throw new Error('静帧必须从零开始')
    if (typeof segment.reason !== 'string' || !segment.reason.trim() || segment.reason.length > 4000) throw new Error('缺少有效的选片理由')
    const basis = segment.selectionBasis ?? 'visual-inspection'
    if (!['director-plan', 'visual-inspection'].includes(basis)) throw new Error('选片依据无效')
    if (basis === 'director-plan') {
      if (segment.observation !== undefined || (segment.observedFrameTimes !== undefined
        && (!Array.isArray(segment.observedFrameTimes) || segment.observedFrameTimes.length))) throw new Error('按导拍组装不能声明视觉观察')
    } else {
      if (!Array.isArray(segment.observedFrameTimes) || !segment.observedFrameTimes.length
        || segment.observedFrameTimes.some(time => typeof time !== 'number' || !Number.isFinite(time) || time < 0
          || (file.kind === 'image' ? time !== 0 : time >= (file.duration ?? 0)))) throw new Error('缺少有效的画面观察依据')
      if (file.kind === 'video' && !segment.observedFrameTimes!.some(time => time >= inPoint && time < outPoint)) {
        throw new Error('所选片段缺少区间内的画面观察依据')
      }
      const observation = segment.observation
      if (!observation || typeof observation !== 'object'
        || ['description', 'subject', 'framing', 'movement', 'usability'].some(key => {
          const value = observation[key as keyof DirectorShotObservation]
          return typeof value !== 'string' || !value.trim() || value.length > 4000
        }) || typeof observation.confidence !== 'number' || !Number.isFinite(observation.confidence)
        || observation.confidence < 0 || observation.confidence > 1) throw new Error('缺少有效的镜头观察记录')
    }
    const key = `${segment.mediaId}:${inPoint}:${outPoint}`
    if (used.has(key)) throw new Error('重复使用同一片段')
    used.add(key)
    previousEnd = timelineStart + outPoint - inPoint
  }
  return { valid: true, duration: previousEnd, segmentCount: plan.segments.length, plan }
}
