import assert from 'node:assert/strict'

import { AgentSessionError, AgentSessionManager } from '../electron/mcp/agentSessionManager.ts'

const manager = new AgentSessionManager()
const events = []
manager.subscribe((event) => events.push(event))

const created = manager.createRequest('剪一个 1 分钟旅行短片', 'project-1')
assert.equal(created.status, 'queued')
assert.equal(created.revision, 1)

const claimed = await manager.waitForRequest('worker-1', 5)
assert.equal(claimed.state, 'claimed')
assert.equal(claimed.session?.agentId, 'worker-1')
assert.equal(manager.gateActiveTool()?.allowed, true)

const updated = manager.updateRequest(created.sessionId, '改成口播精剪，保留完整字幕')
assert.equal(updated.revision, 2)
assert.equal(manager.gateActiveTool()?.error?.code, 'REQUEST_UPDATED')

const latest = manager.getRequest(created.sessionId, 1)
assert.equal(latest.changed, true)
assert.equal(latest.session.revision, 2)
assert.equal(manager.gateActiveTool()?.allowed, true)

const progress = manager.reportProgress(created.sessionId, 2, 'captioning', 60, '正在处理中文字幕')
assert.equal(progress.ok, true)

const cancelled = manager.cancelRequest(created.sessionId)
assert.equal(cancelled.status, 'cancelled')
assert.equal(cancelled.cancelRequested, true)
assert.equal(manager.gateActiveTool()?.error?.code, 'USER_STOPPED')
assert.equal(manager.gateActiveTool()?.error?.retryable, false)

const result = manager.reportResult(created.sessionId, 2, 'cancelled', '用户已停止')
assert.equal(result.ok, false)
assert.equal(result.error?.code, 'USER_STOPPED')
assert.equal(manager.snapshot().session?.status, 'cancelled')

assert.deepEqual(events.map((event) => event.type), [
  'session-created',
  'session-claimed',
  'request-updated',
  'progress',
  'cancelled',
])

const externalManager = new AgentSessionManager()
const external = externalManager.startExternalRequest('我8月29号出去玩了，帮我剪个30秒短片', 'external-editor')
assert.equal(external.state, 'claimed')
assert.equal(external.session?.agentId, 'external-editor')
assert.equal(externalManager.gateActiveTool()?.allowed, true)

const retry = externalManager.startExternalRequest('我8月29号出去玩了，帮我剪个30秒短片', 'external-editor')
assert.equal(retry.session?.sessionId, external.session?.sessionId)

externalManager.toolStarted('contact-sheet-1', 'create_media_contact_sheet', {})
externalManager.toolFinished(
  'contact-sheet-1',
  'create_media_contact_sheet',
  {},
  false,
  '联络表渲染失败',
  10,
  { code: 'CONTACT_SHEET_RENDER_FAILED', message: '联络表渲染失败' },
)
assert.equal(externalManager.snapshot().session?.message, '联络表渲染失败')
externalManager.toolStarted('list-media-1', 'list_local_media', {})
assert.equal(externalManager.snapshot().session?.message, '正在处理任务')

assert.throws(
  () => externalManager.startExternalRequest('另一个任务', 'external-editor'),
  (error) => error instanceof AgentSessionError && error.code === 'SESSION_ALREADY_ACTIVE',
)

const queuedManager = new AgentSessionManager()
const queued = queuedManager.createRequest('排队任务')
assert.equal(queuedManager.cancelRequest(queued.sessionId).status, 'cancelled')

assert.throws(
  () => queuedManager.getRequest('missing-session'),
  (error) => error instanceof AgentSessionError && error.code === 'SESSION_NOT_FOUND',
)

const completed = externalManager.reportResult(external.session.sessionId, external.session.revision, 'completed', '已完成')
assert.equal(completed.ok, true)
const lateProgress = externalManager.reportProgress(external.session.sessionId, external.session.revision, 'editing', 20, '不应继续')
assert.equal(lateProgress.ok, false)
assert.equal(lateProgress.error?.code, 'SESSION_NOT_ACTIVE')
console.log('AI editor agent session tests passed')

// A result ends one execution, never the task identity. Older tasks remain resumable.
const continuing = new AgentSessionManager()
const first = continuing.createRequest('原始要求', 'retained-project', 'auto')
await continuing.waitForRequest('worker', 5)
continuing.reportResult(first.sessionId, 1, 'completed', '第一版完成')
const other = continuing.createRequest('另一个任务', null, 'auto')
await assert.rejects(continuing.continueRequest(first.sessionId, 1, '继续'), error => error.code === 'SESSION_ALREADY_ACTIVE')
continuing.cancelRequest(other.sessionId)
const resumed = await continuing.continueRequest(first.sessionId, 1, '继续调整')
assert.equal(resumed.sessionId, first.sessionId)
assert.equal(resumed.projectId, 'retained-project')
assert.equal(resumed.revision, 2)
assert.equal(resumed.purpose, 'auto')
assert.equal(continuing.gateActiveTool().error.code, 'REQUEST_UPDATED')
continuing.getRequest(first.sessionId)
assert.equal(continuing.reportProgress(first.sessionId, 1, 'editing', 50, '旧结果').error.code, 'REQUEST_UPDATED')
continuing.reportResult(first.sessionId, 2, 'failed', '当前执行失败')
const saved = await continuing.archive.find(first.sessionId)
const restarted = new AgentSessionManager()
restarted.archive.load = async id => id === first.sessionId ? saved : null
const recovery = await restarted.continueRequest(first.sessionId, 2, '重启后继续')
assert.equal(recovery.revision, 3)
assert.ok(restarted.snapshot().events[0].sequence > saved.sequence)
assert.equal(recovery.createdAt, first.createdAt)
