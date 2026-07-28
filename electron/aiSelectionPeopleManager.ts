import { execFile } from 'node:child_process'

import type { AiSelectionItem, AiSelectionSession } from '../src/shared/types'
import { buildFaceGroups, faceEmbeddingForGroup } from './aiSelectionFaceGroups'
import { getFfmpegPath } from './ffmpeg/pipeline'
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
  return identities.filter((identity) => !identity.mergedIntoId).map((root) => {
    const members = identities.filter((identity) => rootIdentity(identity).id === root.id)
    const samples = new Map(members.flatMap((identity) => identity.samples).map((sample) => [sample.join(','), sample]))
    return { ...root, samples: [...samples.values()] }
  })
}

export function buildGlobalFaceGroups(items: AiSelectionItem[]) {
  return buildFaceGroups(items, effectiveIdentities()).map((group) => ({
    ...group,
    mergedMembers: group.identityId
      ? identities.filter((identity) => identity.id !== group.identityId && rootIdentity(identity).id === group.identityId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map((identity) => ({ id: identity.id, name: identity.name, avatarDataUrl: identity.avatarDataUrl }))
      : [],
  }))
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

export async function setGlobalPersonAvatar(
  storeDir: string,
  session: AiSelectionSession,
  groupId: string,
  itemId: string,
  bounds: { x: number; y: number; width: number; height: number },
): Promise<void> {
  const group = session.faceGroups.find((candidate) => candidate.id === groupId)
  const item = session.items.find((candidate) => candidate.id === itemId)
  if (!group || !item || item.kind !== 'image' || !group.itemIds.includes(itemId)) throw new Error('请选择当前人物的照片')
  const values = [bounds.x, bounds.y, bounds.width, bounds.height]
  if (!values.every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0
    || bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > 1 || bounds.y + bounds.height > 1) {
    throw new Error('头像选区无效，请重新选择')
  }
  const filter = `crop=iw*${bounds.width}:ih*${bounds.height}:iw*${bounds.x}:ih*${bounds.y},scale=256:256:flags=lanczos`
  const avatar = await new Promise<Buffer>((resolve, reject) => {
    execFile(getFfmpegPath(), ['-v', 'error', '-i', item.path, '-frames:v', '1', '-vf', filter, '-c:v', 'mjpeg', '-q:v', '3', '-f', 'image2pipe', 'pipe:1'], {
      encoding: 'buffer',
      maxBuffer: 1024 * 1024,
    }, (error, stdout) => {
      if (error) reject(new Error('头像生成失败，请重新选择'))
      else resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout))
    })
  })
  if (avatar.byteLength === 0 || avatar.byteLength > 512 * 1024) throw new Error('头像生成失败，请重新选择')
  const identity = ensureIdentity(session, groupId)
  identity.avatarDataUrl = `data:image/jpeg;base64,${avatar.toString('base64')}`
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
