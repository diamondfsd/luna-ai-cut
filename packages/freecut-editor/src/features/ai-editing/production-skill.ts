import type { AiProjectEvidence } from './types'

export interface AiEditingQualityGate {
  passed: boolean
  reasons: string[]
  visualCoverage: number
}

function visualCoverage(clips: AiProjectEvidence['clips'], durationSeconds: number): number {
  if (durationSeconds <= 0) return 0
  const ranges = clips
    .filter((clip) => clip.type === 'video' || clip.type === 'image' || clip.type === 'lottie')
    .map((clip) => [Math.max(0, clip.startSeconds), Math.min(durationSeconds, clip.endSeconds)] as const)
    .filter((range) => range[1] > range[0])
    .sort((left, right) => left[0] - right[0])

  let covered = 0
  let cursor = 0
  for (const [start, end] of ranges) {
    const visibleStart = Math.max(cursor, start)
    if (end > visibleStart) covered += end - visibleStart
    cursor = Math.max(cursor, end)
  }
  return covered / durationSeconds
}

export function validateFinishedVideo(evidence: AiProjectEvidence): AiEditingQualityGate {
  const reasons: string[] = []
  const coverage = visualCoverage(evidence.clips, evidence.durationSeconds)
  const visualCount = evidence.clips.filter(
    (clip) => clip.type === 'video' || clip.type === 'image' || clip.type === 'lottie',
  ).length
  const titleCount = evidence.clips.filter((clip) => clip.type === 'text').length

  if (visualCount === 0) reasons.push('时间轴还没有可见画面，不能把只有文字的内容称为成片。')
  if (evidence.durationSeconds < 4) reasons.push('成片时长不足，尚未形成可观看的短片。')
  if (evidence.durationSeconds > 60) reasons.push('当前时间轴过长，需要先整理无关或过长的片段。')
  if (coverage < 0.8) reasons.push('画面没有覆盖大部分时长，仍存在明显空白段。')
  if (titleCount < 3) reasons.push('缺少开场、内容展示和收尾的完整叙事节奏。')

  return { passed: reasons.length === 0, reasons, visualCoverage: coverage }
}
