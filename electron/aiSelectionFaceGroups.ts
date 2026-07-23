import type { AiFaceDescriptor, AiFaceGroup, AiSelectionItem } from '../src/shared/types'

export const FACE_EMBEDDING_VERSION = 'sface-2021dec-int8-box-crop-v1'
const FACE_MATCH_THRESHOLD = 0.42
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
      .map((group) => ({ group, similarity: cosineSimilarity(group.centroid, observation.embedding) }))
      .filter((entry) => entry.similarity >= FACE_MATCH_THRESHOLD)
      .sort((left, right) => right.similarity - left.similarity)[0]?.group
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
