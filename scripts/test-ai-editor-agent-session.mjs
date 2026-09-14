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
assert.equal(cancelled.cancelRequested, true)
assert.equal(manager.gateActiveTool()?.error?.code, 'CANCEL_REQUESTED')

const result = manager.reportResult(created.sessionId, 2, 'cancelled', '用户已停止')
assert.equal(result.ok, true)
assert.equal(manager.snapshot().session?.status, 'cancelled')

assert.deepEqual(events.map((event) => event.type), [
  'session-created',
  'session-claimed',
  'request-updated',
  'progress',
  'cancel-requested',
  'result',
])

const externalManager = new AgentSessionManager()
const external = externalManager.startExternalRequest('我8月29号出去玩了，帮我剪个30秒短片', 'external-editor')
assert.equal(external.state, 'claimed')
assert.equal(external.session?.agentId, 'external-editor')
assert.equal(externalManager.gateActiveTool()?.allowed, true)

const retry = externalManager.startExternalRequest('我8月29号出去玩了，帮我剪个30秒短片', 'external-editor')
assert.equal(retry.session?.sessionId, external.session?.sessionId)

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
