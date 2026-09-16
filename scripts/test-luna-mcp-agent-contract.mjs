import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createLunaMcpServer } from '../electron/mcp/lunaMcpServer.ts'
import { AgentSessionManager } from '../electron/mcp/agentSessionManager.ts'

const homeDir = await mkdtemp(path.join(os.tmpdir(), 'luna-mcp-agent-contract-'))
const manager = new AgentSessionManager()
const rendererCalls = []
const agentEvents = []
let releaseSlowRenderer
const slowRenderer = new Promise((resolve) => {
  releaseSlowRenderer = resolve
})
manager.subscribe((event) => agentEvents.push(event))
let activations = 0
const server = createLunaMcpServer({
  homeDir,
  agentSession: manager,
  activateWindow: () => { activations += 1 },
  requestRenderer: async (request) => {
    rendererCalls.push(request)
    if (request.kind === 'listTools') return { ok: false, error: 'AI 剪辑页面尚未加载' }
    if (request.name === 'create_media_contact_sheet') {
      return {
        ok: true,
        result: {
          ok: false,
          summary: '联络表渲染失败',
          error: {
            code: 'CONTACT_SHEET_RENDER_FAILED',
            message: 'FFmpeg 无法拼接联络表',
            retryable: true,
            suggestedAction: '调整 maxWidth 或 columns 后最多重试一次',
          },
        },
      }
    }
    if (request.name === 'export_video') {
      return { ok: true, result: { ok: true, summary: '视频已导出', data: { path: '/tmp/luna-export.mp4' } } }
    }
    if (request.name === 'add_clip') return await slowRenderer
    return { ok: true, result: { ok: true, summary: '测试写入完成' } }
  },
})

async function rpc(endpoint, id, method, params = {}) {
  const response = await fetch(endpoint.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  })
  assert.equal(response.status, 200)
  return await response.json()
}

