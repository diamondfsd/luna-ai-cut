import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  analyzeRgb,
  applySelectionPlan,
  applyVideoSegmentSelection,
  buildShootingEvents,
  buildSimilarityGroups,
  hammingDistance,
} from '../electron/features/ai-selection/aiSelectionAlgorithms.ts'
import { deriveBasicSemanticTags } from '../electron/features/ai-selection/aiSelectionTags.ts'
import { applyAiSelectionUserOperation } from '../electron/features/ai-selection/aiSelectionOperations.ts'
import { readAiSelectionItemCache, writeAiSelectionItemCache } from '../electron/features/ai-selection/aiSelectionItemCache.ts'
import { prepareAiSelectionReanalysis, preserveAiSelectionUserDecisions } from '../electron/features/ai-selection/aiSelectionReanalysis.ts'
import { buildFaceGroups, DEFAULT_FACE_GROUPING_THRESHOLD, FACE_EMBEDDING_VERSION, faceEmbeddingsForGroup, hasSufficientFacePixels } from '../electron/features/ai-selection/aiSelectionFaceGroups.ts'
import { createPersonIdentity, loadPeopleStore, savePeopleStore } from '../electron/features/ai-selection/aiSelectionPeopleStore.ts'
import { buildGlobalFaceGroups, hideGlobalPerson, listHiddenGlobalPeople, loadGlobalPeople, mergeGlobalPeople, reconcileGlobalPeopleSources, restoreGlobalPerson, unmergeGlobalPerson } from '../electron/features/ai-selection/aiSelectionPeopleManager.ts'
import { FACE_AVATAR_CONTEXT_SCALE, squareCropAroundCenter } from '../src/shared/aiAvatarCrop.ts'
import {
  aiSelectionAnalysisProgress,
  countSimilarityGroups,
  matchesResultFilter,
} from '../src/ai-selection/aiSelectionView.ts'
import { buildCoPhotoGroups } from '../src/ai-selection/aiCoPhotoGroups.ts'
import { coverFittedFaceBounds } from '../src/ai-selection/aiFaceOverlayGeometry.ts'

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
    flags: { aiRecommended: false, lowQuality: false, duplicate: false, closedEyes: false, analysisFailed: false },
    scores: {
      quality: { raw: 80, normalized: 0.8, weight: 0.4 },
      people: { raw: null, normalized: 0.5, weight: 0.2 },
      composition: { raw: null, normalized: 0.5, weight: 0.1 },
      relevance: { raw: null, normalized: 0.5, weight: 0.2 },
      diversity: { raw: null, normalized: 0.5, weight: 0.1 },
      total: 80,
    },
    error: null,
    ...overrides,
  }
}

const dark = analyzeRgb(new Uint8Array(64 * 64 * 3), 64, 64)
assert.equal(DEFAULT_FACE_GROUPING_THRESHOLD, 0.42, '人物分组默认阈值应使用验证后的预置')
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

