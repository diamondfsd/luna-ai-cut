import { createHash } from 'node:crypto'

import type {
  AiMediaQualityMetrics,
  AiSelectionGroup,
  AiSelectionItem,
  AiSelectionPreset,
  AiSelectionPreferenceProfile,
  AiSelectionPurpose,
  AiSelectionScene,
  AiSelectionTarget,
} from '../src/shared/types'

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha1').update(value).digest('hex').slice(0, 16)}`
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))]
}

function localDay(iso: string): string {
  const date = new Date(iso)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function eventName(startAt: string, index: number): string {
  const date = new Date(startAt)
  return `${date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })} 拍摄 ${index + 1}`
}

export function buildShootingEvents(items: AiSelectionItem[]): AiSelectionScene[] {
  const buckets = new Map<string, AiSelectionItem[]>()
  for (const item of items) {
    const key = `${localDay(item.capturedAt)}\0${item.device ?? 'unknown'}\0${item.path.split(/[\\/]/).slice(0, -1).join('/')}`
    buckets.set(key, [...(buckets.get(key) ?? []), item])
  }

  const events: AiSelectionScene[] = []
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt) || a.path.localeCompare(b.path))
    const gaps = bucket.slice(1).map((item, index) => Date.parse(item.capturedAt) - Date.parse(bucket[index].capturedAt))
      .filter((gap) => gap > 0 && gap < 2 * 60 * 60 * 1000)
    const threshold = Math.max(5 * 60_000, Math.min(30 * 60_000, 3 * (percentile(gaps, 0.75) || 10 * 60_000)))
    let current: AiSelectionItem[] = []
    const flush = (): void => {
      if (current.length === 0) return
      const first = current[0]
      const last = current[current.length - 1]
      const id = stableId('event', `${first.id}\0${last.id}`)
      events.push({
        id,
        name: eventName(first.capturedAt, events.length),
        startAt: first.capturedAt,
        endAt: last.capturedAt,
        itemIds: current.map((item) => item.id),
        coverItemId: [...current].sort(compareRepresentative)[0]?.id ?? first.id,
        confirmation: 'pending',
        recommendedCount: 0,
        userModified: false,
      })
      current = []
    }

    for (const item of bucket) {
      const previous = current[current.length - 1]
      const gap = previous ? Date.parse(item.capturedAt) - Date.parse(previous.capturedAt) : 0
      if (previous && (gap > threshold || gap > 90 * 60_000)) flush()
      current.push(item)
    }
    flush()
  }
  return events.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
}

