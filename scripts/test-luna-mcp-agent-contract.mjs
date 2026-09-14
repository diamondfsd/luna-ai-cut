import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createLunaMcpServer } from '../electron/mcp/lunaMcpServer.ts'
import { AgentSessionManager } from '../electron/mcp/agentSessionManager.ts'

const homeDir = await mkdtemp(path.join(os.tmpdir(), 'luna-mcp-agent-contract-'))
const manager = new AgentSessionManager()
const rendererCalls = []
let activations = 0
const musicTasks = new Map()
const musicGateway = {
  async getStatus() {
    return { model: { installed: false }, tasks: [] }
  },
  async start(request) {
    const task = { taskId: 'music-task-1', status: 'generating', progress: 0, ...request }
    musicTasks.set(task.taskId, task)
    return task
  },
  getTask(taskId) {
    return musicTasks.get(taskId) ?? null
  },
  async generate(request) {
    return { taskId: 'music-task-1', status: 'completed', outputPath: '/tmp/music.wav', ...request }
  },
  cancel(taskId) {
    const task = musicTasks.get(taskId)
    if (!task) throw new Error('MusicGen 任务不存在')
    task.status = 'cancelled'
    return task
  },
}
const server = createLunaMcpServer({
  homeDir,
  agentSession: manager,
  activateWindow: () => { activations += 1 },
  musicGeneration: musicGateway,
  requestRenderer: async (request) => {
    rendererCalls.push(request)
    if (request.kind === 'listTools') return { ok: false, error: 'AI 剪辑页面尚未加载' }
    return { ok: true, result: { ok: true, summary: '测试写入完成' } }
  },
})

async function rpc(endpoint, id, method, params = {}) {
  const response = await fetch(endpoint.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${endpoint.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  })
  assert.equal(response.status, 200)
  return await response.json()
}

try {
  const endpoint = await server.start()

  const initialTools = await rpc(endpoint, 1, 'tools/list')
  assert.equal(initialTools.result._meta.luna.editorToolsReady, false)
  assert.ok(initialTools.result.tools.some((tool) => tool.name === 'start_edit_session'))
  assert.ok(initialTools.result.tools.some((tool) => tool.name === 'generate_music'))

  const musicStatus = await rpc(endpoint, 2, 'tools/call', { name: 'get_music_generation_status' })
  assert.equal(musicStatus.result.structuredContent.ok, true)
  assert.equal(musicStatus.result.structuredContent.data.model.installed, false)

  const musicBeforeSession = await rpc(endpoint, 2.5, 'tools/call', {
    name: 'start_music_generation',
    arguments: { prompt: '纯音乐旅行背景', durationSec: 10 },
  })
  assert.equal(musicBeforeSession.result.structuredContent.ok, true)
  assert.equal(musicBeforeSession.result.structuredContent.data.taskId, 'music-task-1')

  const blocked = await rpc(endpoint, 3, 'tools/call', {
    name: 'create_project',
    arguments: {},
  })
  assert.equal(blocked.result.isError, true)
  assert.equal(blocked.result.structuredContent.error.code, 'SESSION_REQUIRED')
  assert.equal(rendererCalls.filter((call) => call.kind === 'callTool').length, 0)

  const started = await rpc(endpoint, 4, 'tools/call', {
    name: 'start_edit_session',
    arguments: { request: '剪一个 30 秒旅行短片', agentId: 'contract-test' },
  })
  assert.equal(started.result.structuredContent.data.state, 'claimed')
  const session = started.result.structuredContent.data.session
  assert.equal(session.agentId, 'contract-test')
  assert.equal(activations, 1)

  const invalidProgress = await rpc(endpoint, 5, 'tools/call', {
    name: 'report_edit_progress',
    arguments: {
      sessionId: session.sessionId,
      revision: session.revision,
      phase: 'not-a-phase',
      progress: 10,
      message: '测试',
    },
  })
  assert.equal(invalidProgress.result.isError, true)
  assert.equal(invalidProgress.result.structuredContent.error.code, 'INVALID_PARAMS')

  const edit = await rpc(endpoint, 6, 'tools/call', {
    name: 'create_project',
    arguments: {},
  })
  assert.equal(edit.result.structuredContent.ok, true)
  assert.equal(edit.result.structuredContent.data.lunaAgent.requestChanged, false)

  const musicStarted = await rpc(endpoint, 7, 'tools/call', {
    name: 'start_music_generation',
    arguments: { prompt: '纯音乐旅行背景，无歌词无人声', durationSec: 10 },
  })
  assert.equal(musicStarted.result.structuredContent.ok, true)
  assert.equal(musicStarted.result.structuredContent.data.taskId, 'music-task-1')

  const musicCancelled = await rpc(endpoint, 8, 'tools/call', {
    name: 'cancel_music_generation',
    arguments: { taskId: 'music-task-1' },
  })
  assert.equal(musicCancelled.result.structuredContent.data.status, 'cancelled')

  const missingMusicTask = await rpc(endpoint, 8.5, 'tools/call', {
    name: 'get_music_generation',
    arguments: { taskId: 'missing-music-task' },
  })
  assert.equal(missingMusicTask.result.isError, true)
  assert.equal(missingMusicTask.result.structuredContent.error.code, 'TASK_NOT_FOUND')

  const completed = await rpc(endpoint, 9, 'tools/call', {
    name: 'report_edit_result',
    arguments: {
      sessionId: session.sessionId,
      revision: session.revision,
      status: 'completed',
      summary: '测试完成',
    },
  })
  assert.equal(completed.result.structuredContent.ok, true)

  const lateEdit = await rpc(endpoint, 10, 'tools/call', {
    name: 'create_project',
    arguments: {},
  })
  assert.equal(lateEdit.result.isError, true)
  assert.equal(lateEdit.result.structuredContent.error.code, 'SESSION_NOT_ACTIVE')

  console.log('Luna MCP agent contract tests passed')
} finally {
  await server.stop()
  await rm(homeDir, { recursive: true, force: true })
}