const crossDeviceEvent = buildShootingEvents([
  item('camera-photo', '2026-07-18T05:04:26.000Z', { device: 'Insta360 Luna Ultra' }),
  item('camera-video', '2026-07-18T05:04:36.000Z', { device: null }),
])
assert.equal(crossDeviceEvent.length, 1, '同日连续拍摄不能因设备字段不同被拆开')
assert.deepEqual(crossDeviceEvent[0].itemIds, ['camera-photo', 'camera-video'])

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
const peopleProgress = aiSelectionAnalysisProgress({
  phase: 'people',
  counts: { total: 3, completed: 3 },
  items: [
    item('people-ready', '2026-07-18T01:01:00.000Z', { personEvidence: { detected: false } }),
    item('people-skipped', '2026-07-18T01:01:01.000Z', { semanticTags: ['人物分析未完成'] }),
    item('people-pending', '2026-07-18T01:01:02.000Z'),
  ],
})
assert.deepEqual([peopleProgress.phaseCompleted, peopleProgress.phaseTotal], [2, 3], '人物阶段应显示独立的实际处理进度')
const manuallyKept = item('manual-reanalysis', '2026-07-18T01:01:03.000Z', { state: 'kept', decisionSource: 'user', personEvidence: { detected: true } })
const reanalysisSession = { status: 'ready', phase: 'done', error: '旧错误', items: [manuallyKept, item('ai-reanalysis', '2026-07-18T01:01:04.000Z', { state: 'kept' })] }
prepareAiSelectionReanalysis(reanalysisSession)
assert.deepEqual([reanalysisSession.status, reanalysisSession.phase, reanalysisSession.forceReanalysis], ['queued', 'indexing', true])
assert.deepEqual(reanalysisSession.items.map((entry) => [entry.analysisState, entry.state]), [['pending', 'kept'], ['pending', 'undecided']], '重新分析应重置 AI 结果并保留人工选择')
const refreshedManualItem = preserveAiSelectionUserDecisions(reanalysisSession.items[0], item('manual-reanalysis', '2026-07-18T01:01:03.000Z'))
assert.deepEqual([refreshedManualItem.state, refreshedManualItem.decisionSource], ['kept', 'user'], '新分析结果不能覆盖人工选择')
const itemCacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'luna-ai-selection-item-cache-'))
try {
  await writeAiSelectionItemCache(itemCacheDir, 'test-v1', item('media_abc', '2026-07-18T01:01:05.000Z', { state: 'kept', decisionSource: 'user' }), 'balanced')
  const cachedManualItem = await readAiSelectionItemCache(itemCacheDir, 'test-v1', 'media_abc', 'balanced')
  assert.deepEqual([cachedManualItem?.state, cachedManualItem?.decisionSource], ['undecided', 'ai'], '共享分析缓存不能保存任务中的人工选择')
} finally {
  await fs.rm(itemCacheDir, { recursive: true, force: true })
}
const analyzingSelectionItems = structuredClone(selectionItems)
applySelectionPlan(analyzingSelectionItems, [], 'balanced', 'general', { mode: 'preset', value: null }, undefined, false)
assert.equal(analyzingSelectionItems.filter((entry) => entry.state === 'kept').length, 0, '分析过程中不应自动选择临时推荐')
assert.equal(analyzingSelectionItems.filter((entry) => entry.flags.aiRecommended).length, 0, '分析过程中不应发布临时推荐')
applySelectionPlan(analyzingSelectionItems, [], 'balanced')
assert.equal(analyzingSelectionItems.filter((entry) => entry.state === 'kept').length, 7, '分析完成后应一次性自动选择最终推荐')
applySelectionPlan(selectionItems, [], 'balanced')
assert.equal(selectionItems.filter((entry) => entry.state === 'kept').length, 7, 'AI 推荐素材应自动选中')
assert.equal(selectionItems.filter((entry) => entry.flags.aiRecommended).length, 7)
assert.ok(selectionItems.filter((entry) => entry.flags.aiRecommended).every((entry) => entry.recommendationReason))
selectionItems[0].state = 'rejected'
selectionItems[0].decisionSource = 'user'
applySelectionPlan(selectionItems, [], 'deep')
assert.equal(selectionItems[0].state, 'rejected', '人工决定不能被推荐重算覆盖')
assert.equal(typeof selectionItems[0].flags.aiRecommended, 'boolean', '人工决定与 AI 推荐身份必须独立保存')

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
assert.equal(groupedSelectionItems.filter((entry) => entry.state === 'kept').length, 1, '相似组不能强制突破用户设置的推荐数量')

const peopleItems = [
  item('no-person', '2026-07-18T01:00:00.000Z'),
  item('person', '2026-07-18T01:01:00.000Z', { contentTags: ['人物'], semanticTags: ['照片', '人物'] }),
]
applySelectionPlan(peopleItems, [], 'deep', 'people')
assert.equal(peopleItems[0].state, 'undecided')
assert.equal(peopleItems[0].recommendationReason, null)
assert.equal(peopleItems[1].state, 'kept')
assert.match(peopleItems[1].recommendationReason, /^综合评分 \d+ · 识别到人物$/)

const faceEvidence = (eyeState, subjectEdgeScore) => ({
  detected: true,
  coverage: 0.2,
  confidence: 0.8,
  subjectEdgeScore,
  bounds: { x: 0.28, y: 0.16, width: 0.34, height: 0.68 },
  faceCount: 1,
  primaryFaceBounds: { x: 0.36, y: 0.2, width: 0.15, height: 0.2 },
  faceVisibility: 'clear',
  eyeState,
  closedEyeConfidence: eyeState === 'closed' ? 0.9 : 0.1,
  reason: eyeState === 'closed' ? '检测到高可信闭眼' : '人物睁眼',
})
const eyeSelectionItems = [
  item('closed-higher-quality', '2026-07-18T02:00:00.000Z', { quality: quality(96), personEvidence: faceEvidence('closed', 15), contentTags: ['人物'], contentTagVersion: 'test' }),
  item('open-lower-quality', '2026-07-18T02:00:01.000Z', { quality: quality(78), personEvidence: faceEvidence('open', 11), contentTags: ['人物'], contentTagVersion: 'test' }),
]
applySelectionPlan(eyeSelectionItems, [], 'deep', 'people', { mode: 'count', value: 1 })
assert.equal(eyeSelectionItems[0].state, 'undecided', '高分闭眼素材不能进入 AI 推荐')
assert.equal(eyeSelectionItems[0].flags.closedEyes, true)
assert.equal(eyeSelectionItems[1].state, 'kept')
assert.match(eyeSelectionItems[1].recommendationReason, /人物睁眼/)

