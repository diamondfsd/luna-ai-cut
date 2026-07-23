import type { AiFaceDescriptor, AiFaceGroup, AiSelectionItem } from '../src/shared/types'

export const FACE_EMBEDDING_VERSION = 'sface-2021dec-int8-independent-box-v2'
const FACE_MEMBER_MATCH_THRESHOLD = 0.36
const FACE_CENTROID_SIMILARITY_FLOOR = 0.24
const FACE_EMBEDDING_DIMENSION = 128

interface FaceObservation {
  itemId: string
  bounds: AiFaceDescriptor['bounds']
  embedding: number[]
}

interface WorkingGroup {
  observations: FaceObservation[]
  centroid: number[]
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return -1
  let dot = 0
  let leftLength = 0
  let rightLength = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]
    leftLength += left[index] ** 2
    rightLength += right[index] ** 2
  }
  const denominator = Math.sqrt(leftLength * rightLength)
  return denominator > 0 ? dot / denominator : -1
}

function updateCentroid(group: WorkingGroup): void {
  const dimension = group.observations[0]?.embedding.length ?? 0
  group.centroid = Array.from({ length: dimension }, (_, index) => (
    group.observations.reduce((sum, observation) => sum + observation.embedding[index], 0)
    / group.observations.length
  ))
}

function groupSimilarity(group: WorkingGroup, observation: FaceObservation): { member: number; centroid: number } {
  return {
    member: Math.max(...group.observations.map((entry) => cosineSimilarity(entry.embedding, observation.embedding))),
    centroid: cosineSimilarity(group.centroid, observation.embedding),
  }
}

export function buildFaceGroups(items: AiSelectionItem[]): AiFaceGroup[] {
  const itemOrder = new Map(items.map((item, index) => [item.id, index]))
  const observations: FaceObservation[] = items.flatMap((item) => (
    item.personEvidence?.faces?.flatMap((face) => (
      face.embedding
        && face.embedding.length === FACE_EMBEDDING_DIMENSION
        && face.embedding.every(Number.isFinite)
        && face.embeddingVersion === FACE_EMBEDDING_VERSION
        ? [{ itemId: item.id, bounds: face.bounds, embedding: face.embedding }]
        : []
    )) ?? []
  ))
  const groups: WorkingGroup[] = []

  for (const observation of observations) {
    const candidate = groups
      .filter((group) => !group.observations.some((entry) => entry.itemId === observation.itemId))
      .map((group) => ({ group, ...groupSimilarity(group, observation) }))
      .filter((entry) => (
        entry.member >= FACE_MEMBER_MATCH_THRESHOLD
        && entry.centroid >= FACE_CENTROID_SIMILARITY_FLOOR
      ))
      .sort((left, right) => (
        right.member - left.member || right.centroid - left.centroid
      ))[0]?.group
    if (candidate) {
      candidate.observations.push(observation)
      updateCentroid(candidate)
    } else {
      groups.push({ observations: [observation], centroid: [...observation.embedding] })
    }
  }

  return groups
    .map((group) => {
      const ordered = [...group.observations].sort((left, right) => (
        (itemOrder.get(left.itemId) ?? 0) - (itemOrder.get(right.itemId) ?? 0)
      ))
      const itemIds = [...new Set(ordered.map((observation) => observation.itemId))]
      const cover = ordered[0]
      return { itemIds, coverItemId: cover.itemId, coverBounds: cover.bounds }
    })
    .sort((left, right) => right.itemIds.length - left.itemIds.length || left.coverItemId.localeCompare(right.coverItemId))
    .map((group, index) => ({
      id: `face_${group.coverItemId}_${Math.round(group.coverBounds.x * 1000)}_${Math.round(group.coverBounds.y * 1000)}`,
      name: `人物 ${index + 1}`,
      ...group,
    }))
}