export function analyzeRgb(rgb: Uint8Array, width: number, height: number): {
  quality: AiMediaQualityMetrics
  perceptualHash: string
  histogram: number[]
  visualSignature: number[]
} {
  const luma = new Uint8Array(width * height)
  const histogram = Array.from({ length: 16 }, () => 0)
  let sum = 0
  let sumSquares = 0
  let dark = 0
  let bright = 0
  for (let index = 0; index < luma.length; index += 1) {
    const offset = index * 3
    const value = Math.round(rgb[offset] * 0.2126 + rgb[offset + 1] * 0.7152 + rgb[offset + 2] * 0.0722)
    luma[index] = value
    histogram[Math.min(15, Math.floor(value / 16))] += 1
    sum += value
    sumSquares += value * value
    if (value < 16) dark += 1
    if (value > 245) bright += 1
  }
  const count = Math.max(1, luma.length)
  const mean = sum / count
  const contrast = Math.sqrt(Math.max(0, sumSquares / count - mean * mean))
  let edgeTotal = 0
  let edgeCount = 0
  for (let y = 1; y < height; y += 1) {
    for (let x = 1; x < width; x += 1) {
      const index = y * width + x
      edgeTotal += Math.abs(luma[index] - luma[index - 1]) + Math.abs(luma[index] - luma[index - width])
      edgeCount += 2
    }
  }
  const edgeScore = edgeTotal / Math.max(1, edgeCount)
  let entropy = 0
  for (const value of histogram) {
    if (value === 0) continue
    const probability = value / count
    entropy -= probability * Math.log2(probability)
  }
  const darkRatio = dark / count
  const brightRatio = bright / count
  const reasons: string[] = []
  let score = 100
  if (darkRatio > 0.92) { score -= 70; reasons.push('画面接近全黑') }
  else if (mean < 45) { score -= 18; reasons.push('画面偏暗') }
  if (brightRatio > 0.92) { score -= 70; reasons.push('画面严重过曝') }
  else if (mean > 220) { score -= 18; reasons.push('高光偏多') }
  if (edgeScore < 3 && contrast < 12) { score -= 30; reasons.push('清晰度和细节偏低') }
  else if (edgeScore < 6) { score -= 12; reasons.push('清晰度一般') }
  if (entropy < 1.2) { score -= 20; reasons.push('有效画面信息较少') }
  score = Math.max(0, Math.min(100, Math.round(score)))
  const grade = score >= 88 ? 'excellent' : score >= 72 ? 'good' : score >= 50 ? 'fair' : 'review'
  const quality: AiMediaQualityMetrics = {
    score,
    grade,
    reasons: reasons.slice(0, 3),
    luminanceMean: Number(mean.toFixed(2)),
    darkRatio: Number(darkRatio.toFixed(4)),
    brightRatio: Number(brightRatio.toFixed(4)),
    contrast: Number(contrast.toFixed(2)),
    edgeScore: Number(edgeScore.toFixed(2)),
    entropy: Number(entropy.toFixed(3)),
  }

  let bits = 0n
  let bitIndex = 0n
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = luma[Math.min(height - 1, Math.floor((y + 0.5) * height / 8)) * width + Math.min(width - 1, Math.floor((x + 0.5) * width / 9))]
      const right = luma[Math.min(height - 1, Math.floor((y + 0.5) * height / 8)) * width + Math.min(width - 1, Math.floor((x + 1.5) * width / 9))]
      if (left > right) bits |= 1n << bitIndex
      bitIndex += 1n
    }
  }
  return {
    quality,
    perceptualHash: bits.toString(16).padStart(16, '0'),
    histogram: histogram.map((value) => Number((value / count).toFixed(6))),
    visualSignature: buildVisualSignature(rgb, width, height),
  }
}

function buildVisualSignature(rgb: Uint8Array, width: number, height: number): number[] {
  const result: number[] = []
  for (let gridY = 0; gridY < 4; gridY += 1) {
    for (let gridX = 0; gridX < 4; gridX += 1) {
      const sums = [0, 0, 0]
      let pixels = 0
      const startX = Math.floor(gridX * width / 4)
      const endX = Math.max(startX + 1, Math.floor((gridX + 1) * width / 4))
      const startY = Math.floor(gridY * height / 4)
      const endY = Math.max(startY + 1, Math.floor((gridY + 1) * height / 4))
      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          const offset = (y * width + x) * 3
          sums[0] += rgb[offset]
          sums[1] += rgb[offset + 1]
          sums[2] += rgb[offset + 2]
          pixels += 1
        }
      }
      result.push(...sums.map((value) => Number((value / Math.max(1, pixels) / 255).toFixed(5))))
    }
  }
  const length = Math.sqrt(result.reduce((sum, value) => sum + value * value, 0)) || 1
  return result.map((value) => Number((value / length).toFixed(6)))
}

export function hammingDistance(a: string, b: string): number {
  let value = BigInt(`0x${a || '0'}`) ^ BigInt(`0x${b || '0'}`)
  let count = 0
  while (value) { count += Number(value & 1n); value >>= 1n }
  return count
}

