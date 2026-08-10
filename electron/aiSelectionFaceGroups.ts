import type { AiFaceDescriptor, AiFaceGroup, AiSelectionItem } from '../src/shared/types'
import type { AiPersonIdentity } from './aiSelectionPeopleStore'

export const FACE_EMBEDDING_VERSION = 'sface-2021dec-int8-independent-box-v2'
// Local grouping must be stricter than a one-off face match. A low threshold lets
// several nearby embeddings form a chain and incorrectly collapse distinct people.
export const DEFAULT_FACE_GROUPING_THRESHOLD = 0.42
const MIN_FACE_GROUPING_THRESHOLD = 0.4
const MAX_FACE_GROUPING_THRESHOLD = 0.6
const FACE_GROUP_SUPPORT_GAP = 0.06
const FACE_GROUP_SUPPORT_MIN_MEMBERS = 3
const FACE_IDENTITY_MATCH_THRESHOLD = 0.48
const FACE_IDENTITY_MATCH_RATIO = 0.6
const FACE_EMBEDDING_DIMENSION = 128
const MIN_FACE_FEATURE_PIXELS = 40

interface FaceObservation {
  itemId: string
  bounds: AiFaceDescriptor['bounds']
  embedding: number[]
  frameTime?: number
  frameThumbnailUrl?: string
}

interface WorkingGroup {
  observations: FaceObservation[]
}

interface GroupMatch {
  strongest: number
  secondStrongest: number
}