const metadataOnlyVideo = item('metadata-only-video', '2026-07-18T02:10:00.000Z', {
  kind: 'video',
  quality: null,
  perceptualHash: null,
  luminanceHistogram: null,
  visualSignature: null,
  semanticTags: ['视频'],
})
applySelectionPlan([metadataOnlyVideo], [], 'deep', 'editing', { mode: 'count', value: 1 })
assert.equal(metadataOnlyVideo.state, 'undecided', '视频不能进入画质推荐')
assert.equal(metadataOnlyVideo.flags.aiRecommended, false, '视频不能带有 AI 推荐标记')

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
  item('group-person-a', '2026-07-18T01:00:00.000Z', { groupId: 'group-person', state: 'recommended', flags: { aiRecommended: true, lowQuality: false, duplicate: false, closedEyes: false, analysisFailed: false }, semanticTags: ['照片', '人物'], recommendationReason: '组内人物更清晰' }),
  item('group-person-b', '2026-07-18T01:00:01.000Z', { groupId: 'group-person', state: 'alternative', semanticTags: ['照片', '人物'], recommendationReason: '相似组备选' }),
  item('night', '2026-07-18T02:00:00.000Z', { semanticTags: ['照片', '夜景'], recommendationReason: '独特内容' }),
]
const comparedPeople = viewItems.filter((entry) => matchesResultFilter(entry, 'recommended'))
assert.equal(comparedPeople.length, 1, 'AI 推荐不能混入相似组备选素材')
assert.equal(countSimilarityGroups(comparedPeople), 1, '相似筛选应单独统计组数')
assert.equal(viewItems.filter((entry) => matchesResultFilter(entry, 'recommended')).length, 1)

const faceVector = (first, second) => [first, second, ...Array(126).fill(0)]
const faceItems = [
  item('face-a', '2026-07-18T03:00:00.000Z', { personEvidence: { ...faceEvidence('open', 12), faces: [{ bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.25 }, embedding: faceVector(127, 0), embeddingVersion: FACE_EMBEDDING_VERSION }] } }),
  item('face-a-again', '2026-07-18T03:01:00.000Z', { personEvidence: { ...faceEvidence('open', 12), faces: [{ bounds: { x: 0.3, y: 0.2, width: 0.2, height: 0.25 }, embedding: faceVector(125, 8), embeddingVersion: FACE_EMBEDDING_VERSION }] } }),
  item('face-b', '2026-07-18T03:02:00.000Z', { personEvidence: { ...faceEvidence('open', 12), faces: [{ bounds: { x: 0.4, y: 0.2, width: 0.2, height: 0.25 }, embedding: faceVector(0, 127), embeddingVersion: FACE_EMBEDDING_VERSION }] } }),
  item('face-a-and-b', '2026-07-18T03:03:00.000Z', { personEvidence: { ...faceEvidence('open', 12), bounds: { x: 0.15, y: 0.12, width: 0.72, height: 0.72 }, faces: [
    { bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.25 }, embedding: faceVector(126, 4), embeddingVersion: FACE_EMBEDDING_VERSION },
    { bounds: { x: 0.6, y: 0.2, width: 0.2, height: 0.25 }, embedding: faceVector(3, 126), embeddingVersion: FACE_EMBEDDING_VERSION },
  ] } }),
]
const faceGroups = buildFaceGroups(faceItems)
assert.equal(faceGroups.length, 2)
assert.deepEqual(faceGroups[0].itemIds, ['face-a', 'face-a-again', 'face-a-and-b'])
assert.deepEqual(faceGroups[1].itemIds, ['face-b', 'face-a-and-b'])
assert.deepEqual(coverFittedFaceBounds({ x: 0.25, y: 0.25, width: 0.25, height: 0.25 }, 4000, 3000), { x: 0.25, y: 0.25, width: 0.25, height: 0.25 }, '4:3 照片的人脸框应保持原始位置')
const portraitFaceBounds = coverFittedFaceBounds({ x: 0.25, y: 0.25, width: 0.25, height: 0.25 }, 3000, 4000)
assert.ok(Math.abs(portraitFaceBounds.x - 0.25) < 1e-9)
assert.ok(Math.abs(portraitFaceBounds.y - 1 / 18) < 1e-9)
assert.ok(Math.abs(portraitFaceBounds.width - 0.25) < 1e-9)
assert.ok(Math.abs(portraitFaceBounds.height - 4 / 9) < 1e-9, '竖图的人脸框应补偿缩略图的上下裁切')
const avatarCrop = squareCropAroundCenter({ x: 0.4, y: 0.3, width: 0.12, height: 0.3 }, 4000, 3000, FACE_AVATAR_CONTEXT_SCALE)
assert.ok(Math.abs(avatarCrop.width * 4000 - avatarCrop.height * 3000) < 1e-9, '头像裁切必须保持正方形，不拉伸人脸')
assert.ok(avatarCrop.x >= 0 && avatarCrop.y >= 0 && avatarCrop.x + avatarCrop.width <= 1 && avatarCrop.y + avatarCrop.height <= 1, '头像裁切靠近边缘时仍应留在照片范围内')
assert.ok(avatarCrop.height > 0.3, '头像默认选区应在识别框外保留足够留白')