try {
  const endpoint = await server.start()
  assert.equal(endpoint.token, undefined)

  const discoveryResponse = await fetch(endpoint.baseUrl)
  assert.equal(discoveryResponse.status, 200)
  const discovery = await discoveryResponse.json()
  assert.equal(discovery.name, 'Luna AI Cut')
  assert.equal(discovery.agent, true)
  assert.equal(discovery.auth, undefined)
  assert.equal(discovery.token, undefined)
  const wellKnownResponse = await fetch(`${endpoint.baseUrl}/.well-known/agent`)
  assert.equal(wellKnownResponse.status, 200)
  assert.equal((await wellKnownResponse.json()).skill, discovery.skill)

  const skillResponse = await fetch(endpoint.skillUrl)
  assert.equal(skillResponse.status, 200)
  assert.match(await skillResponse.text(), /POST \/api\/tools\/{toolName}/)

  const httpToolsResponse = await fetch(endpoint.toolsUrl)
  assert.equal(httpToolsResponse.status, 200)
  const httpTools = await httpToolsResponse.json()
  assert.equal(httpTools.ok, true)
  assert.equal(httpTools.meta.luna.editorToolsReady, false)
  assert.ok(httpTools.tools.some((tool) => tool.name === 'start_edit_session'))
  assert.ok(httpTools.tools.some((tool) => tool.name === 'generate_background_music'))
  assert.ok(httpTools.tools.some((tool) => tool.name === 'list_music_templates'))

  const openApiResponse = await fetch(endpoint.openapiUrl)
  assert.equal(openApiResponse.status, 200)
  const openApi = await openApiResponse.json()
  assert.equal(openApi.openapi, '3.1.0')
  assert.ok(openApi.paths['/api/tools/start_edit_session'])
  assert.ok(openApi.paths['/api/tools/generate_background_music'])
  assert.equal(openApi.security, undefined)
  assert.equal(openApi.components, undefined)

  const httpCall = async (name, arguments_) => {
    const response = await fetch(`${endpoint.baseUrl}/api/tools/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ arguments: arguments_ }),
    })
    assert.equal(response.status, 200)
    return await response.json()
  }

  const initialTools = await rpc(endpoint, 1, 'tools/list')
  assert.equal(initialTools.result._meta.luna.editorToolsReady, false)
  assert.ok(initialTools.result.tools.some((tool) => tool.name === 'start_edit_session'))
  const waitMissingIdentity = await httpCall('wait_for_edit_request', {})
  assert.equal(waitMissingIdentity.ok, false)
  assert.equal(waitMissingIdentity.error.code, 'INVALID_PARAMS')

  const blocked = await rpc(endpoint, 3, 'tools/call', {
    name: 'create_project',
    arguments: {},
  })
  assert.equal(blocked.result.isError, true)
  assert.equal(blocked.result.structuredContent.error.code, 'SESSION_REQUIRED')
  assert.equal(rendererCalls.filter((call) => call.kind === 'callTool').length, 0)

  const blockedMusic = await httpCall('generate_background_music', {
    dsl: 'bgm 1\ndur 1\nbpm 120\nts 4/4',
  })
  assert.equal(blockedMusic.ok, false)
  assert.equal(blockedMusic.error.code, 'SESSION_REQUIRED')

  const missingIdentity = await rpc(endpoint, 3.5, 'tools/call', {
    name: 'start_edit_session',
    arguments: { request: '剪一个 30 秒旅行短片', agentId: 'contract-test' },
  })
  assert.equal(missingIdentity.result.isError, true)
  assert.equal(missingIdentity.result.structuredContent.error.code, 'INVALID_PARAMS')

  const started = await rpc(endpoint, 4, 'tools/call', {
    name: 'start_edit_session',
    arguments: {
      request: '剪一个 30 秒旅行短片',
      agentId: 'contract-test',
      agentType: 'HTTP contract test agent',
      agentModel: 'test-model',
    },
  })
  assert.equal(started.result.structuredContent.data.state, 'claimed')
  const session = started.result.structuredContent.data.session
  assert.equal(session.agentId, 'contract-test')
  assert.equal(session.agentType, 'HTTP contract test agent')
  assert.equal(session.agentModel, 'test-model')
  assert.equal(activations, 1)

  const failedContactSheet = await httpCall('create_media_contact_sheet', { mediaIds: ['local-media:a'] })
  assert.equal(failedContactSheet.ok, false)
  assert.equal(failedContactSheet.error.code, 'CONTACT_SHEET_RENDER_FAILED')
  assert.equal(failedContactSheet.error.retryable, true)
  assert.equal(failedContactSheet.error.suggestedAction, '调整 maxWidth 或 columns 后最多重试一次')
  const failedToolEvent = agentEvents.at(-1)
  assert.equal(failedToolEvent.type, 'tool-finished')
  assert.equal(failedToolEvent.ok, false)
  assert.equal(failedToolEvent.toolName, 'create_media_contact_sheet')
  assert.equal(failedToolEvent.error.code, 'CONTACT_SHEET_RENDER_FAILED')
  assert.equal(failedToolEvent.error.retryable, true)

  const httpEdit = await httpCall('create_project', {})
  assert.equal(httpEdit.ok, true)
  assert.equal(httpEdit.summary, '测试写入完成')
  assert.equal(httpEdit.data.lunaAgent.requestChanged, false)

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

  const exportNotRequested = await httpCall('export_video', { format: 'mp4' })
  assert.equal(exportNotRequested.ok, false)
  assert.equal(exportNotRequested.error.code, 'EXPORT_NOT_REQUESTED')
  assert.equal(rendererCalls.filter((call) => call.name === 'export_video').length, 0)

  const updatedForExport = manager.updateRequest(session.sessionId, '剪一个 30 秒旅行短片，完成后导出')
  const acknowledgedExport = await rpc(endpoint, 7, 'tools/call', {
    name: 'get_edit_request',
    arguments: { sessionId: session.sessionId, knownRevision: session.revision },
  })
  assert.equal(acknowledgedExport.result.structuredContent.data.changed, true)
  assert.equal(acknowledgedExport.result.structuredContent.data.session.revision, updatedForExport.revision)

  const exportPromise = httpCall('export_video', { format: 'mp4' })
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(manager.snapshot().session.exportConfirmation, 'pending')
  assert.equal(rendererCalls.filter((call) => call.name === 'export_video').length, 0)

  manager.confirmExport(session.sessionId)
  const exported = await exportPromise
  assert.equal(exported.ok, true)
  assert.equal(exported.data.lunaAgent.requestChanged, false)
  assert.equal(rendererCalls.filter((call) => call.name === 'export_video').length, 1)

  const completed = await rpc(endpoint, 9, 'tools/call', {
    name: 'report_edit_result',
    arguments: {
      sessionId: session.sessionId,
      revision: updatedForExport.revision,
      status: 'completed',
      summary: '测试完成',
      exportPath: '/tmp/forged-path.mp4',
    },
  })
  assert.equal(completed.result.structuredContent.ok, true)
  assert.equal(manager.snapshot().session.result.exportPath, '/tmp/luna-export.mp4')

  const restarted = await rpc(endpoint, 9.5, 'tools/call', {
    name: 'start_edit_session',
    arguments: {
      request: '再剪一个 10 秒片段',
      agentId: 'contract-test',
      agentType: 'HTTP contract test agent',
      agentModel: 'test-model',
    },
  })
  const restartedSession = restarted.result.structuredContent.data.session
  const inFlight = httpCall('add_clip', { mediaId: 'local-media:a' })
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(manager.snapshot().session.status, 'running')
  manager.cancelRequest(restartedSession.sessionId)
  const stopped = await Promise.race([
    inFlight,
    new Promise((resolve) => setTimeout(() => resolve(null), 1_000)),
  ])
  assert.ok(stopped)
  assert.equal(stopped.ok, false)
  assert.equal(stopped.error.code, 'USER_STOPPED')
  assert.equal(stopped.error.retryable, false)
  assert.equal(stopped.error.suggestedAction, '不要重试当前任务')
  releaseSlowRenderer({ ok: true, result: { ok: true, summary: '不应继续执行' } })

  const lateEdit = await rpc(endpoint, 10, 'tools/call', {
    name: 'create_project',
    arguments: {},
  })
  assert.equal(lateEdit.result.isError, true)
  assert.equal(lateEdit.result.structuredContent.error.code, 'USER_STOPPED')
  assert.equal(lateEdit.result.structuredContent.error.retryable, false)

  console.log('Luna MCP agent contract tests passed')
} finally {
  await server.stop()
  await rm(homeDir, { recursive: true, force: true })
}
