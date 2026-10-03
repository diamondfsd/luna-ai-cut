import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseDirectorPlanImport } from '../src/lib/directorPlanImport.ts'
import { appendDirectorLocalShots } from '../src/lib/directorLocalShots.ts'
import { applyDirectorLocalPlanEdit, directorLocalEditHasConflict } from '../src/lib/directorPlanLocalEdit.ts'
import { writeDirectorPlanFiles } from '../electron/features/director-lab/directorLabPlanStorage.ts'
import { buildDirectorPlanUpdate, directorPlanContentSignature } from '../src/lib/directorPlanSync.ts'
import { normalizeDirectorShotFields } from '../src/lib/directorShotFields.ts'
import { DirectorPlanWriteFailures, isPermanentDirectorPlanWriteError } from '../src/lib/directorPlanWriteFailures.ts'
import { lunaKaHttpErrorMessage } from '../electron/network/lunaKaHttpError.ts'

const plan = parseDirectorPlanImport('# 原计划\n主要内容：原目标\n## 01 原镜头\n画面说明：街景', '计划', randomUUID)
plan.revision = 3
plan.shots[0].takes.push({ id: 'take-original', available: true, file_name: 'original.mp4' })
plan.pending_take_ids = ['take-original']
plan.pending_shot_ids = [plan.shots[0].id]
const signature = directorPlanContentSignature(plan)
const backgroundUpdate = { ...plan, revision: 4, updated_at: '2026-10-01T10:00:00Z',
  shots: plan.shots.map((shot) => ({ ...shot, takes: [...shot.takes, { id: 'take-phone', file_name: 'phone.mp4' }] })) }
const requested = { ...plan, title: '编辑后的名称' }
assert.equal(directorLocalEditHasConflict(backgroundUpdate, requested, signature), false)
assert.equal(directorLocalEditHasConflict({ ...backgroundUpdate, title: '手机的新名称' }, requested, signature), true)
assert.equal(directorLocalEditHasConflict(requested, requested, signature), false)
assert.equal(directorLocalEditHasConflict(backgroundUpdate, { ...requested, local_content_signature: signature }), false)

const mainContent = '新的主要内容\n保留换行和末尾空格  '
const edited = applyDirectorLocalPlanEdit(backgroundUpdate, { ...plan, main_content: mainContent }, signature)
assert.equal(edited.main_content, mainContent)
assert.equal(edited.title, plan.title)
assert.deepEqual(edited.shots[0].takes, backgroundUpdate.shots[0].takes)
assert.deepEqual(edited.pending_take_ids, backgroundUpdate.pending_take_ids)
assert.notEqual(directorPlanContentSignature(edited), signature)
assert.equal(buildDirectorPlanUpdate(edited, 4).main_content, mainContent)
assert.throws(() => applyDirectorLocalPlanEdit({ ...backgroundUpdate, main_content: '手机已修改' },
  { ...plan, main_content: mainContent }, signature), /计划已更新/)
assert.equal(applyDirectorLocalPlanEdit(plan, { ...plan, main_content: '' }, signature).main_content, '')
assert.equal(applyDirectorLocalPlanEdit(plan, { ...plan, main_content: undefined }, signature).main_content, plan.main_content)
assert.throws(() => applyDirectorLocalPlanEdit(plan, { ...plan, main_content: 123 }, signature), /计划内容无效/)
const savedDirectory = await mkdtemp(join(tmpdir(), 'director-main-content-'))
try {
  await writeDirectorPlanFiles(savedDirectory, edited)
  const savedManifest = JSON.parse(await readFile(join(savedDirectory, 'manifest.json'), 'utf8'))
  assert.equal(savedManifest.main_content, mainContent)
} finally {
  await rm(savedDirectory, { recursive: true, force: true })
}