export function normalizeSelectionTarget(target: AiSelectionTarget): AiSelectionTarget {
  if (target.mode === 'preset' || !Number.isFinite(target.value)) return { mode: 'preset', value: null }
  if (target.mode === 'count') return { mode: 'count', value: Math.max(1, Math.round(target.value ?? 1)) }
  return { mode: 'ratio', value: Math.min(1, Math.max(0.01, target.value ?? 0.35)) }
}

function histogramSimilarity(a: number[] | null, b: number[] | null): number {
  if (!a || !b || a.length !== b.length) return 0
  const dot = a.reduce((sum, value, index) => sum + value * b[index], 0)
  const lengthA = Math.sqrt(a.reduce((sum, value) => sum + value * value, 0))
  const lengthB = Math.sqrt(b.reduce((sum, value) => sum + value * value, 0))
  return dot / Math.max(0.000001, lengthA * lengthB)
}

function vectorSimilarity(a: number[] | null, b: number[] | null): number {
  if (!a || !b || a.length !== b.length) return 0
  return a.reduce((sum, value, index) => sum + value * b[index], 0)
}

export function buildSimilarityGroups(items: AiSelectionItem[], scenes: AiSelectionScene[]): AiSelectionGroup[] {
  const groups: AiSelectionGroup[] = []
  const assigned = new Set<string>()
  const exactBuckets = new Map<string, AiSelectionItem[]>()
  for (const item of items) {
    if (!item.exactHash) continue
    exactBuckets.set(item.exactHash, [...(exactBuckets.get(item.exactHash) ?? []), item])
  }
  for (const bucket of exactBuckets.values()) {
    if (bucket.length < 2) continue
    const representative = [...bucket].sort(compareRepresentative)[0]
    groups.push({ id: stableId('similar', bucket.map((item) => item.id).join('\0')), sceneId: representative.sceneId ?? scenes[0]?.id ?? '', kind: 'duplicate', itemIds: bucket.map((item) => item.id), representativeId: representative.id, reason: '完全相同的文件', confidence: 1, suggestedKeepCount: 1, confirmation: 'pending', userModified: false })
    bucket.forEach((item) => assigned.add(item.id))
  }

  const candidates = items
    .filter((item) => item.kind === 'image' && item.perceptualHash && !assigned.has(item.id))
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt))
  for (const leader of candidates) {
    if (assigned.has(leader.id)) continue
    const bucket = [leader]
    for (const candidate of candidates) {
      if (candidate.id === leader.id || assigned.has(candidate.id)) continue
      const gap = Math.abs(Date.parse(candidate.capturedAt) - Date.parse(leader.capturedAt))
      if (gap > 2 * 60_000) continue
      const leaderRatio = (leader.width ?? 1) / (leader.height ?? 1)
      const candidateRatio = (candidate.width ?? 1) / (candidate.height ?? 1)
      if (Math.abs(leaderRatio - candidateRatio) / Math.max(leaderRatio, candidateRatio) > 0.08) continue
      const distance = hammingDistance(leader.perceptualHash!, candidate.perceptualHash!)
      const color = histogramSimilarity(leader.luminanceHistogram, candidate.luminanceHistogram)
      const visual = vectorSimilarity(leader.visualSignature, candidate.visualSignature)
      const strongMatch = distance <= 12 && color >= 0.65
      const continuousMatch = gap <= 30_000 && distance <= 18 && color >= 0.8
      const visualMatch = gap <= 20_000 && distance <= 22 && color >= 0.82 && visual >= 0.97
      // 连拍中动作和自动曝光会让 dHash/亮度直方图大幅变化；极短时间且空间色彩布局
      // 高度一致时仍应进入同组，由用户并排比较，而不是被漏到普通文件流。
      const exposureVariantMatch = gap <= 20_000 && visual >= 0.985
      if (strongMatch || continuousMatch || visualMatch || exposureVariantMatch) bucket.push(candidate)
    }
    if (bucket.length < 2) continue
    const representative = [...bucket].sort(compareRepresentative)[0]
    groups.push({
      id: stableId('similar', bucket.map((item) => item.id).join('\0')),
      sceneId: representative.sceneId ?? scenes[0]?.id ?? '',
      kind: gapKind(bucket),
      itemIds: bucket.map((item) => item.id),
      representativeId: representative.id,
      reason: '同一时刻拍摄，内容相近',
      confidence: 0.78,
      suggestedKeepCount: 1,
      confirmation: 'pending',
      userModified: false,
    })
    bucket.forEach((item) => assigned.add(item.id))
  }
  return groups
}

