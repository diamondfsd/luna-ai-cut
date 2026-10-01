import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseDirectorPlanImport } from '../src/lib/directorPlanImport.ts'
import { directorPlanContentSignature, overlayDirectorLocalPlan } from '../src/lib/directorPlanSync.ts'
import { reconcileLocalDirectorPlan, writeDirectorPlanFiles } from '../electron/features/director-lab/directorLabPlanStorage.ts'

const plan = parseDirectorPlanImport('\uFEFF# 城市\r\n主要内容：街道漫游\r\n安静自然\r\n## 01 开场\r\n**画面说明**：街景\r\n建立环境\r\n建议时长：2.5 秒\r\n运镜说明：推进\r\n备注：注意收音\r\n## 02 收尾\r\nduration_ms: 800\r\n景别：远景', '文件名', randomUUID)
assert.equal(plan.title, '城市')
assert.equal(plan.main_content, '街道漫游\n安静自然')
assert.equal(plan.pending_create, true)
assert.equal(plan.shots.length, 2)
assert.equal(plan.shots[0].name, '开场')
assert.equal(plan.shots[0].duration_ms, 2500)
assert.equal(plan.shots[1].duration_ms, 1000)
assert.equal(plan.shots[0].attributes[0].name, '画面内容')
assert.equal(plan.shots[0].attributes[0].description, '街景\n建立环境')
assert.equal(plan.shots[0].attributes[0].id, `${plan.shots[0].id}-attribute-content`)
assert.equal(plan.shots[0].remark, '备注：注意收音')
assert.equal(parseDirectorPlanImport('标题：小片\n1. 开始\n- 画面说明：人物\n2. 结束', '文件', randomUUID).shots.length, 2)
assert.equal(parseDirectorPlanImport('开场\n收尾', '文件', randomUUID).shots.length, 2)
assert.throws(() => parseDirectorPlanImport('# 只有标题', '文件', randomUUID), /没有可导入/)
assert.throws(() => parseDirectorPlanImport(Array.from({ length: 501 }, (_, index) => `## 镜头 ${index}`).join('\n'), '文件', randomUUID), /超过限制/)

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'director-import-'))
try {
  const remote = { ...plan, pending_create: false, source: 'remote', revision: 3, shots: [plan.shots[0]] }
  const pending = { ...plan, pending_create: false, synced_revision: 3,
    synced_signature: directorPlanContentSignature(remote), pending_shot_ids: [plan.shots[1].id] }
  const target = path.join(directory, plan.title)
  await writeDirectorPlanFiles(target, pending)
  assert.equal(await reconcileLocalDirectorPlan(directory, remote), false)
  let manifest = JSON.parse(await fs.readFile(path.join(target, 'manifest.json'), 'utf8'))
  assert.equal(manifest.shots.length, 2)
  assert.equal(manifest.synced_signature, directorPlanContentSignature(remote))
  assert.deepEqual(manifest.pending_shot_ids, [plan.shots[1].id])
  assert.equal(overlayDirectorLocalPlan(remote, pending).shots.length, 2)

  const mediaPath = path.join(target, 'media', '01_开场', '01_clip.mov')
  await fs.mkdir(path.dirname(mediaPath), { recursive: true })
  await fs.writeFile(mediaPath, 'original-pc-recording')
  const take = { id: 'take-pc', kind: 'video', file_name: 'clip.mov', available: true,
    created_at: plan.created_at, stream_url: pathToFileURL(mediaPath).toString(), selected_range: null }
  const withMedia = { ...pending, pending_take_ids: ['take-pc'], shots: pending.shots.map((shot, index) => index === 0
    ? { ...shot, takes: [take] } : shot) }
  await writeDirectorPlanFiles(target, withMedia)
  assert.equal(await reconcileLocalDirectorPlan(directory, { ...remote, shots: pending.shots, revision: 4 }), false)
  assert.equal(overlayDirectorLocalPlan(remote, withMedia).shots[0].takes[0].stream_url, take.stream_url)
  const renamed = { ...withMedia, shots: withMedia.shots.map((shot, index) => index === 0 ? { ...shot, name: '改名镜头' } : shot) }
  await writeDirectorPlanFiles(target, renamed)
  manifest = JSON.parse(await fs.readFile(path.join(target, 'manifest.json'), 'utf8'))
  assert.deepEqual(manifest.pending_take_ids, ['take-pc'])
  assert.equal(manifest.shots[0].media[0].file_name, 'clip.mov')
  assert.equal(await fs.readFile(path.join(target, manifest.shots[0].media[0].path), 'utf8'), 'original-pc-recording')
} finally {
  await fs.rm(directory, { recursive: true, force: true })
}
console.log('director plan import/outbox tests passed')