const imported = parseDirectorPlanImport('# 不替换原计划\n主要内容：不替换原目标\n## 01 新镜头\n运镜说明：推进', '计划', randomUUID)
const appended = appendDirectorLocalShots(backgroundUpdate, imported.shots)
assert.equal(appended.id, plan.id)
assert.equal(appended.title, plan.title)
assert.equal(appended.main_content, plan.main_content)
assert.deepEqual(appended.shots[0], backgroundUpdate.shots[0])
assert.deepEqual(appended.pending_take_ids, ['take-original'])
assert.deepEqual(appended.pending_shot_ids, [...plan.pending_shot_ids, imported.shots[0].id])
assert.equal(appended.shots[1].order, 2)
assert.equal(appended.shots[1].attributes[0].id, `${appended.shots[1].id}-attribute-movement`)
assert.throws(() => appendDirectorLocalShots(plan, plan.shots), /镜头编号重复/)
assert.throws(() => appendDirectorLocalShots({ ...plan, shots: Array(500).fill(plan.shots[0]) }, imported.shots), /500/)
assert.equal(plan.shots.length, 1)

const legacy = { ...plan.shots[0], attributes: [
  { id: 'legacy-visual', name: '画面说明', description: '老画面' },
  { id: 'legacy-movement', name: '运镜说明', description: '推进' },
  { id: 'unknown', name: '收音', description: '环境声' },
] }
const payload = buildDirectorPlanUpdate({ ...plan, shots: [legacy] }, 4)
assert.equal(payload.expected_revision, 4)
assert.deepEqual(payload.shots[0].attributes, [
  { id: `${legacy.id}-attribute-content`, name: '画面内容', description: '老画面' },
  { id: `${legacy.id}-attribute-movement`, name: '运镜方式', description: '推进' },
])
assert.equal(payload.shots[0].remark, '收音：环境声')
assert.deepEqual(legacy.attributes.map((field) => field.id), ['legacy-visual', 'legacy-movement', 'unknown'])
const canonical = { ...legacy, visual_description: '旧缓存', attributes: [
  ...legacy.attributes, { id: `${legacy.id}-attribute-content`, name: '画面内容', description: '' },
] }
assert.equal(normalizeDirectorShotFields(canonical).attributes.some((field) => field.name === '画面内容'), false)
assert.match(normalizeDirectorShotFields(canonical).remark, /老画面/)
const oversized = { ...legacy, remark: 'a'.repeat(4001) }
assert.doesNotThrow(() => normalizeDirectorShotFields(oversized))
assert.throws(() => buildDirectorPlanUpdate({ ...plan, shots: [oversized] }, 4), /invalid-plan-update/)

const failures = new DirectorPlanWriteFailures()
const badRequest = new Error('计划字段不符合手机接口要求：HTTP 400（invalid-plan-update）')
assert.equal(failures.record(plan.id, plan.title, 'revision4-payload1', badRequest), true)
assert.equal(failures.record(plan.id, plan.title, 'revision4-payload1', badRequest), false)
assert.ok(failures.blocked(plan.id, 'revision4-payload1'))
assert.equal(failures.blocked(plan.id, 'revision5-payload1'), undefined)
assert.equal(failures.blocked(plan.id, 'revision4-payload2'), undefined)
assert.equal(isPermanentDirectorPlanWriteError(new Error('HTTP 409')), false)
assert.equal(isPermanentDirectorPlanWriteError(new Error('网络超时')), false)
failures.clear()
assert.equal(failures.blocked(plan.id, 'revision4-payload1'), undefined)
assert.equal(failures.entries().length, 0)
assert.equal(lunaKaHttpErrorMessage(400, '{"error":"invalid-plan-update"}', '局域网请求失败'), badRequest.message)
assert.equal(lunaKaHttpErrorMessage(400, '{"error":"sensitive user data"}', '局域网请求失败'), '局域网请求失败：HTTP 400')
assert.equal(lunaKaHttpErrorMessage(500, 'not json', '局域网请求失败'), '局域网请求失败：HTTP 500')
console.log('Director local edit, append, legacy fields and failure retry checks passed')
