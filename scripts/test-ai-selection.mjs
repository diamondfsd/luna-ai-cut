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
import { applyAiSelectionUserOperation } from '../electron/aiSelectionOperations.ts'
import {
  countSimilarityGroups,
  matchesResultFilter,
  matchesSelectionSearch,
} from '../src/ai-selection/aiSelectionView.ts'

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
    imageEmbedding: null,
    embeddingVersion: null,
    embeddingError: null,
    quality: quality(),
    personEvidence: null,
    videoKeyframes: [],
    videoSegments: [],
    semanticTags: ['照片'],
    contentTags: [],
    contentTagVersion: null,
    contentTagError: null,
    sceneId: null,
    groupId: null,
    recommendationScore: 80,
    recommendationReason: null,
    state: 'undecided',
    decisionSource: 'ai',
    flags: { lowQuality: false, duplicate: false, closedEyes: false, analysisFailed: false },
    scores: {
      quality: { raw: 80, normalized: 0.8, weight: 0.45 },
      people: { raw: null, normalized: 0, weight: 0.2 },
      composition: { raw: null, normalized: 0, weight: 0.15 },
      aesthetics: { raw: null, normalized: 0, weight: 0.05 },
      relevance: { raw: null, normalized: 0, weight: 0.1 },
      diversity: { raw: null, normalized: 0, weight: 0.05 },
      total: 80,
    },
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

const crossDirectoryEvent = buildShootingEvents([
  item('directory-a', '2026-07-18T01:00:00.000Z', { path: '/tmp/a/directory-a.jpg' }),
  item('directory-b', '2026-07-18T01:01:00.000Z', { path: '/tmp/b/directory-b.jpg' }),
])
assert.equal(crossDirectoryEvent.length, 1, '同一设备的连续拍摄不能因目录不同被拆开')

const exactItems = [
  item('exact-a', '2026-07-18T01:00:00.000Z', { exactHash: 'same', recommendationScore: 70 }),
  item('exact-b', '2026-07-18T01:00:01.000Z', { exactHash: 'same', recommendationScore: 90 }),
  item('near-a', '2026-07-18T01:00:02.000Z', { perceptualHash: 'aaaaaaaaaaaaaaaa', sceneId: 'event' }),
  item('near-b', '2026-07-18T01:00:03.000Z', { perceptualHash: 'aaaaaaaaaaaaaaab', sceneId: 'event' }),
]
const oneEvent = [{ id: 'event', name: 'event', startAt: exactItems[0].capturedAt, endAt: exactItems[3].capturedAt, itemIds: exactItems.map((entry) => entry.id), coverItemId: exactItems[0].id, confirmation: 'pending', recommendedCount: 0, userModified: false }]
const groups = buildSimilarityGroups(exactItems, oneEvent)
assert.equal(groups.length, 2)
assert.equal(groups.find((group) => group.kind === 'duplicate')?.representativeId, 'exact-b')
assert.deepEqual(groups.find((group) => group.kind === 'burst')?.itemIds, ['near-a', 'near-b'])

const exposureVariants = [
  item('exposure-a', '2026-07-18T01:00:00.000Z', { perceptualHash: '0000000000000000', luminanceHistogram: [1, 0, 0, 0], imageEmbedding: [127, ...Array(383).fill(0)], embeddingVersion: 'test', sceneId: 'exposure-event' }),
  item('exposure-b', '2026-07-18T01:00:10.000Z', { perceptualHash: 'ffffffffffffffff', luminanceHistogram: [0, 0, 0, 1], imageEmbedding: [124, 25, ...Array(382).fill(0)], embeddingVersion: 'test', sceneId: 'exposure-event' }),
]
const exposureEvent = [{ id: 'exposure-event', name: 'event', startAt: exposureVariants[0].capturedAt, endAt: exposureVariants[1].capturedAt, itemIds: exposureVariants.map((entry) => entry.id), coverItemId: exposureVariants[0].id, confirmation: 'pending', recommendedCount: 0, userModified: false }]
assert.deepEqual(buildSimilarityGroups(exposureVariants, exposureEvent)[0]?.itemIds, ['exposure-a', 'exposure-b'])

const colorOnlyVariants = exposureVariants.map((entry) => ({ ...entry, id: `${entry.id}-color`, imageEmbedding: null, embeddingVersion: null }))
assert.equal(buildSimilarityGroups(colorOnlyVariants, exposureEvent).length, 0, '仅颜色布局接近不能判为相似')

const selectionItems = Array.from({ length: 20 }, (_, index) => item(`selection-${index}`, `2026-07-18T01:00:${String(index).padStart(2, '0')}.000Z`, {
  perceptualHash: `${index.toString(16).padStart(16, '0')}`,
  luminanceHistogram: [0.05, 0.15, 0.3, 0.5],
}))
applySelectionPlan(selectionItems, [], 'balanced')
assert.equal(selectionItems.filter((entry) => entry.state === 'recommended').length, 7)
assert.ok(selectionItems.filter((entry) => entry.state === 'recommended').every((entry) => entry.recommendationReason))
selectionItems[0].state = 'rejected'
selectionItems[0].decisionSource = 'user'
applySelectionPlan(selectionItems, [], 'deep')
assert.equal(selectionItems[0].state, 'rejected', '人工决定不能被推荐重算覆盖')

