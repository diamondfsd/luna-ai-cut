import assert from 'node:assert/strict'

import {
  analyzeRgb,
  applySelectionPlan,
  applyVideoSegmentSelection,
  buildShootingEvents,
  buildSimilarityGroups,
  hammingDistance,
} from '../electron/aiSelectionAlgorithms.ts'
import { deriveBasicSemanticTags } from '../electron/aiSelectionTags.ts'

function quality(score = 80) {
  return {
    score,
    grade: score >= 72 ? 'good' : 'review',
    reasons: [],
    luminanceMean: 128,
    darkRatio: 0,
    brightRatio: 0,
    contrast: 30,
    edgeScore: 12,
    entropy: 3,
  }
}

function item(id, capturedAt, overrides = {}) {
  return {
    id,
    path: `/tmp/${id}.jpg`,
    name: `${id}.jpg`,
    kind: 'image',
    analysisState: 'ready',
    bytes: 100,
    mtimeMs: Date.parse(capturedAt),
    capturedAt,
    device: 'camera-a',
    width: 4000,
    height: 3000,
    duration: null,
    thumbnailUrl: null,
    exactHash: null,
    perceptualHash: '0f0f0f0f0f0f0f0f',
    luminanceHistogram: [0.1, 0.2, 0.3, 0.4],
    visualSignature: Array.from({ length: 48 }, () => 1 / Math.sqrt(48)),
    quality: quality(),
    personEvidence: null,
    videoKeyframes: [],
    videoSegments: [],
    semanticTags: ['照片'],
    contentTags: [],
    contentTagVersion: null,
    contentTagError: null,
    eventId: null,
    similarityGroupId: null,
    recommendationScore: 80,
    recommendationReason: null,
    selected: true,
    selectionSource: 'ai',
    error: null,
    ...overrides,
  }
}

const dark = analyzeRgb(new Uint8Array(64 * 64 * 3), 64, 64)
assert.equal(dark.quality.grade, 'review')
assert.ok(dark.quality.reasons.includes('画面接近全黑'))
assert.equal(dark.visualSignature.length, 48)
assert.ok(dark.visualSignature.every(Number.isFinite))

const white = new Uint8Array(64 * 64 * 3).fill(255)
const bright = analyzeRgb(white, 64, 64)
assert.equal(bright.quality.grade, 'review')
assert.ok(bright.quality.reasons.includes('画面严重过曝'))
assert.equal(hammingDistance(dark.perceptualHash, dark.perceptualHash), 0)
assert.equal(hammingDistance('0000000000000000', '000000000000000f'), 4)

const nightTags = deriveBasicSemanticTags({
  ...item('night', new Date(2026, 5, 20, 20, 18).toISOString()),
  quality: { ...quality(), luminanceMean: 68 },
  width: 4000,
  height: 3000,
})
assert.ok(nightTags.includes('夜景'))
assert.ok(nightTags.includes('低光'))
assert.ok(nightTags.includes('横屏'))
const portraitTags = deriveBasicSemanticTags({
  ...item('portrait', new Date(2026, 5, 20, 10).toISOString()),
  personEvidence: { detected: true, coverage: 0.2, confidence: 0.8, subjectEdgeScore: 10, bounds: null, faceCount: 1, primaryFaceBounds: null, faceVisibility: 'visible', eyeState: 'open', closedEyeConfidence: null, reason: '找到人物' },
})
assert.ok(portraitTags.includes('人物'))
assert.ok(portraitTags.includes('单人'))

const eventItems = [
  item('a', '2026-07-18T01:00:00.000Z'),
  item('b', '2026-07-18T01:01:00.000Z'),
  item('c', '2026-07-18T03:00:00.000Z'),
]
const events = buildShootingEvents(eventItems)
assert.equal(events.length, 2)
assert.deepEqual(events[0].itemIds, ['a', 'b'])