const uncertainIdentity = createPersonIdentity('已确认人物', faceVector(127, 0))
const uncertainFaceGroups = buildFaceGroups([
  item('known-face', '2026-07-18T03:03:10.000Z', { personEvidence: { ...faceEvidence('open', 12), faces: [{ bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.25 }, embedding: faceVector(127, 0), embeddingVersion: FACE_EMBEDDING_VERSION }] } }),
  item('uncertain-face', '2026-07-18T03:03:11.000Z', { personEvidence: { ...faceEvidence('open', 12), faces: [{ bounds: { x: 0.22, y: 0.2, width: 0.2, height: 0.25 }, embedding: faceVector(58, 116), embeddingVersion: FACE_EMBEDDING_VERSION }] } }),
], [uncertainIdentity], 0.5)
assert.equal(uncertainFaceGroups.length, 2, '没有足够相似证据的人脸应保持独立分组')
assert.equal(uncertainFaceGroups.find((group) => group.itemIds.includes('uncertain-face'))?.identityId, null, '弱相似人脸不能被归入已确认人物')
assert.equal(buildFaceGroups([
  item('threshold-known-face', '2026-07-18T03:03:12.000Z', { personEvidence: { ...faceEvidence('open', 12), faces: [{ bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.25 }, embedding: faceVector(127, 0), embeddingVersion: FACE_EMBEDDING_VERSION }] } }),
  item('threshold-near-face', '2026-07-18T03:03:13.000Z', { personEvidence: { ...faceEvidence('open', 12), faces: [{ bounds: { x: 0.22, y: 0.2, width: 0.2, height: 0.25 }, embedding: faceVector(58, 116), embeddingVersion: FACE_EMBEDDING_VERSION }] } }),
], [], 0.44).length, 1, '降低人物分组阈值后应允许较分散的同一人样本合并')

const chainFaceVector = (first, second, third) => [first, second, third, ...Array(125).fill(0)]
const chainFaceGroups = buildFaceGroups([
  item('chain-a-1', '2026-07-18T03:03:20.000Z', { personEvidence: { ...faceEvidence('open', 12), faces: [{ bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.25 }, embedding: chainFaceVector(127, 0, 0), embeddingVersion: FACE_EMBEDDING_VERSION }] } }),
  item('chain-a-2', '2026-07-18T03:03:21.000Z', { personEvidence: { ...faceEvidence('open', 12), faces: [{ bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.25 }, embedding: chainFaceVector(120, 30, 0), embeddingVersion: FACE_EMBEDDING_VERSION }] } }),
  item('chain-a-3', '2026-07-18T03:03:22.000Z', { personEvidence: { ...faceEvidence('open', 12), faces: [{ bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.25 }, embedding: chainFaceVector(85, 95, 0), embeddingVersion: FACE_EMBEDDING_VERSION }] } }),
  item('chain-b-1', '2026-07-18T03:03:23.000Z', { personEvidence: { ...faceEvidence('open', 12), faces: [{ bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.25 }, embedding: chainFaceVector(0, 110, 60), embeddingVersion: FACE_EMBEDDING_VERSION }] } }),
  item('chain-b-2', '2026-07-18T03:03:24.000Z', { personEvidence: { ...faceEvidence('open', 12), faces: [{ bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.25 }, embedding: chainFaceVector(0, 110, 60), embeddingVersion: FACE_EMBEDDING_VERSION }] } }),
])
assert.deepEqual(chainFaceGroups.map((group) => group.itemIds), [
  ['chain-a-1', 'chain-a-2', 'chain-a-3'],
  ['chain-b-1', 'chain-b-2'],
], '不能因一张过渡人脸把两个不同人物串成一个分组')

const sampledVideoFace = item('sampled-video-face', '2026-07-18T03:04:00.000Z', {
  kind: 'video',
  personEvidence: {
    ...faceEvidence('unknown', null),
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    faces: [
      { bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.25 }, embedding: faceVector(127, 0), embeddingVersion: FACE_EMBEDDING_VERSION, frameTime: 1, frameThumbnailUrl: 'file:///tmp/sampled-video-face.jpg' },
      { bounds: { x: 0.35, y: 0.2, width: 0.2, height: 0.25 }, embedding: faceVector(125, 8), embeddingVersion: FACE_EMBEDDING_VERSION, frameTime: 5 },
    ],
  },
})
const sampledVideoGroups = buildFaceGroups([sampledVideoFace])
assert.equal(sampledVideoGroups.length, 1, '视频不同取样帧中的同一人物应合并')
assert.deepEqual(sampledVideoGroups[0].itemIds, ['sampled-video-face'])
assert.equal(sampledVideoGroups[0].coverUrl, 'file:///tmp/sampled-video-face.jpg', '视频人物封面应使用命中人脸的抽样帧')
assert.deepEqual(sampledVideoGroups[0].coverBounds, { x: 0.2, y: 0.2, width: 0.2, height: 0.25 }, '视频人物封面应保留识别框位置')

const globalIdentityGroups = buildFaceGroups(faceItems, [{
  id: 'person-global',
  name: '家人',
  samples: [faceVector(127, 0), faceVector(0, 127)],
  avatarDataUrl: null,
  coverUrl: null,
  coverBounds: null,
  sourceGroupId: null,
  automaticMatching: true,
  mergedIntoId: null,
  hidden: false,
  confirmed: true,
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z',
}])
assert.equal(globalIdentityGroups.length, 1, '全局人物身份应合并本次分析拆开的局部分组')
assert.equal(globalIdentityGroups[0].name, '家人')
assert.equal(globalIdentityGroups[0].identityId, 'person-global')