export function normalizeFaceGroupingThreshold(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_FACE_GROUPING_THRESHOLD
  return Number(Math.max(MIN_FACE_GROUPING_THRESHOLD, Math.min(MAX_FACE_GROUPING_THRESHOLD, value)).toFixed(2))
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

function groupMatch(group: WorkingGroup, observation: FaceObservation): GroupMatch {
  const similarities = group.observations
    .map((entry) => cosineSimilarity(entry.embedding, observation.embedding))
    .sort((left, right) => right - left)
  return {
    strongest: similarities[0] ?? -1,
    secondStrongest: similarities[1] ?? -1,
  }
}

function canJoinGroup(group: WorkingGroup, match: GroupMatch, threshold: number): boolean {
  if (match.strongest < threshold) return false
  return group.observations.length < FACE_GROUP_SUPPORT_MIN_MEMBERS
    || match.secondStrongest >= Math.max(MIN_FACE_GROUPING_THRESHOLD - FACE_GROUP_SUPPORT_GAP, threshold - FACE_GROUP_SUPPORT_GAP)
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

function matchingIdentity(groupId: string, observations: FaceObservation[], embeddings: number[][], identities: AiPersonIdentity[]): AiPersonIdentity | null {
  const anchoredIdentity = identities.find((identity) => [
    ...(identity.sourceFaces ?? []),
    ...(identity.sourceFace ? [identity.sourceFace] : []),
  ].some((sourceFace) => observations.some((observation) => (
    observation.itemId === sourceFace.itemId
    && Math.abs(observation.bounds.x - sourceFace.bounds.x) < 0.0001
    && Math.abs(observation.bounds.y - sourceFace.bounds.y) < 0.0001
  ))))
  if (anchoredIdentity) return anchoredIdentity
  const sourceIdentity = identities.find((identity) => identity.sourceGroupId === groupId)
  if (sourceIdentity) return sourceIdentity
  const automaticIdentities = identities.filter((identity) => identity.automaticMatching)
  if (automaticIdentities.length === 0) return null
  // Cross-task matches are stricter than local grouping so a single weak match cannot relabel a whole group.
  const requiredMatches = Math.max(1, Math.ceil(embeddings.length * FACE_IDENTITY_MATCH_RATIO))
  return automaticIdentities.map((identity) => {
    const similarities = embeddings.map((embedding) => Math.max(
      -1,
      ...identity.samples.map((sample) => cosineSimilarity(sample, embedding)),
    ))
    return {
      identity,
      matches: similarities.filter((similarity) => similarity >= FACE_IDENTITY_MATCH_THRESHOLD).length,
      similarity: Math.max(-1, ...similarities),
    }
  }).filter((entry) => entry.matches >= requiredMatches)
    .sort((left, right) => right.matches - left.matches || right.similarity - left.similarity)[0]?.identity ?? null
}

export function buildFaceGroups(
  items: AiSelectionItem[],
  identities: AiPersonIdentity[] = [],
  faceGroupingThreshold: number = DEFAULT_FACE_GROUPING_THRESHOLD,
): AiFaceGroup[] {
  const groupingThreshold = normalizeFaceGroupingThreshold(faceGroupingThreshold)
  const itemOrder = new Map(items.map((item, index) => [item.id, index]))
  const observations: FaceObservation[] = items.flatMap((item) => (
    item.personEvidence?.faces?.flatMap((face) => (
      identityFace(item, face)
        ? [{ itemId: item.id, bounds: face.bounds, embedding: face.embedding, frameTime: face.frameTime, frameThumbnailUrl: face.frameThumbnailUrl }]
        : []
    )) ?? []
  ))
  const groups: WorkingGroup[] = []

  for (const observation of observations) {
    const candidate = groups
      .filter((group) => !group.observations.some((entry) => (
        entry.itemId === observation.itemId
        && (entry.frameTime === undefined || observation.frameTime === undefined || entry.frameTime === observation.frameTime)
      )))
      .map((group) => ({ group, match: groupMatch(group, observation) }))
      .filter((entry) => canJoinGroup(entry.group, entry.match, groupingThreshold))
      .sort((left, right) => (
        right.match.strongest - left.match.strongest
        || right.match.secondStrongest - left.match.secondStrongest
      ))[0]?.group
    if (candidate) {
      candidate.observations.push(observation)
    } else {
      groups.push({ observations: [observation] })
    }
  }

  const generated = groups
    .map((group) => {
      const ordered = [...group.observations].sort((left, right) => (
        (itemOrder.get(left.itemId) ?? 0) - (itemOrder.get(right.itemId) ?? 0)
      ))
      const itemIds = [...new Set(ordered.map((observation) => observation.itemId))]
      const cover = ordered[0]
      return {
        itemIds,
        coverItemId: cover.itemId,
        coverBounds: cover.bounds,
        memberFaces: ordered.map((observation) => ({
          itemId: observation.itemId,
          bounds: observation.bounds,
          frameTime: observation.frameTime,
          frameThumbnailUrl: observation.frameThumbnailUrl,
        })),
        observations: group.observations,
        embeddings: group.observations.map((observation) => observation.embedding),
      }
    })
    .sort((left, right) => right.itemIds.length - left.itemIds.length || left.coverItemId.localeCompare(right.coverItemId))
    .map((group, index) => {
      const groupId = `face_${group.coverItemId}_${Math.round(group.coverBounds.x * 1000)}_${Math.round(group.coverBounds.y * 1000)}`
      const identity = matchingIdentity(groupId, group.observations, group.embeddings, identities)
      const coverItem = items.find((item) => item.id === group.coverItemId)
      return {
        id: groupId,
        identityId: identity?.id ?? null,
        name: identity?.name ?? `人物 ${index + 1}`,
        itemIds: group.itemIds,
        coverItemId: group.coverItemId,
        coverUrl: identity?.avatarDataUrl
          ?? group.memberFaces.find((face) => face.itemId === group.coverItemId)?.frameThumbnailUrl
          ?? coverItem?.thumbnailUrl ?? coverItem?.path ?? null,
        coverBounds: identity?.avatarDataUrl
          ? { x: 0, y: 0, width: 1, height: 1 }
          : group.coverBounds,
        memberFaces: group.memberFaces,
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
    current.memberFaces = [...current.memberFaces, ...group.memberFaces]
  }
  return [...resolved.values()].sort((left, right) => right.itemIds.length - left.itemIds.length || left.name.localeCompare(right.name))
}

export function faceEmbeddingsForGroup(items: AiSelectionItem[], group: AiFaceGroup): number[][] {
  const itemsById = new Map(items.map((item) => [item.id, item]))
  const samples = new Map<string, number[]>()
  for (const member of group.memberFaces) {
    const item = itemsById.get(member.itemId)
    if (!item) continue
    for (const face of item.personEvidence?.faces ?? []) {
      if (!identityFace(item, face)
        || Math.abs(face.bounds.x - member.bounds.x) >= 0.0001
        || Math.abs(face.bounds.y - member.bounds.y) >= 0.0001) continue
      samples.set(face.embedding.join(','), [...face.embedding])
    }
  }
  return [...samples.values()].slice(0, 24)
}