const exactItems = [
  item('exact-a', '2026-07-18T01:00:00.000Z', { exactHash: 'same', recommendationScore: 70 }),
  item('exact-b', '2026-07-18T01:00:01.000Z', { exactHash: 'same', recommendationScore: 90 }),
  item('near-a', '2026-07-18T01:00:02.000Z', { perceptualHash: 'aaaaaaaaaaaaaaaa' }),
  item('near-b', '2026-07-18T01:00:03.000Z', { perceptualHash: 'aaaaaaaaaaaaaaab' }),
]
const oneEvent = [{ id: 'event', name: 'event', startAt: exactItems[0].capturedAt, endAt: exactItems[3].capturedAt, itemIds: exactItems.map((entry) => entry.id), userModified: false }]
const groups = buildSimilarityGroups(exactItems, oneEvent)
assert.equal(groups.length, 2)
assert.equal(groups.find((group) => group.kind === 'exact')?.representativeId, 'exact-b')
assert.deepEqual(groups.find((group) => group.kind === 'near')?.itemIds, ['near-a', 'near-b'])

const exposureVariants = [
  item('exposure-a', '2026-07-18T01:00:00.000Z', { perceptualHash: '0000000000000000', luminanceHistogram: [1, 0, 0, 0] }),
  item('exposure-b', '2026-07-18T01:00:10.000Z', { perceptualHash: 'ffffffffffffffff', luminanceHistogram: [0, 0, 0, 1] }),
]
const exposureEvent = [{ id: 'exposure-event', name: 'event', startAt: exposureVariants[0].capturedAt, endAt: exposureVariants[1].capturedAt, itemIds: exposureVariants.map((entry) => entry.id), userModified: false }]
assert.deepEqual(buildSimilarityGroups(exposureVariants, exposureEvent)[0]?.itemIds, ['exposure-a', 'exposure-b'])

const selectionItems = Array.from({ length: 20 }, (_, index) => item(`selection-${index}`, `2026-07-18T01:00:${String(index).padStart(2, '0')}.000Z`, {
  perceptualHash: `${index.toString(16).padStart(16, '0')}`,
  luminanceHistogram: [0.05, 0.15, 0.3, 0.5],
}))
applySelectionPlan(selectionItems, [], 'balanced')
assert.equal(selectionItems.filter((entry) => entry.selected).length, 7)
assert.ok(selectionItems.filter((entry) => entry.selected).every((entry) => entry.recommendationReason))
applySelectionPlan(selectionItems, [], 'balanced', 'general', 'assist')
assert.equal(selectionItems.filter((entry) => entry.selected).length, 0)
assert.equal(selectionItems.filter((entry) => entry.recommendationReason).length, 7)

const peopleItems = [
  item('no-person', '2026-07-18T01:00:00.000Z'),
  item('person', '2026-07-18T01:01:00.000Z', { contentTags: ['人物'], semanticTags: ['照片', '人物'] }),
]
applySelectionPlan(peopleItems, [], 'deep', 'people', 'auto')
assert.equal(peopleItems[0].selected, false)
assert.equal(peopleItems[0].recommendationReason, null)
assert.equal(peopleItems[1].selected, true)
assert.equal(peopleItems[1].recommendationReason, '人物素材候选')

const video = item('video-segments', '2026-07-18T01:00:00.000Z', {
  kind: 'video',
  videoSegments: [
    { id: 'segment-a', startTime: 0, endTime: 2, status: 'usable', reasons: [], selected: false },
    { id: 'segment-b', startTime: 2, endTime: 4, status: 'usable', reasons: [], selected: false },
  ],
})
applyVideoSegmentSelection(video, 'segment-b', true)
assert.equal(video.selected, true)
assert.deepEqual(video.videoSegments.map((segment) => segment.selected), [false, true])
assert.equal(video.selectionSource, 'user')
video.selected = false
video.videoSegments.forEach((segment) => { segment.selected = false })
assert.deepEqual(video.videoSegments.map((segment) => segment.selected), [false, false])

console.log('AI selection algorithm tests passed')