const coPhotoIdentityItems = [
  item('co-photo-1', '2026-07-18T03:04:10.000Z', { personEvidence: { ...faceEvidence('open', 12), bounds: { x: 0, y: 0, width: 1, height: 1 }, faces: [
    { bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.25 }, embedding: faceVector(127, 0), embeddingVersion: FACE_EMBEDDING_VERSION },
    { bounds: { x: 0.6, y: 0.2, width: 0.2, height: 0.25 }, embedding: faceVector(100, 80), embeddingVersion: FACE_EMBEDDING_VERSION },
  ] } }),
  item('co-photo-2', '2026-07-18T03:04:11.000Z', { personEvidence: { ...faceEvidence('open', 12), bounds: { x: 0, y: 0, width: 1, height: 1 }, faces: [
    { bounds: { x: 0.22, y: 0.2, width: 0.2, height: 0.25 }, embedding: faceVector(127, 0), embeddingVersion: FACE_EMBEDDING_VERSION },
    { bounds: { x: 0.58, y: 0.2, width: 0.2, height: 0.25 }, embedding: faceVector(100, 80), embeddingVersion: FACE_EMBEDDING_VERSION },
  ] } }),
]
const localCoPhotoGroups = buildFaceGroups(coPhotoIdentityItems)
assert.equal(localCoPhotoGroups.length, 2, '同一张合照中的两张脸应先作为独立人物分组')
const renamedSourceGroup = localCoPhotoGroups.find((group) => group.coverBounds.x < 0.5)
assert.ok(renamedSourceGroup, '应找到被改名的人物来源分组')
const renamedIdentity = createPersonIdentity('已命名人物', faceEmbeddingsForGroup(coPhotoIdentityItems, renamedSourceGroup), renamedSourceGroup.id)
const renamedGroups = buildFaceGroups(coPhotoIdentityItems, [renamedIdentity])
assert.equal(renamedGroups.length, 2, '改名后不能把合照中的另一个人自动合并')
assert.equal(renamedGroups.find((group) => group.identityId === renamedIdentity.id)?.name, '已命名人物')
assert.equal(renamedGroups.find((group) => group.identityId !== renamedIdentity.id)?.identityId, null)
const anchoredIdentity = createPersonIdentity('锚定名称', faceEmbeddingsForGroup(coPhotoIdentityItems, renamedSourceGroup), '历史分组标识', { coverUrl: null, coverBounds: null }, {
  itemId: renamedSourceGroup.coverItemId,
  bounds: renamedSourceGroup.coverBounds,
})
const anchoredGroups = buildFaceGroups(coPhotoIdentityItems, [anchoredIdentity], 0.44)
assert.equal(anchoredGroups.find((group) => group.identityId === anchoredIdentity.id)?.name, '锚定名称', '分组 ID 变化后已命名人物应继续绑定到来源人脸')

const peopleStoreRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'luna-ai-selection-people-'))
try {
  const registeredIdentity = createPersonIdentity('人物 1', faceVector(127, 0))
  const secondIdentity = createPersonIdentity('人物 2', faceVector(0, 127))
  const thirdIdentity = createPersonIdentity('人物 3', faceVector(-127, 0))
  const faceItemsForMerge = [...faceItems, item('face-c', '2026-07-18T03:04:00.000Z', {
    personEvidence: { ...faceEvidence('open', 12), faces: [{ bounds: { x: 0.48, y: 0.2, width: 0.2, height: 0.25 }, embedding: faceVector(-127, 0), embeddingVersion: FACE_EMBEDDING_VERSION }] },
  })]
  registeredIdentity.automaticMatching = true
  secondIdentity.automaticMatching = true
  thirdIdentity.automaticMatching = true
  registeredIdentity.avatarDataUrl = `data:image/jpeg;base64,${Buffer.from('avatar').toString('base64')}`
  await savePeopleStore(peopleStoreRoot, [registeredIdentity, secondIdentity, thirdIdentity])
  const reloadedIdentities = await loadPeopleStore(peopleStoreRoot)
  assert.equal(reloadedIdentities[0].avatarDataUrl, registeredIdentity.avatarDataUrl, '人物头像 Base64 应随人物库持久化')
  const reusedGroups = buildFaceGroups([faceItems[1]], reloadedIdentities)
  assert.equal(reusedGroups[0].identityId, registeredIdentity.id, '重新加载人物库后应复用已登记的全局身份')
  assert.equal(reusedGroups[0].coverUrl, registeredIdentity.avatarDataUrl, '重新分组后应继续使用持久化头像')

  await loadGlobalPeople(peopleStoreRoot)
  const groupsBeforeMerge = buildGlobalFaceGroups(faceItemsForMerge)
  const targetGroup = groupsBeforeMerge.find((group) => group.identityId === registeredIdentity.id)
  const sourceGroup = groupsBeforeMerge.find((group) => group.identityId === secondIdentity.id)
  const thirdGroup = groupsBeforeMerge.find((group) => group.identityId === thirdIdentity.id)
  assert.ok(targetGroup && sourceGroup && thirdGroup, '合并前应存在三个独立人物')
  const peopleSession = { items: faceItemsForMerge, faceGroups: groupsBeforeMerge }
  await mergeGlobalPeople(peopleStoreRoot, peopleSession, targetGroup.id, [sourceGroup.id, thirdGroup.id])
  const groupsAfterMerge = buildGlobalFaceGroups(faceItemsForMerge)
  assert.equal(groupsAfterMerge.length, 1, '合并后应作为一个人物参与分组')
  assert.deepEqual(new Set(groupsAfterMerge[0].mergedMembers?.map((member) => member.id)), new Set([secondIdentity.id, thirdIdentity.id]), '合并弹窗应能展示所有来源身份')
  const secondMergedMember = groupsAfterMerge[0].mergedMembers?.find((member) => member.id === secondIdentity.id)
  assert.equal(secondMergedMember?.coverUrl, faceItems[2].path, '合并人物应保留可辨认的人脸缩略图')
  assert.ok((secondMergedMember?.coverBounds?.height ?? 0) > 0.25, '合并人物的缩略图应在人脸框外保留留白')
  await unmergeGlobalPerson(peopleStoreRoot, { ...peopleSession, faceGroups: groupsAfterMerge }, groupsAfterMerge[0].id, secondIdentity.id)
  assert.equal(buildGlobalFaceGroups(faceItemsForMerge).length, 2, '移除一个合并成员后应恢复为独立人物')
  const targetAfterUnmerge = buildGlobalFaceGroups(faceItemsForMerge).find((group) => group.identityId === registeredIdentity.id)
  assert.ok(targetAfterUnmerge, '隐藏前应能找到目标人物')
  await hideGlobalPerson(peopleStoreRoot, { ...peopleSession, faceGroups: buildGlobalFaceGroups(faceItems) }, targetAfterUnmerge.id)
  assert.deepEqual(buildGlobalFaceGroups(faceItems).map((group) => group.identityId), [secondIdentity.id], '隐藏人物后应抑制相同人脸再次出现')
  assert.deepEqual(listHiddenGlobalPeople().map((person) => person.id), [registeredIdentity.id], '隐藏人物应出现在可恢复列表中')
  assert.equal(listHiddenGlobalPeople()[0]?.coverUrl, registeredIdentity.avatarDataUrl, '隐藏人物应保留头像或人脸缩略图')
  await restoreGlobalPerson(peopleStoreRoot, registeredIdentity.id)
  assert.deepEqual(new Set(buildGlobalFaceGroups(faceItems).map((group) => group.identityId)), new Set([registeredIdentity.id, secondIdentity.id]), '恢复人物后应重新进入分组')
  await loadGlobalPeople(peopleStoreRoot)
  assert.deepEqual(new Set(buildGlobalFaceGroups(faceItems).map((group) => group.identityId)), new Set([registeredIdentity.id, secondIdentity.id]), '重新加载人物库后应保留恢复状态')

  const legacyStoreRoot = path.join(peopleStoreRoot, 'legacy')
  await fs.mkdir(legacyStoreRoot)
  const { coverUrl: _coverUrl, coverBounds: _coverBounds, mergedIntoId: _ignored, sourceGroupId: _sourceGroupId, automaticMatching: _automaticMatching, hidden: _hidden, confirmed: _confirmed, ...legacyIdentity } = { ...registeredIdentity, avatarDataUrl: null }
  await fs.writeFile(path.join(legacyStoreRoot, 'people.json'), JSON.stringify({ schemaVersion: 1, identities: [legacyIdentity] }))
  const legacyPeople = await loadPeopleStore(legacyStoreRoot)
  assert.equal(legacyPeople[0].mergedIntoId, null, '旧人物库应无损迁移为未合并身份')
  assert.equal(legacyPeople[0].confirmed, false, '历史自动编号人物不应继续影响后续任务的人物匹配')

  const sourceRecoveryRoot = path.join(peopleStoreRoot, 'source-recovery')
  await fs.mkdir(sourceRecoveryRoot)
  const legacyRenamedIdentity = createPersonIdentity('已命名人物', faceEmbeddingsForGroup(coPhotoIdentityItems, renamedSourceGroup))
  await savePeopleStore(sourceRecoveryRoot, [legacyRenamedIdentity])
  await loadGlobalPeople(sourceRecoveryRoot)
  await reconcileGlobalPeopleSources(sourceRecoveryRoot, coPhotoIdentityItems, [renamedSourceGroup])
  const recoveredIdentity = (await loadPeopleStore(sourceRecoveryRoot))[0]
  assert.equal(recoveredIdentity.sourceGroupId, renamedSourceGroup.id, '历史改名人物应找回原始分组，避免再次误合并')
  assert.deepEqual(recoveredIdentity.sourceFace, { itemId: renamedSourceGroup.coverItemId, bounds: renamedSourceGroup.coverBounds }, '历史改名人物应迁移为稳定的来源人脸锚点')
  assert.equal(recoveredIdentity.coverUrl, coPhotoIdentityItems[0].path, '历史人物应补全用于展示的人脸缩略图')

  const sessionRecoveryRoot = path.join(peopleStoreRoot, 'session-recovery')
  await fs.mkdir(sessionRecoveryRoot)
  const legacySessionGroup = {
    ...renamedSourceGroup,
    id: 'face_person_legacy_named',
    identityId: 'person_legacy_named',
    name: '保留的名称',
    mergedMembers: [{
      id: 'person_legacy_merged',
      name: '已合并人物',
      avatarDataUrl: null,
      coverUrl: coPhotoIdentityItems[1].path,
      coverBounds: renamedSourceGroup.coverBounds,
    }],
  }
  await savePeopleStore(sessionRecoveryRoot, [createPersonIdentity('人物 1', faceVector(0, 127))])
  await loadGlobalPeople(sessionRecoveryRoot)
  await reconcileGlobalPeopleSources(sessionRecoveryRoot, coPhotoIdentityItems, [legacySessionGroup])
  const sessionRecoveredPeople = await loadPeopleStore(sessionRecoveryRoot)
  const sessionRecoveredIdentity = sessionRecoveredPeople.find((identity) => identity.id === legacySessionGroup.identityId)
  assert.equal(sessionRecoveredIdentity?.name, '保留的名称', '旧任务中已修改的名称应迁移进全局人物库')
  assert.deepEqual(sessionRecoveredIdentity?.sourceFaces, [{ itemId: renamedSourceGroup.coverItemId, bounds: renamedSourceGroup.coverBounds }], '旧任务中的人物来源应全部保存为稳定锚点')
  assert.equal(sessionRecoveredPeople.find((identity) => identity.id === 'person_legacy_merged')?.mergedIntoId, legacySessionGroup.identityId, '旧任务中的合并成员应继续保留在目标人物下')
  assert.equal(buildGlobalFaceGroups(coPhotoIdentityItems, 0.44).find((group) => group.identityId === legacySessionGroup.identityId)?.name, '保留的名称', '阈值变化后旧任务的自定义名称不应回退为默认名称')
} finally {
  await fs.rm(peopleStoreRoot, { recursive: true, force: true })
}