function gapKind(items: AiSelectionItem[]): AiSelectionGroup['kind'] {
  const times = items.map((item) => Date.parse(item.capturedAt)).sort((a, b) => a - b)
  return times[times.length - 1] - times[0] <= 10_000 ? 'burst' : 'similar'
}

function compareRepresentative(a: AiSelectionItem, b: AiSelectionItem): number {
  const aRisk = a.quality?.grade === 'review' ? 1 : 0
  const bRisk = b.quality?.grade === 'review' ? 1 : 0
  if (aRisk !== bRisk) return aRisk - bRisk
  const aEdge = a.quality?.edgeScore ?? 0
  const bEdge = b.quality?.edgeScore ?? 0
  const aSubjectEdge = a.personEvidence?.subjectEdgeScore ?? 0
  const bSubjectEdge = b.personEvidence?.subjectEdgeScore ?? 0
  const eyeScore = (item: AiSelectionItem): number => item.personEvidence?.eyeState === 'open' ? 4 : item.personEvidence?.eyeState === 'closed' ? -10 : item.personEvidence?.eyeState === 'mixed' ? -5 : 0
  if (aSubjectEdge + eyeScore(a) !== bSubjectEdge + eyeScore(b)) return (bSubjectEdge + eyeScore(b)) - (aSubjectEdge + eyeScore(a))
  if (aEdge !== bEdge) return bEdge - aEdge
  return b.recommendationScore - a.recommendationScore
}

function refreshScores(item: AiSelectionItem, grouped: boolean, preference?: AiSelectionPreferenceProfile): void {
  const set = (key: keyof Omit<AiSelectionItem['scores'], 'total'>, raw: number | null, normalized: number): void => {
    item.scores[key].raw = raw
    item.scores[key].normalized = Math.min(1, Math.max(0, normalized))
  }
  set('quality', item.quality?.score ?? null, (item.quality?.score ?? 0) / 100)
  set('people', item.personEvidence?.confidence ?? null, item.personEvidence?.detected ? item.personEvidence.confidence : 0)
  set('composition', item.quality?.edgeScore ?? null, (item.quality?.edgeScore ?? 0) / 24)
  set('aesthetics', null, (item.quality?.score ?? 0) / 100)
  set('relevance', item.contentTags.length, Math.min(1, item.contentTags.length / 4))
  set('diversity', grouped ? 0.5 : 1, grouped ? 0.5 : 1)
  if (preference) {
    for (const key of Object.keys(preference.weights) as Array<keyof typeof preference.weights>) {
      item.scores[key].weight = preference.weights[key]
    }
  }
  const dimensions = Object.values(item.scores).filter((value): value is { normalized: number; weight: number } => typeof value === 'object')
  const weight = dimensions.reduce((sum, dimension) => sum + dimension.weight, 0) || 1
  item.scores.total = Math.round(dimensions.reduce((sum, dimension) => sum + dimension.normalized * dimension.weight, 0) / weight * 100)
  item.recommendationScore = item.scores.total
}

