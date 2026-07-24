import type { AiSelectionItem, AiSelectionSession } from '../src/shared/types'
import { buildFaceGroups, faceEmbeddingForGroup } from './aiSelectionFaceGroups'
import { createPersonIdentity, loadPeopleStore, mergeIdentitySamples, savePeopleStore, type AiPersonIdentity } from './aiSelectionPeopleStore'

let identities: AiPersonIdentity[] = []

export async function loadGlobalPeople(storeDir: string): Promise<void> {
  identities = await loadPeopleStore(storeDir)
}

export function buildGlobalFaceGroups(items: AiSelectionItem[]) {
  return buildFaceGroups(items, identities)
}

function nextDefaultName(): string {
  const used = new Set(identities.map((identity) => identity.name))
  for (let index = 1; ; index += 1) {
    const name = `人物 ${index}`
    if (!used.has(name)) return name
  }
}

export async function registerGlobalPeople(storeDir: string, items: AiSelectionItem[]) {
  const groups = buildGlobalFaceGroups(items)
  let changed = false
  for (const group of groups) {
    if (group.identityId) continue
    const sample = faceEmbeddingForGroup(items, group)
    if (!sample) continue
    identities.push(createPersonIdentity(nextDefaultName(), sample))
    changed = true
  }
  if (changed) await savePeopleStore(storeDir, identities)
  return changed ? buildGlobalFaceGroups(items) : groups
}

function ensureIdentity(session: AiSelectionSession, groupId: string): AiPersonIdentity {
  const group = session.faceGroups.find((candidate) => candidate.id === groupId)
  if (!group) throw new Error('人物分组不存在')
  const existing = group.identityId ? identities.find((identity) => identity.id === group.identityId) : null
  if (existing) return existing
  const sample = faceEmbeddingForGroup(session.items, group)
  if (!sample) throw new Error('这个人物缺少可复用的人脸信息，请重新分析后再试')
  const identity = createPersonIdentity(group.name, sample)
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

export async function mergeGlobalPeople(storeDir: string, session: AiSelectionSession, targetGroupId: string, sourceGroupId: string): Promise<void> {
  if (targetGroupId === sourceGroupId) throw new Error('请选择另一个人物分组')
  const target = ensureIdentity(session, targetGroupId)
  const source = ensureIdentity(session, sourceGroupId)
  if (target.id === source.id) return
  mergeIdentitySamples(target, source.samples)
  identities = identities.filter((identity) => identity.id !== source.id)
  await savePeopleStore(storeDir, identities)
}