const falseFaceGroup = buildFaceGroups([item('building-false-face', '2026-07-18T03:05:00.000Z', {
  personEvidence: {
    ...faceEvidence('unknown', 0),
    bounds: { x: 0.02, y: 0.91, width: 0.63, height: 0.09 },
    faces: [{ bounds: { x: 0, y: 0.26, width: 0.12, height: 0.35 }, embedding: faceVector(127, 0), embeddingVersion: FACE_EMBEDDING_VERSION }],
  },
})])
assert.equal(falseFaceGroup.length, 0, '不在人物区域内的误检人脸不能进入人物分组')

assert.equal(hasSufficientFacePixels(
  { width: 0.07239413261413574, height: 0.15105456113815308 },
  { scaledWidth: 640, scaledHeight: 360 },
), true, '宽画幅中的清晰人脸不应被固定比例门槛排除')

const smallFaceGroups = buildFaceGroups([
  item('small-face-a', '2026-07-18T03:06:00.000Z', { personEvidence: { ...faceEvidence('open', 12), faces: [{ bounds: { x: 0.2, y: 0.2, width: 0.08, height: 0.08 }, embedding: faceVector(127, 0), embeddingVersion: FACE_EMBEDDING_VERSION }] } }),
  item('small-face-b', '2026-07-18T03:07:00.000Z', { personEvidence: { ...faceEvidence('open', 12), faces: [{ bounds: { x: 0.22, y: 0.2, width: 0.08, height: 0.08 }, embedding: faceVector(125, 8), embeddingVersion: FACE_EMBEDDING_VERSION }] } }),
])
assert.equal(smallFaceGroups.length, 1, '人物区域内的小脸应继续使用原聚类规则')
assert.deepEqual(smallFaceGroups[0].itemIds, ['small-face-a', 'small-face-b'])

const poseVector = (first, second, third) => [first, second, third, ...Array(125).fill(0)]
const poseGroups = buildFaceGroups([
  item('pose-front', '2026-07-18T03:10:00.000Z', { personEvidence: { ...faceEvidence('open', 12), faces: [{ bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.25 }, embedding: poseVector(127, 0, 0), embeddingVersion: FACE_EMBEDDING_VERSION }] } }),
  item('pose-middle', '2026-07-18T03:11:00.000Z', { personEvidence: { ...faceEvidence('open', 12), faces: [{ bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.25 }, embedding: poseVector(78, 100, 0), embeddingVersion: FACE_EMBEDDING_VERSION }] } }),
  item('pose-profile', '2026-07-18T03:12:00.000Z', { personEvidence: { ...faceEvidence('open', 12), faces: [{ bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.25 }, embedding: poseVector(35, 80, 100), embeddingVersion: FACE_EMBEDDING_VERSION }] } }),
])
assert.equal(poseGroups.length, 1, '同一人物的正脸、过渡角度和侧脸应通过组内相似样本归为一组')