export function applySelectionPlan(items: AiSelectionItem[], groups: AiSelectionGroup[], preset: AiSelectionPreset, purpose: AiSelectionPurpose = 'general', targetSetting: AiSelectionTarget = { mode: 'preset', value: null }, preference?: AiSelectionPreferenceProfile): void {
  targetSetting = normalizeSelectionTarget(targetSetting)
  const grouped = new Map(groups.flatMap((group) => group.itemIds.map((id) => [id, group] as const)))
  for (const item of items) {
    item.groupId = grouped.get(item.id)?.id ?? null
    item.recommendationReason = null
    item.flags.duplicate = grouped.get(item.id)?.kind === 'duplicate'
    item.flags.lowQuality = item.quality?.grade === 'review'
    item.flags.closedEyes = item.personEvidence?.eyeState === 'closed' || item.personEvidence?.eyeState === 'mixed'
    item.flags.analysisFailed = Boolean(item.error)
    refreshScores(item, Boolean(grouped.get(item.id)), preference)
    if (item.decisionSource === 'ai') item.state = 'undecided'
  }

  const candidates = items.filter((item) => {
    if (item.analysisState !== 'ready' || item.error || item.quality?.grade === 'review') return false
    if (item.kind === 'video') return purpose === 'editing'
    if (purpose === 'people' && item.personEvidence?.detected !== true && !item.contentTags.includes('人物')) return false
    const group = grouped.get(item.id)
    return !group || group.representativeId === item.id
  }).sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt))
  const baseRatio = preset === 'quick' ? 0.2 : preset === 'deep' ? 0.5 : 0.35
  const ratio = Math.min(0.65, baseRatio + (purpose === 'travel' ? 0.08 : purpose === 'editing' ? 0.05 : 0))
  const candidateIds = new Set(candidates.map((item) => item.id))
  const eligibleGroups = groups.filter((group) => candidateIds.has(group.representativeId))
  const requestedTarget = targetSetting.mode === 'count'
    ? Math.round(targetSetting.value ?? 0)
    : targetSetting.mode === 'ratio'
      ? Math.round(candidates.length * Math.min(1, Math.max(0.01, targetSetting.value ?? ratio)))
      : Math.round(candidates.length * ratio)
  const target = Math.min(candidates.length, Math.max(eligibleGroups.length, requestedTarget))
  const chosen = new Set<string>()
  for (const group of eligibleGroups) chosen.add(group.representativeId)
  const remainingTarget = Math.max(0, target - chosen.size)
  if (remainingTarget > 0) {
    const step = candidates.length / remainingTarget
    for (let index = 0; index < remainingTarget; index += 1) {
      const start = Math.floor(index * step)
      const end = Math.max(start + 1, Math.floor((index + 1) * step))
      const best = candidates.slice(start, end).filter((item) => !chosen.has(item.id)).sort(compareRepresentative)[0]
      if (best) chosen.add(best.id)
    }
  }

  for (const item of items) {
    if (item.decisionSource === 'user') continue
    const group = grouped.get(item.id)
    if (item.quality?.grade === 'review' || item.error || item.flags.closedEyes) {
      item.state = 'undecided'
      item.recommendationReason = item.quality?.reasons[0] ?? '需要人工确认'
    } else if (chosen.has(item.id)) {
      item.state = 'recommended'
      item.recommendationReason = group
        ? `从 ${group.itemIds.length} 个相似素材中优先推荐`
        : purpose === 'people' ? '人物素材候选' : purpose === 'travel' ? '用于保持旅程内容覆盖' : purpose === 'editing' ? '可作为剪辑候选素材' : '用于保持拍摄过程的内容覆盖'
    } else if (group) {
      item.state = 'alternative'
      item.recommendationReason = '相似组备选'
    } else {
      item.state = 'undecided'
    }
  }
}

export function applyVideoSegmentSelection(item: AiSelectionItem, segmentId: string, state: AiSelectionItem['state']): void {
  const segment = item.videoSegments.find((candidate) => candidate.id === segmentId)
  if (!segment) throw new Error('视频片段不存在')
  segment.state = state
  segment.decisionSource = 'user'
  item.state = item.videoSegments.some((candidate) => candidate.state === 'kept') ? 'kept' : state
  item.decisionSource = 'user'
}
