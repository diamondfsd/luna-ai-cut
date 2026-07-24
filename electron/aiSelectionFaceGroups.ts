import type { AiFaceDescriptor, AiFaceGroup, AiSelectionItem } from '../src/shared/types'
import type { AiPersonIdentity } from './aiSelectionPeopleStore'

export const FACE_EMBEDDING_VERSION = 'sface-2021dec-int8-independent-box-v2'
const FACE_MEMBER_MATCH_THRESHOLD = 0.36
const FACE_CENTROID_SIMILARITY_FLOOR = 0.24
const FACE_EMBEDDING_DIMENSION = 128
const MIN_FACE_FEATURE_PIXELS = 40

interface FaceObservation {
  itemId: string
  bounds: AiFaceDescriptor['bounds']
  embedding: number[]
}

interface WorkingGroup {
  observations: FaceObservation[]
  centroid: number[]
}

export function hasSufficientFacePixels(
  bounds: Pick<AiFaceDescriptor['bounds'], 'width' | 'height'>,
  layout: { scaledWidth: number; scaledHeight: number },
): boolean {
  return bounds.width * layout.scaledWidth >= MIN_FACE_FEATURE_PIXELS
    && bounds.height * layout.scaledHeight >= MIN_FACE_FEATURE_PIXELS
}

export function cosineSimilarity(left: number[], right: number[]): number {
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

function faceBelongsToPerson(item: AiSelectionItem, face: AiFaceDescriptor): boolean {
  const person = item.personEvidence?.bounds
  if (!person) return false
  const margin = 0.04
  const centerX = face.bounds.x + face.bounds.width / 2
  const centerY = face.bounds.y + face.bounds.height / 2
  return centerX >= person.x - margin
    && centerX <= person.x + person.width + margin
    && centerY >= person.y - margin
    && centerY <= person.y + person.height + margin
}

function identityFace(item: AiSelectionItem, face: AiFaceDescriptor): face is AiFaceDescriptor & { embedding: number[] } {
  return Boolean(face.embedding
    && face.embedding.length === FACE_EMBEDDING_DIMENSION
    && face.embedding.every(Number.isFinite)
    && face.embeddingVersion === FACE_EMBEDDING_VERSION
    && faceBelongsToPerson(item, face))
}

function matchingIdentity(embeddings: number[][], identities: AiPersonIdentity[]): AiPersonIdentity | null {
  return identities.map((identity) => ({
    identity,
    similarity: Math.max(-1, ...identity.samples.flatMap((sample) => embeddings.map((embedding) => cosineSimilarity(sample, embedding)))),
  })).filter((entry) => entry.similarity >= FACE_MEMBER_MATCH_THRESHOLD)
    .sort((left, right) => right.similarity - left.similarity)[0]?.identity ?? null
}

export function buildFaceGroups(items: AiSelectionItem[], identities: AiPersonIdentity[] = []): AiFaceGroup[] {
  const itemOrder = new Map(items.map((item, index) => [item.id, index]))
  const observations: FaceObservation[] = items.flatMap((item) => (
    item.personEvidence?.faces?.flatMap((face) => (
      identityFace(item, face)
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

  const generated = groups
    .map((group) => {
      const ordered = [...group.observations].sort((left, right) => (
        (itemOrder.get(left.itemId) ?? 0) - (itemOrder.get(right.itemId) ?? 0)
      ))
      const itemIds = [...new Set(ordered.map((observation) => observation.itemId))]
      const cover = ordered[0]
      return { itemIds, coverItemId: cover.itemId, coverBounds: cover.bounds, embeddings: group.observations.map((observation) => observation.embedding) }
    })
    .sort((left, right) => right.itemIds.length - left.itemIds.length || left.coverItemId.localeCompare(right.coverItemId))
    .map((group, index) => {
      const identity = matchingIdentity(group.embeddings, identities)
      return {
        id: `face_${group.coverItemId}_${Math.round(group.coverBounds.x * 1000)}_${Math.round(group.coverBounds.y * 1000)}`,
        identityId: identity?.id ?? null,
        name: identity?.name ?? `人物 ${index + 1}`,
        itemIds: group.itemIds,
        coverItemId: group.coverItemId,
        coverBounds: group.coverBounds,
      }
    })

  const resolved = new Map<string, AiFaceGroup>()
  for (const group of generated) {
    const key = group.identityId ?? group.id
    const current = resolved.get(key)
    if (!current) {
      resolved.set(key, group.identityId ? { ...group, id: `face_${group.identityId}` } : group)
      continue
    }
    current.itemIds = [...new Set([...current.itemIds, ...group.itemIds])]
  }
  return [...resolved.values()].sort((left, right) => right.itemIds.length - left.itemIds.length || left.name.localeCompare(right.name))
}

export function faceEmbeddingForGroup(items: AiSelectionItem[], group: AiFaceGroup): number[] | null {
  const item = items.find((candidate) => candidate.id === group.coverItemId)
  const face = item?.personEvidence?.faces?.find((candidate) => (
    identityFace(item, candidate)
    && Math.abs(candidate.bounds.x - group.coverBounds.x) < 0.0001
    && Math.abs(candidate.bounds.y - group.coverBounds.y) < 0.0001
  ))
  return face?.embedding ? [...face.embedding] : null
}