const widePoseGroups = buildFaceGroups([
  item('wide-pose-front', '2026-07-18T03:13:00.000Z', { personEvidence: { ...faceEvidence('open', 12), faces: [{ bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.25 }, embedding: poseVector(127, 0, 0), embeddingVersion: FACE_EMBEDDING_VERSION }] } }),
  item('wide-pose-left-1', '2026-07-18T03:14:00.000Z', { personEvidence: { ...faceEvidence('open', 12), faces: [{ bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.25 }, embedding: poseVector(85, 94, 0), embeddingVersion: FACE_EMBEDDING_VERSION }] } }),
  item('wide-pose-left-2', '2026-07-18T03:15:00.000Z', { personEvidence: { ...faceEvidence('open', 12), faces: [{ bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.25 }, embedding: poseVector(85, 94, 0), embeddingVersion: FACE_EMBEDDING_VERSION }] } }),
  item('wide-pose-left-3', '2026-07-18T03:16:00.000Z', { personEvidence: { ...faceEvidence('open', 12), faces: [{ bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.25 }, embedding: poseVector(85, 94, 0), embeddingVersion: FACE_EMBEDDING_VERSION }] } }),
  item('wide-pose-right', '2026-07-18T03:17:00.000Z', { personEvidence: { ...faceEvidence('open', 12), faces: [{ bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.25 }, embedding: poseVector(75, 60, 75), embeddingVersion: FACE_EMBEDDING_VERSION }] } }),
])
assert.equal(widePoseGroups.length, 1, '同一人跨多个角度时不能因分组均值漂移而被拆散')

const coPhotoGroups = buildCoPhotoGroups([
  { id: 'face-a', name: '安安', itemIds: ['photo-ab-1', 'photo-ab-2', 'photo-abc'], coverItemId: 'photo-ab-1', identityId: 'a', coverUrl: null, coverBounds: { x: 0, y: 0, width: 1, height: 1 }, memberFaces: [] },
  { id: 'face-b', name: '贝贝', itemIds: ['photo-ab-1', 'photo-ab-2', 'photo-abc'], coverItemId: 'photo-ab-1', identityId: 'b', coverUrl: null, coverBounds: { x: 0, y: 0, width: 1, height: 1 }, memberFaces: [] },
  { id: 'face-c', name: '晨晨', itemIds: ['photo-c', 'photo-abc'], coverItemId: 'photo-c', identityId: 'c', coverUrl: null, coverBounds: { x: 0, y: 0, width: 1, height: 1 }, memberFaces: [] },
])
assert.equal(coPhotoGroups.length, 2, '不同人物名称集合应形成独立合照分组')
assert.deepEqual(coPhotoGroups[0].itemIds, ['photo-ab-1', 'photo-ab-2'])
assert.equal(coPhotoGroups[0].name, '安安和贝贝的合照')
assert.equal(coPhotoGroups[1].name, '安安、贝贝和晨晨的合照')
assert.deepEqual(coPhotoGroups[1].itemIds, ['photo-abc'], '三人合照不能混入二人合照分组')

const sceneSession = {
  preset: 'balanced',
  purpose: 'general',
  target: { mode: 'preset', value: null },
  items: [item('scene-best', '2026-07-18T04:00:00.000Z', { state: 'recommended' }), item('scene-alt', '2026-07-18T04:00:01.000Z', { state: 'alternative' })],
  scenes: [{ id: 'scene', name: '场景', startAt: '2026-07-18T04:00:00.000Z', endAt: '2026-07-18T04:00:01.000Z', itemIds: ['scene-best', 'scene-alt'], coverItemId: 'scene-best', confirmation: 'pending', recommendedCount: 1, userModified: false }],
  groups: [],
  preferenceProfile: { sampleCount: 0, weights: { quality: 0.4, people: 0.2, composition: 0.1, relevance: 0.2, diversity: 0.1 } },
}
applyAiSelectionUserOperation(sceneSession, { type: 'confirm-scene', sceneId: 'scene' })
assert.deepEqual(sceneSession.items.map((entry) => entry.state), ['kept', 'rejected'])
assert.deepEqual(sceneSession.items.map((entry) => entry.decisionSource), ['user', 'user'])
assert.equal(sceneSession.scenes[0].confirmation, 'confirmed')
applyAiSelectionUserOperation(sceneSession, { type: 'set-state', itemId: 'scene-best', state: 'kept' })
assert.equal(sceneSession.preferenceProfile.sampleCount, 1)
applyAiSelectionUserOperation(sceneSession, { type: 'set-items-state', itemIds: ['scene-best', 'scene-alt'], state: 'kept' })
assert.deepEqual(sceneSession.items.map((entry) => entry.state), ['kept', 'kept'])

console.log('AI selection algorithm tests passed')
