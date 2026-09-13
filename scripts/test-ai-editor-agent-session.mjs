import assert from 'node:assert/strict'

import { AgentSessionManager } from '../electron/mcp/agentSessionManager.ts'

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
console.log('AI editor agent session tests passed')
