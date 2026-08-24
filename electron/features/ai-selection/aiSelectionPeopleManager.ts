import type { AiFaceGroup, AiHiddenPerson, AiSelectionItem, AiSelectionSession } from '../../../src/shared/types'
import { FACE_AVATAR_CONTEXT_SCALE, squareCropAroundCenter } from '../../../src/shared/aiAvatarCrop'
import { buildFaceGroups, DEFAULT_FACE_GROUPING_THRESHOLD, faceEmbeddingsForGroup } from './aiSelectionFaceGroups'
import { createPersonIdentity, loadPeopleStore, savePeopleStore, type AiPersonIdentity, type AiPersonSourceFace } from './aiSelectionPeopleStore'

let identities: AiPersonIdentity[] = []

function displayCoverBounds(items: AiSelectionItem[], group: AiFaceGroup): AiPersonIdentity['coverBounds'] {
  const item = items.find((candidate) => candidate.id === group.coverItemId)
  if (!item?.width || !item.height || group.coverUrl?.startsWith('data:image/')) return { ...group.coverBounds }
  return squareCropAroundCenter(group.coverBounds, item.width, item.height, FACE_AVATAR_CONTEXT_SCALE)
}

function sameBounds(left: AiPersonIdentity['coverBounds'], right: AiPersonIdentity['coverBounds']): boolean {
  return Boolean(left && right
    && left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height)
}

function updateIdentityCover(identity: AiPersonIdentity, group: AiFaceGroup, items: AiSelectionItem[], replaceBounds = false): boolean {
  let changed = false
  if (!identity.coverUrl && group.coverUrl) {
    identity.coverUrl = group.coverUrl
    changed = true
  }
  const coverBounds = displayCoverBounds(items, group)
  if ((replaceBounds || !identity.coverBounds) && !sameBounds(identity.coverBounds, coverBounds)) {
    identity.coverBounds = coverBounds
    changed = true
  }
  return changed
}

export async function loadGlobalPeople(storeDir: string): Promise<void> {
  identities = await loadPeopleStore(storeDir)
}

function rootIdentity(identity: AiPersonIdentity): AiPersonIdentity {
  const seen = new Set([identity.id])
  let current = identity
  while (current.mergedIntoId) {
    if (seen.has(current.mergedIntoId)) break
    const next = identities.find((candidate) => candidate.id === current.mergedIntoId)
    if (!next) break
    seen.add(next.id)
    current = next
  }
  return current
}

function effectiveIdentities(): AiPersonIdentity[] {
  return identities.filter((identity) => !identity.mergedIntoId && (identity.confirmed || identity.hidden)).map((root) => {
    const members = identities.filter((identity) => rootIdentity(identity).id === root.id)
    const samples = new Map(members.flatMap((identity) => identity.samples).map((sample) => [sample.join(','), sample]))
    return { ...root, samples: [...samples.values()] }
  })
}

