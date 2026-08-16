import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createUserMemoryStore } from '../electron/userMemoryService.ts'

const root = await mkdtemp(path.join(os.tmpdir(), 'luna-user-memory-'))
try {
  const store = createUserMemoryStore(root)
  const created = await store.update({
    scope: 'global',
    topic: '画幅',
    preference: '默认优先使用竖屏 9:16。',
    evidence: '用户确认这是跨项目默认偏好。',
  })
  const globalEntry = created.data.entry
  assert.equal(globalEntry.scope, 'global')
  assert.equal(globalEntry.videoType, undefined)

  await store.update({
    scope: 'video-type',
    videoType: '家庭记录',
    topic: '声音',
    preference: '尽量保留原声。',
  })
  await Promise.all([
    store.update({ scope: 'global', topic: '字幕', preference: '字幕使用简洁样式。' }),
    store.update({ scope: 'global', topic: '音乐', preference: '不要自动添加背景音乐。' }),
  ])
  const serializedRead = await store.read()
  assert.equal(serializedRead.data.total, 4)

  const searched = await store.search({ query: '9:16' })
  assert.equal(searched.data.entries.length, 1)
  assert.equal(searched.data.entries[0].id, globalEntry.id)

  await store.update({
    memoryId: globalEntry.id,
    scope: 'global',
    topic: '画幅',
    preference: '默认优先使用 1:1。',
  })
  const reloaded = createUserMemoryStore(root)
  const read = await reloaded.read({ memoryIds: [globalEntry.id] })
  assert.equal(read.data.entries[0].preference, '默认优先使用 1:1。')

  await reloaded.remove({ memoryIds: [globalEntry.id] })
  const afterRemove = await reloaded.read({ memoryIds: [globalEntry.id] })
  assert.equal(afterRemove.data.entries.length, 0)
  await assert.rejects(
    () => reloaded.update({ scope: 'video-type', topic: '声音', preference: '保留原声。' }),
    /videoType/,
  )
  assert.equal(path.basename(reloaded.filePath), 'preferences.json')
  console.log('Luna user memory persistence passed.')
} finally {
  await rm(root, { recursive: true, force: true })
}
