import type { AiHiddenPerson, AiSelectionItem, AiSelectionSession } from '../src/shared/types'
import { buildFaceGroups, faceEmbeddingsForGroup } from './aiSelectionFaceGroups'
import { createPersonIdentity, loadPeopleStore, savePeopleStore, type AiPersonIdentity } from './aiSelectionPeopleStore'

let identities: AiPersonIdentity[] = []

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

export function buildGlobalFaceGroups(items: AiSelectionItem[]) {
  const hiddenRoots = new Set(identities.filter((identity) => rootIdentity(identity).hidden).map((identity) => rootIdentity(identity).id))
  return buildFaceGroups(items, effectiveIdentities()).filter((group) => (
    !group.identityId || !hiddenRoots.has(group.identityId)
  )).map((group) => ({
    ...group,
    mergedMembers: group.identityId
      ? identities.filter((identity) => identity.id !== group.identityId && rootIdentity(identity).id === group.identityId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map((identity) => ({ id: identity.id, name: identity.name, avatarDataUrl: identity.avatarDataUrl }))
      : [],
  }))
}

function ensureIdentity(session: AiSelectionSession, groupId: string): AiPersonIdentity {
  const group = session.faceGroups.find((candidate) => candidate.id === groupId)
  if (!group) throw new Error('人物分组不存在')
  const existing = group.identityId ? identities.find((identity) => identity.id === group.identityId) : null
  if (existing) return existing
  const samples = faceEmbeddingsForGroup(session.items, group)
  if (samples.length === 0) throw new Error('这个人物缺少可复用的人脸信息，请重新分析后再试')
  const identity = createPersonIdentity(group.name, samples)
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

export async function mergeGlobalPeople(storeDir: string, session: AiSelectionSession, targetGroupId: string, sourceGroupId: string): Promise<void> {
  if (targetGroupId === sourceGroupId) throw new Error('请选择另一个人物分组')
  const target = ensureIdentity(session, targetGroupId)
  const source = ensureIdentity(session, sourceGroupId)
  if (target.id === source.id) return
  source.mergedIntoId = target.id
  source.updatedAt = new Date().toISOString()
  target.updatedAt = source.updatedAt
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
  identity.updatedAt = new Date().toISOString()
  await savePeopleStore(storeDir, identities)
}

export function listHiddenGlobalPeople(): AiHiddenPerson[] {
  return identities.filter((identity) => !identity.mergedIntoId && identity.hidden)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((identity) => ({ id: identity.id, name: identity.name, avatarDataUrl: identity.avatarDataUrl }))
}

export async function restoreGlobalPerson(storeDir: string, personId: string): Promise<void> {
  const identity = identities.find((candidate) => candidate.id === personId)
  if (!identity) throw new Error('已隐藏人物不存在')
  const root = rootIdentity(identity)
  if (!root.hidden) return
  root.hidden = false
  root.confirmed = true
  root.updatedAt = new Date().toISOString()
  await savePeopleStore(storeDir, identities)
}