export function buildGlobalFaceGroups(items: AiSelectionItem[], faceGroupingThreshold = DEFAULT_FACE_GROUPING_THRESHOLD) {
  const hiddenRoots = new Set(identities.filter((identity) => rootIdentity(identity).hidden).map((identity) => rootIdentity(identity).id))
  return buildFaceGroups(items, effectiveIdentities(), faceGroupingThreshold).filter((group) => (
    !group.identityId || !hiddenRoots.has(group.identityId)
  )).map((group) => ({
    ...group,
    mergedMembers: group.identityId
      ? identities.filter((identity) => identity.id !== group.identityId && rootIdentity(identity).id === group.identityId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map((identity) => ({
          id: identity.id,
          name: identity.name,
          avatarDataUrl: identity.avatarDataUrl,
          coverUrl: identity.coverUrl,
          coverBounds: identity.coverBounds,
        }))
      : [],
  }))
}

function sourceFaceForGroup(group: AiFaceGroup): AiPersonSourceFace | null {
  const member = group.memberFaces.find((face) => face.itemId === group.coverItemId)
  return member ? { itemId: member.itemId, bounds: { ...member.bounds } } : null
}

function sourceFaceMatchesGroup(sourceFace: AiPersonSourceFace, group: AiFaceGroup): boolean {
  return group.memberFaces.some((face) => (
    face.itemId === sourceFace.itemId
    && Math.abs(face.bounds.x - sourceFace.bounds.x) < 0.0001
    && Math.abs(face.bounds.y - sourceFace.bounds.y) < 0.0001
  ))
}

function identitySourceFaces(identity: AiPersonIdentity): AiPersonSourceFace[] {
  const sourceFaces = [...(identity.sourceFaces ?? [])]
  if (identity.sourceFace && !sourceFaces.some((sourceFace) => sourceFace.itemId === identity.sourceFace!.itemId
    && Math.abs(sourceFace.bounds.x - identity.sourceFace!.bounds.x) < 0.0001
    && Math.abs(sourceFace.bounds.y - identity.sourceFace!.bounds.y) < 0.0001)) {
    sourceFaces.unshift(identity.sourceFace)
  }
  return sourceFaces
}

function addIdentitySourceFace(identity: AiPersonIdentity, sourceFace: AiPersonSourceFace | null): boolean {
  if (!sourceFace) return false
  if (identitySourceFaces(identity).some((candidate) => candidate.itemId === sourceFace.itemId
    && Math.abs(candidate.bounds.x - sourceFace.bounds.x) < 0.0001
    && Math.abs(candidate.bounds.y - sourceFace.bounds.y) < 0.0001)) return false
  identity.sourceFace ??= { itemId: sourceFace.itemId, bounds: { ...sourceFace.bounds } }
  identity.sourceFaces.push({ itemId: sourceFace.itemId, bounds: { ...sourceFace.bounds } })
  return true
}

function isManagedLegacyGroup(group: AiFaceGroup): boolean {
  return Boolean(group.identityId && (!/^人物 \d+$/.test(group.name) || group.mergedMembers?.length))
}

function recoverStoredGroupIdentity(items: AiSelectionItem[], group: AiFaceGroup): boolean {
  if (!group.identityId) return false
  const existing = identities.find((identity) => identity.id === group.identityId)
  if (existing) return addIdentitySourceFace(existing, sourceFaceForGroup(group))
  if (!isManagedLegacyGroup(group)) return false
  const samples = faceEmbeddingsForGroup(items, group)
  if (samples.length === 0) return false
  const identity = createPersonIdentity(group.name, samples, group.id, {
    coverUrl: group.coverUrl,
    coverBounds: displayCoverBounds(items, group),
  }, sourceFaceForGroup(group))
  identity.id = group.identityId
  identity.automaticMatching = Boolean(group.mergedMembers?.length)
  identities.push(identity)
  for (const member of group.mergedMembers ?? []) {
    if (member.id === identity.id || identities.some((candidate) => candidate.id === member.id)) continue
    const mergedMember = createPersonIdentity(member.name, [], null, {
      coverUrl: member.coverUrl,
      coverBounds: member.coverBounds,
    })
    mergedMember.id = member.id
    mergedMember.avatarDataUrl = member.avatarDataUrl
    mergedMember.mergedIntoId = identity.id
    mergedMember.automaticMatching = true
    identities.push(mergedMember)
  }
  return true
}

function ensureIdentity(session: AiSelectionSession, groupId: string): AiPersonIdentity {
  const group = session.faceGroups.find((candidate) => candidate.id === groupId)
  if (!group) throw new Error('人物分组不存在')
  const existing = group.identityId ? identities.find((identity) => identity.id === group.identityId) : null
  if (existing) {
    addIdentitySourceFace(existing, sourceFaceForGroup(group))
    updateIdentityCover(existing, group, session.items)
    return existing
  }
  const samples = faceEmbeddingsForGroup(session.items, group)
  if (samples.length === 0) throw new Error('这个人物缺少可复用的人脸信息，请重新分析后再试')
  const identity = createPersonIdentity(group.name, samples, group.id, {
    coverUrl: group.coverUrl,
    coverBounds: displayCoverBounds(session.items, group),
  }, sourceFaceForGroup(group))
  identities.push(identity)
  return identity
}

export async function renameGlobalPerson(storeDir: string, session: AiSelectionSession, groupId: string, name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('请输入人物名称')
  if (trimmed.length > 40) throw new Error('人物名称不能超过 40 个字符')
  const identity = ensureIdentity(session, groupId)
  identity.name = trimmed
  identity.updatedAt = new Date().toISOString()
  await savePeopleStore(storeDir, identities)
}

export async function setGlobalPersonAvatar(
  storeDir: string,
  session: AiSelectionSession,
  groupId: string,
  avatarDataUrl: string,
): Promise<void> {
  if (!avatarDataUrl.startsWith('data:image/jpeg;base64,')) throw new Error('头像生成失败，请重新选择')
  const identity = ensureIdentity(session, groupId)
  identity.avatarDataUrl = avatarDataUrl
  identity.updatedAt = new Date().toISOString()
  await savePeopleStore(storeDir, identities)
}

export async function mergeGlobalPeople(storeDir: string, session: AiSelectionSession, targetGroupId: string, sourceGroupIds: string[]): Promise<void> {
  const selectedIds = [...new Set(sourceGroupIds)].filter((groupId) => groupId !== targetGroupId)
  if (selectedIds.length === 0) throw new Error('请选择另一个人物分组')
  const target = ensureIdentity(session, targetGroupId)
  const sources = selectedIds.map((groupId) => ensureIdentity(session, groupId)).filter((source) => source.id !== target.id)
  if (sources.length === 0) return
  // An explicit merge is the only action that enables broad recognition matching.
  target.automaticMatching = true
  const now = new Date().toISOString()
  for (const source of sources) {
    source.mergedIntoId = target.id
    source.automaticMatching = true
    source.updatedAt = now
  }
  target.updatedAt = now
  await savePeopleStore(storeDir, identities)
}

export async function unmergeGlobalPerson(storeDir: string, session: AiSelectionSession, targetGroupId: string, memberIdentityId: string): Promise<void> {
  const target = ensureIdentity(session, targetGroupId)
  const member = identities.find((identity) => identity.id === memberIdentityId)
  if (!member || member.id === target.id || rootIdentity(member).id !== target.id) throw new Error('这个人物不在当前合并组中')
  member.mergedIntoId = null
  member.updatedAt = new Date().toISOString()
  await savePeopleStore(storeDir, identities)
}

export async function hideGlobalPerson(storeDir: string, session: AiSelectionSession, groupId: string): Promise<void> {
  const identity = rootIdentity(ensureIdentity(session, groupId))
  identity.hidden = true
  identity.confirmed = true
  identity.automaticMatching = true
  identity.updatedAt = new Date().toISOString()
  await savePeopleStore(storeDir, identities)
}

export function listHiddenGlobalPeople(): AiHiddenPerson[] {
  return identities.filter((identity) => !identity.mergedIntoId && identity.hidden)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((identity) => ({
      id: identity.id,
      name: identity.name,
      avatarDataUrl: identity.avatarDataUrl,
      coverUrl: identity.coverUrl,
      coverBounds: identity.coverBounds,
    }))
}

export async function restoreGlobalPerson(storeDir: string, personId: string): Promise<void> {
  const identity = identities.find((candidate) => candidate.id === personId)
  if (!identity) throw new Error('已隐藏人物不存在')
  const root = rootIdentity(identity)
  if (!root.hidden) return
  root.hidden = false
  root.confirmed = true
  root.automaticMatching = true
  root.updatedAt = new Date().toISOString()
  await savePeopleStore(storeDir, identities)
}

function matchingLocalGroup(items: AiSelectionItem[], identity: AiPersonIdentity, faceGroupingThreshold: number): AiFaceGroup | null {
  if (identity.samples.length === 0) return null
  const groups = buildFaceGroups(items, [], faceGroupingThreshold)
  const anchoredGroup = groups.find((group) => identitySourceFaces(identity).some((sourceFace) => sourceFaceMatchesGroup(sourceFace, group)))
  if (anchoredGroup) return anchoredGroup
  const identitySamples = new Set(identity.samples.map((sample) => sample.join(',')))
  const candidates = groups.map((group) => {
    const groupSamples = new Set(faceEmbeddingsForGroup(items, group).map((sample) => sample.join(',')))
    const overlap = [...identitySamples].filter((sample) => groupSamples.has(sample)).length
    return { group, overlap }
  }).sort((left, right) => right.overlap - left.overlap)
  const best = candidates[0]
  const next = candidates[1]
  return best && best.overlap === identitySamples.size && best.overlap > (next?.overlap ?? 0)
    ? best.group
    : null
}

export async function reconcileGlobalPeopleSources(
  storeDir: string,
  items: AiSelectionItem[],
  previousGroups: AiFaceGroup[] = [],
  faceGroupingThreshold = DEFAULT_FACE_GROUPING_THRESHOLD,
): Promise<void> {
  let changed = false
  for (const group of previousGroups) {
    if (recoverStoredGroupIdentity(items, group)) changed = true
  }
  for (const identity of identities) {
    if (identitySourceFaces(identity).length === 0) {
      const previous = previousGroups.find((group) => group.id === identity.sourceGroupId)
      if (addIdentitySourceFace(identity, previous ? sourceFaceForGroup(previous) : null)) changed = true
    }
    const group = matchingLocalGroup(items, identity, faceGroupingThreshold)
    if (!group) continue
    if (addIdentitySourceFace(identity, sourceFaceForGroup(group))) changed = true
    const sourceNeedsBinding = identity.sourceGroupId !== group.id && identity.confirmed && !identity.automaticMatching
    const coverChanged = updateIdentityCover(identity, group, items, true)
    if (!sourceNeedsBinding && !coverChanged) continue
    if (sourceNeedsBinding) identity.sourceGroupId = group.id
    identity.updatedAt = new Date().toISOString()
    changed = true
  }
  if (changed) await savePeopleStore(storeDir, identities)
}