const groupedSelectionItems = [
  item('group-target-a', '2026-07-18T01:00:00.000Z'),
  item('group-target-b', '2026-07-18T01:00:01.000Z'),
  item('group-target-c', '2026-07-18T01:00:02.000Z'),
  item('group-target-d', '2026-07-18T01:00:03.000Z'),
]
const forcedGroups = [
  { id: 'target-group-1', sceneId: 'event', kind: 'burst', itemIds: ['group-target-a', 'group-target-b'], representativeId: 'group-target-a', reason: '', confidence: 0.9, suggestedKeepCount: 1, confirmation: 'pending', userModified: false },
  { id: 'target-group-2', sceneId: 'event', kind: 'burst', itemIds: ['group-target-c', 'group-target-d'], representativeId: 'group-target-c', reason: '', confidence: 0.9, suggestedKeepCount: 1, confirmation: 'pending', userModified: false },
]
applySelectionPlan(groupedSelectionItems, forcedGroups, 'balanced', 'general', { mode: 'count', value: 1 })
assert.equal(groupedSelectionItems.filter((entry) => entry.state === 'recommended').length, 1, '相似组不能强制突破用户设置的推荐数量')

const peopleItems = [
  item('no-person', '2026-07-18T01:00:00.000Z'),
  item('person', '2026-07-18T01:01:00.000Z', { contentTags: ['人物'], semanticTags: ['照片', '人物'] }),
]
applySelectionPlan(peopleItems, [], 'deep', 'people')
assert.equal(peopleItems[0].state, 'undecided')
assert.equal(peopleItems[0].recommendationReason, null)
assert.equal(peopleItems[1].state, 'recommended')
assert.equal(peopleItems[1].recommendationReason, '人物素材候选')

const video = item('video-segments', '2026-07-18T01:00:00.000Z', {
  kind: 'video',
  videoSegments: [
    { id: 'segment-a', startTime: 0, endTime: 2, status: 'usable', reasons: [], state: 'recommended', decisionSource: 'ai' },
    { id: 'segment-b', startTime: 2, endTime: 4, status: 'usable', reasons: [], state: 'alternative', decisionSource: 'ai' },
  ],
})
applyVideoSegmentSelection(video, 'segment-b', 'kept')
assert.equal(video.state, 'kept')
assert.deepEqual(video.videoSegments.map((segment) => segment.state), ['recommended', 'kept'])
assert.equal(video.decisionSource, 'user')

const viewItems = [
  item('group-person-a', '2026-07-18T01:00:00.000Z', { groupId: 'group-person', state: 'recommended', semanticTags: ['照片', '人物'], recommendationReason: '组内人物更清晰' }),
  item('group-person-b', '2026-07-18T01:00:01.000Z', { groupId: 'group-person', state: 'alternative', semanticTags: ['照片', '人物'], recommendationReason: '相似组备选' }),
  item('night', '2026-07-18T02:00:00.000Z', { semanticTags: ['照片', '夜景'], recommendationReason: '独特内容' }),
]
const comparedPeople = viewItems.filter((entry) => matchesResultFilter(entry, 'recommended') && matchesSelectionSearch(entry, '人物'))
assert.equal(comparedPeople.length, 2, '相似筛选应返回真实照片数')
assert.equal(countSimilarityGroups(comparedPeople), 1, '相似筛选应单独统计组数')
assert.equal(viewItems.filter((entry) => matchesResultFilter(entry, 'recommended')).length, 2)
assert.equal(viewItems.filter((entry) => matchesSelectionSearch(entry, '晚上')).length, 1)

const sceneSession = {
  preset: 'balanced',
  purpose: 'general',
  target: { mode: 'preset', value: null },
  items: [item('scene-best', '2026-07-18T04:00:00.000Z', { state: 'recommended' }), item('scene-alt', '2026-07-18T04:00:01.000Z', { state: 'alternative' })],
  scenes: [{ id: 'scene', name: '场景', startAt: '2026-07-18T04:00:00.000Z', endAt: '2026-07-18T04:00:01.000Z', itemIds: ['scene-best', 'scene-alt'], coverItemId: 'scene-best', confirmation: 'pending', recommendedCount: 1, userModified: false }],
  groups: [],
  preferenceProfile: { sampleCount: 0, weights: { quality: 0.45, people: 0.2, composition: 0.15, aesthetics: 0.05, relevance: 0.1, diversity: 0.05 } },
}
applyAiSelectionUserOperation(sceneSession, { type: 'confirm-scene', sceneId: 'scene' })
assert.deepEqual(sceneSession.items.map((entry) => entry.state), ['kept', 'rejected'])
assert.deepEqual(sceneSession.items.map((entry) => entry.decisionSource), ['user', 'user'])
assert.equal(sceneSession.scenes[0].confirmation, 'confirmed')
applyAiSelectionUserOperation(sceneSession, { type: 'set-state', itemId: 'scene-best', state: 'kept' })
assert.equal(sceneSession.preferenceProfile.sampleCount, 1)

console.log('AI selection algorithm tests passed')
