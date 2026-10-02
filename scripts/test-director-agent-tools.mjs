import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createLunaMcpServer } from '../electron/mcp/lunaMcpServer.ts'
import { AgentSessionManager } from '../electron/mcp/agentSessionManager.ts'
import { createDirectorPlanAgentService, DirectorPlanAgentError } from '../electron/features/director-lab/directorPlanAgentService.ts'
import { listLocalDirectorPlans } from '../electron/features/director-lab/directorLabPlanReader.ts'
import { writeDirectorPlanFiles } from '../electron/features/director-lab/directorLabPlanStorage.ts'
import { ensureDirectorMediaCopy } from '../electron/features/director-lab/directorLabMediaCopy.ts'

const directory = await mkdtemp(path.join(tmpdir(), 'luna-director-agent-'))
const root = path.join(directory, 'plans')
const manager = new AgentSessionManager()
let service = createDirectorPlanAgentService(async () => root)
let rendererWrites = 0
const server = createLunaMcpServer({
  homeDir: directory, agentSession: manager,
  directorPlanTools: { execute: (...args) => service.execute(...args) },
  requestRenderer: async request => {
    if (request.kind !== 'listTools') rendererWrites += 1
    return { ok: false, error: 'Editor not open' }
  },
})
const markdown = '# 露营\n主要内容：自然记录\n\n## 01 抵达\n画面说明：进入营地\n建议时长：4 秒\n\n## 02 搭建\n画面说明：展开并插杆\n建议时长：8 秒\n'
let endpoint
async function call(name, args = {}) {
  const response = await fetch(`${endpoint.baseUrl}/api/tools/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ arguments: args }),
  })
  assert.equal(response.status, 200)
  return response.json()
}
function sessionArgs() {
  const session = manager.snapshot().session
  return { sessionId: session.sessionId, revision: session.revision }
}
try {
  const copySource = path.join(directory, 'copy-source.mp4')
  const copyTarget = path.join(directory, 'copy-target.mp4')
  await writeFile(copySource, 'original')
  await writeFile(copyTarget, 'different')
  await assert.rejects(ensureDirectorMediaCopy(copySource, copyTarget), /已有其他文件/)
  assert.equal(await readFile(copyTarget, 'utf8'), 'different')
  await writeFile(copyTarget, 'original')
  await ensureDirectorMediaCopy(copySource, copyTarget)
  endpoint = await server.start()
  const catalog = await (await fetch(endpoint.toolsUrl)).json()
  assert.equal(catalog.meta.luna.editorToolsReady, false)
  for (const name of ['get_director_plan_format', 'list_director_plans', 'get_director_plan', 'validate_director_plan_markdown', 'create_director_plan', 'validate_director_plan_changes', 'update_director_plan']) {
    assert.ok(catalog.tools.some(tool => tool.name === name))
  }
  const schema = await (await fetch(endpoint.openapiUrl)).json()
  assert.ok(schema.paths['/api/tools/update_director_plan'])
  assert.equal((await call('get_director_plan_format')).data.formatVersion, 1)
  const draft = await call('validate_director_plan_markdown', { markdown, formatVersion: 1 })
  assert.equal(draft.ok, true)
  assert.equal(draft.data.totalDurationMs, 12000)
  assert.deepEqual(draft.data.warnings, [])
  assert.equal((await call('list_director_plans')).data.total, 0)
  assert.equal((await call('validate_director_plan_markdown', { markdown: `Intro\n${markdown}`, formatVersion: 1 })).error.code, 'INVALID_MARKDOWN')
  assert.ok((await call('validate_director_plan_markdown', { markdown: markdown.replace('4 秒', '0.5 秒'), formatVersion: 1 })).data.warnings.length > 0)

  assert.equal((await call('create_director_plan', { sessionId: 'fake', revision: 1, markdown, formatVersion: 1, idempotencyKey: 'create-1' })).error.code, 'SESSION_REQUIRED')
  manager.startExternalRequest('请创建露营导演计划', 'test-agent', null, 'test', 'test-model')
  const createArgs = { ...sessionArgs(), markdown, formatVersion: 1, idempotencyKey: 'create-1' }
  const created = await call('create_director_plan', createArgs)
  assert.equal(created.ok, true)
  assert.equal(created.data.created, true)
  const planId = created.data.plan.planId
  const shotIds = created.data.plan.shots.map(shot => shot.shotId)
  assert.equal(JSON.stringify(created.data).includes(root), false, 'Do not expose local paths')
  assert.equal((await call('create_director_plan', createArgs)).data.created, false)
  service = createDirectorPlanAgentService(async () => root)
  assert.equal((await call('create_director_plan', createArgs)).data.created, false, 'Deduplication survives service restart')
  assert.equal((await call('create_director_plan', { ...createArgs, markdown: markdown.replace('自然记录', '快速剪辑') })).error.code, 'IDEMPOTENCY_CONFLICT')

  const internal = (await listLocalDirectorPlans(root))[0]
  const source = path.join(internal.local_directory, 'original.mp4')
  await writeFile(source, 'original-camera-bytes')
  internal.shots[0].takes.push({ id: 'take-original', kind: 'video', created_at: internal.created_at,
    duration_ms: 10000, file_name: 'original.mp4', mime_type: 'video/mp4', size_bytes: 21, available: true,
    selected_range: { start_ms: 1000, end_ms: 6000 }, markers: [{ id: 'mark-1', start_ms: 1500, end_ms: 2000, text: '动作' }],
    stream_path: null, stream_url: pathToFileURL(source).toString(), download_path: null, download_url: null,
  })
  internal.pending_take_ids = ['take-original']
  await writeDirectorPlanFiles(internal.local_directory, internal)
  const current = await call('get_director_plan', { planId })
  assert.equal(current.data.plan.shots[0].takes[0].available, true)
  const updateArgs = { ...sessionArgs(), planId, expectedSnapshot: current.data.plan.snapshot, idempotencyKey: 'update-1',
    changes: { title: '新的露营计划', mainContent: '保留现场声音', shots: [{ shotId: shotIds[0], name: '抵达营地', content: '人物携带装备进入' }], shotOrder: [...shotIds].reverse() } }
  const preview = await call('validate_director_plan_changes', { planId, expectedSnapshot: updateArgs.expectedSnapshot, changes: updateArgs.changes })
  assert.equal(preview.data.persisted, false)
  assert.equal((await call('get_director_plan', { planId })).data.plan.title, '露营')
  const updated = await call('update_director_plan', updateArgs)
  assert.equal(updated.ok, true)
  assert.deepEqual(updated.data.plan.shots.map(shot => shot.shotId), [...shotIds].reverse())
  const take = updated.data.plan.shots[1].takes[0]
  assert.equal(take.takeId, 'take-original')
  assert.deepEqual(take.selectedRange, { start_ms: 1000, end_ms: 6000 })
  assert.equal(take.markers[0].text, '动作')
  const saved = (await listLocalDirectorPlans(root))[0]
  assert.deepEqual(saved.pending_take_ids, ['take-original'])
  assert.equal(await readFile(new URL(saved.shots[1].takes[0].stream_url), 'utf8'), 'original-camera-bytes')
  service = createDirectorPlanAgentService(async () => root)
  assert.equal((await call('update_director_plan', updateArgs)).data.changed, false)
  assert.equal((await call('update_director_plan', { ...updateArgs, changes: { title: 'different' } })).error.code, 'IDEMPOTENCY_CONFLICT')
  assert.equal((await call('update_director_plan', { ...updateArgs, idempotencyKey: 'stale' })).error.code, 'PLAN_VERSION_CONFLICT')
  const baseline = updated.data.plan.snapshot
  for (const changes of [{ deleteShotId: shotIds[0] }, { shots: [{ shotId: shotIds[0], takes: [] }] }, { shotOrder: [shotIds[0]] }]) {
    assert.equal((await call('update_director_plan', { ...sessionArgs(), planId, expectedSnapshot: baseline, changes, idempotencyKey: JSON.stringify(changes) })).ok, false)
  }
  const competing = await Promise.all(['A', 'B'].map(title => call('update_director_plan', {
    ...sessionArgs(), planId, expectedSnapshot: baseline, changes: { title }, idempotencyKey: `concurrent-${title}`,
  })))
  assert.equal(competing.filter(result => result.ok).length, 1)
  assert.equal(competing.find(result => !result.ok).error.code, 'PLAN_VERSION_CONFLICT')

  let latest = (await call('get_director_plan', { planId })).data.plan
  const appended = await call('update_director_plan', { ...sessionArgs(), planId, expectedSnapshot: latest.snapshot, idempotencyKey: 'append',
    changes: { appendMarkdown: '# 附加镜头\n## 01 日落\n画面说明：营地日落\n建议时长：5 秒' } })
  assert.equal(appended.ok, true)
  assert.equal(appended.data.plan.shots.length, 3)
  assert.equal(appended.data.plan.shots[2].takes.length, 0)
  assert.ok((await listLocalDirectorPlans(root))[0].pending_shot_ids.includes(appended.data.plan.shots[2].shotId))

  latest = appended.data.plan
  const beforeCancel = await readFile(path.join(saved.local_directory, 'manifest.json'), 'utf8')
  const descriptionBeforeCancel = await readFile(path.join(saved.local_directory, 'README.md'), 'utf8')
  let commitChecks = 0
  await assert.rejects(service.execute('update_director_plan', { ...sessionArgs(), planId, expectedSnapshot: latest.snapshot,
    idempotencyKey: 'cancel-at-commit', changes: { title: '不应提交' } }, () => {
    if (++commitChecks === 4) throw new DirectorPlanAgentError('USER_STOPPED', '用户已停止')
  }), error => error.code === 'USER_STOPPED')
  assert.equal(await readFile(path.join(saved.local_directory, 'manifest.json'), 'utf8'), beforeCancel)
  assert.equal(await readFile(path.join(saved.local_directory, 'README.md'), 'utf8'), descriptionBeforeCancel)

  const revision = sessionArgs()
  manager.updateRequest(revision.sessionId, '改为安静的露营计划')
  assert.equal((await call('update_director_plan', { ...revision, planId, expectedSnapshot: latest.snapshot, idempotencyKey: 'old-revision', changes: { title: '旧任务' } })).error.code, 'REQUEST_UPDATED')
  manager.getRequest(revision.sessionId)
  assert.equal((await call('update_director_plan', { ...sessionArgs(), sessionId: 'fake', planId, expectedSnapshot: latest.snapshot, idempotencyKey: 'wrong-session', changes: { title: '错误任务' } })).error.code, 'SESSION_NOT_FOUND')
  manager.cancelRequest(revision.sessionId)
  assert.equal((await call('update_director_plan', { ...sessionArgs(), planId, expectedSnapshot: latest.snapshot, idempotencyKey: 'stopped', changes: { title: '已取消' } })).error.code, 'USER_STOPPED')
  assert.equal(rendererWrites, 0, 'Plan tools must not delegate writes to the editor renderer')
  manager.startExternalRequest('重新提交露营计划创建请求', 'test-agent', null, 'test', 'test-model')
  assert.equal((await call('create_director_plan', { ...createArgs, ...sessionArgs() })).data.created, false,
    'Creation deduplication is independent of the in-memory session')

  const collisionMarkdown = '# 同名镜头测试\n## 01 相同名称\n建议时长：5 秒\n## 02 相同名称\n建议时长：5 秒'
  const collisionCreated = await call('create_director_plan', { ...sessionArgs(), markdown: collisionMarkdown, formatVersion: 1, idempotencyKey: 'collision-fixture' })
  const collisionId = collisionCreated.data.plan.planId
  const collisionPlan = (await listLocalDirectorPlans(root)).find(plan => plan.id === collisionId)
  for (const [index, shot] of collisionPlan.shots.entries()) {
    const input = path.join(collisionPlan.local_directory, `input-${index}.mp4`)
    await writeFile(input, `different-footage-${index}`)
    shot.takes.push({ ...internal.shots[0].takes[0], id: `collision-take-${index}`, file_name: 'same.mp4', stream_url: pathToFileURL(input).toString() })
  }
  await writeDirectorPlanFiles(collisionPlan.local_directory, collisionPlan)
  const collisionCurrent = (await call('get_director_plan', { planId: collisionId })).data.plan
  const collisionResult = await call('update_director_plan', { ...sessionArgs(), planId: collisionId,
    expectedSnapshot: collisionCurrent.snapshot, idempotencyKey: 'collision-swap',
    changes: { shotOrder: collisionCurrent.shots.map(shot => shot.shotId).reverse() } })
  assert.equal(collisionResult.error.code, 'PLAN_MEDIA_COLLISION')
  const collisionPreserved = (await listLocalDirectorPlans(root)).find(plan => plan.id === collisionId)
  for (const [index, shot] of collisionPreserved.shots.entries()) {
    assert.equal(await readFile(new URL(shot.takes[0].stream_url), 'utf8'), `different-footage-${index}`)
  }

  // Untrusted manifest paths and symlinks must not expose files outside the plan.
  const rawPath = path.join(saved.local_directory, 'manifest.json')
  const raw = JSON.parse(await readFile(rawPath, 'utf8'))
  const external = path.join(directory, 'outside.mp4')
  await writeFile(external, 'outside')
  await mkdir(path.join(saved.local_directory, 'links'), { recursive: true })
  await symlink(external, path.join(saved.local_directory, 'links', 'outside.mp4'))
  const materialShot = raw.shots.find(shot => shot.media.length)
  for (const maliciousPath of [path.relative(saved.local_directory, external), 'links/outside.mp4']) {
    materialShot.media[0].path = maliciousPath
    await writeFile(rawPath, JSON.stringify(raw))
    const checked = (await listLocalDirectorPlans(root)).find(plan => plan.id === planId).shots.find(shot => shot.takes.length).takes[0]
    assert.equal(checked.available, false)
    assert.equal(checked.stream_url, null)
  }
  await writeFile(rawPath, '{corrupt-manifest')
  assert.equal((await call('create_director_plan', { ...createArgs, ...sessionArgs() })).error.code, 'PLAN_OPERATION_FAILED')
  assert.equal(await readFile(rawPath, 'utf8'), '{corrupt-manifest', 'Do not overwrite an unreadable existing plan')
  console.log('Director Agent HTTP, persistence, identity, version, cancellation and path-boundary tests passed')
} finally {
  await server.stop()
  await rm(directory, { recursive: true, force: true })
}
