import { createServer, type Server } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from '@playwright/test'

import { expect, test } from './fixtures/lunaElectron'
import { sendTextCompletion, sendToolCallCompletion } from './support/chatCompletionsStream'

const SCRIPT_REQUEST = '我最近给我家宝宝做了一个 AI-agent， 可以通过语音聊天告诉AI， 会帮助她做一个简单的小游戏， 现在我想做个抖音视频， 帮我设计下脚本呢  根据实际素材内容'
const CONFIRM_REQUEST = '可以呀 就按照这个来吧'
const NARRATION_REQUEST = '帮我将字幕删除掉， 改成独立的旁白 你设计一下'

interface ChatRequest {
  tools?: Array<{ function?: { name?: string } }>
  messages?: Array<{ role?: string; content?: string }>
}

interface ToolResult {
  toolId?: string
  result?: { data?: Record<string, unknown> }
}

interface StoredRun {
  request: string
  status: string
  completed: boolean
  changedProject: boolean
  toolCalls: Array<{ id: string; ok: boolean; message: string }>
  completionNotes: string[]
}

const subtitleTrackPath = 'sequences/main/tracks/e2e-subtitle/track.json'
const subtitleSegmentPath = 'sequences/main/tracks/e2e-subtitle/segments/w000000-p01.json'
const audioTrackPath = 'sequences/main/tracks/e2e-audio/track.json'
const audioSegmentPath = 'sequences/main/tracks/e2e-audio/segments/w000000-p01.json'
const videoTrackPath = 'sequences/main/tracks/e2e-video/track.json'
const videoSegmentPath = 'sequences/main/tracks/e2e-video/segments/w000000-p01.json'

function jsonSource(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

const subtitleTrack = jsonSource({
  version: 3,
  kind: 'track',
  track: {
    id: 'e2e-subtitle', name: '字幕', kind: 'subtitle', height: 40,
    locked: false, visible: true, muted: false, solo: false, order: 0, items: [],
  },
  segments: [{ path: subtitleSegmentPath, startFrame: 0, endFrame: 150, clipCount: 1 }],
})

const subtitleSegment = jsonSource({
  version: 3,
  kind: 'clip-segment',
  trackId: 'e2e-subtitle',
  window: 0,
  clips: [{
    id: 'e2e-title', type: 'text', trackId: 'e2e-subtitle', from: 0,
    durationInFrames: 150, label: '开场字幕', text: '给宝宝做了一个 AI 玩伴',
    color: '#ffffff', fontSize: 48, textAlign: 'center',
    textBox: { left: 0.1, top: 0.4, width: 0.8, height: 0.2 },
  }],
})

function audioTrack(name: string): string {
  return jsonSource({
    version: 3,
    kind: 'track',
    track: {
      id: 'e2e-audio', name, kind: 'audio', height: 60,
      locked: false, visible: true, muted: false, solo: false, order: 1, items: [],
    },
    segments: [{ path: audioSegmentPath, startFrame: 0, endFrame: 0, clipCount: 0 }],
  })
}

const emptyAudioSegment = jsonSource({
  version: 3, kind: 'clip-segment', trackId: 'e2e-audio', window: 0, clips: [],
})

const videoTrack = jsonSource({
  version: 3,
  kind: 'track',
  track: {
    id: 'e2e-video', name: '视频', kind: 'video', height: 80,
    locked: false, visible: true, muted: false, solo: false, order: 1, items: [],
  },
  segments: [{ path: videoSegmentPath, startFrame: 0, endFrame: 0, clipCount: 0 }],
})

const emptyVideoSegment = jsonSource({
  version: 3, kind: 'clip-segment', trackId: 'e2e-video', window: 0, clips: [],
})

async function requestBody(request: AsyncIterable<Uint8Array>): Promise<ChatRequest> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as ChatRequest
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

function toolName(payload: ChatRequest, id: string): string {
  const name = `fc_${id.replaceAll('.', '_')}`
  if (!payload.tools?.some((tool) => tool.function?.name === name)) {
    throw new Error(`Missing tool ${id}`)
  }
  return name
}

function callTool(
  response: Parameters<typeof sendToolCallCompletion>[0],
  payload: ChatRequest,
  index: number,
  id: string,
  args: Record<string, unknown>,
): void {
  sendToolCallCompletion(response, {
    id: `call_revision_${index}_${id.replaceAll('.', '_')}`,
    name: toolName(payload, id),
    arguments: JSON.stringify(args),
  })
}

function toolResults(payload: ChatRequest): ToolResult[] {
  return payload.messages?.flatMap((message) => {
    if (message.role !== 'tool' || typeof message.content !== 'string') return []
    try {
      return [JSON.parse(message.content) as ToolResult]
    } catch {
      return []
    }
  }) ?? []
}

function readResult(payload: ChatRequest, pathValue: string): { content: string; revision: string } {
  const result = toolResults(payload).findLast((entry) => (
    entry.toolId === 'source.read' && entry.result?.data?.path === pathValue
  ))?.result?.data
  if (typeof result?.content !== 'string' || typeof result.revision !== 'string') {
    throw new Error(`Missing source.read result for ${pathValue}`)
  }
  return { content: result.content, revision: result.revision }
}

function withTracks(sequence: string, tracks: string[]): string {
  const value = JSON.parse(sequence) as Record<string, unknown>
  value.tracks = tracks
  return jsonSource(value)
}

async function startDialogueMock(): Promise<{ baseUrl: string; close(): Promise<void> }> {
  let requestIndex = 0
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    const payload = await requestBody(request)
    const index = requestIndex++

    if (index === 0) {
      sendTextCompletion(response, '脚本方案：开场展示宝宝提出需求，中段展示 AI 生成游戏，结尾保留温馨互动。')
      return
    }
    if (index === 1) {
      callTool(response, payload, index, 'source.read', { path: 'sequences/main/sequence.json' })
      return
    }
    if (index === 2) {
      const sequence = readResult(payload, 'sequences/main/sequence.json')
      callTool(response, payload, index, 'source.apply_changes', {
        changes: [
          {
            path: 'sequences/main/sequence.json', revision: sequence.revision,
            content: withTracks(sequence.content, [subtitleTrackPath, videoTrackPath, audioTrackPath]),
          },
          { path: subtitleTrackPath, revision: null, content: subtitleTrack },
          { path: subtitleSegmentPath, revision: null, content: subtitleSegment },
          { path: audioTrackPath, revision: null, content: audioTrack('音频') },
          { path: audioSegmentPath, revision: null, content: emptyAudioSegment },
          { path: videoTrackPath, revision: null, content: videoTrack },
          { path: videoSegmentPath, revision: null, content: emptyVideoSegment },
        ],
      })
      return
    }
    if (index === 3) {
      callTool(response, payload, index, 'timeline.check', {})
      return
    }
    if (index === 4) {
      callTool(response, payload, index, 'git.commit', { message: 'Create initial scripted edit' })
      return
    }
    if (index === 5) {
      callTool(response, payload, index, 'source.read', { path: 'sequences/main/sequence.json' })
      return
    }
    if (index === 6) {
      callTool(response, payload, index, 'source.read', { path: subtitleTrackPath })
      return
    }
    if (index === 7) {
      callTool(response, payload, index, 'source.read', { path: subtitleSegmentPath })
      return
    }
    if (index === 8) {
      callTool(response, payload, index, 'source.read', { path: audioTrackPath })
      return
    }
    if (index === 9) {
      const sequence = readResult(payload, 'sequences/main/sequence.json')
      const subtitleTrackResult = readResult(payload, subtitleTrackPath)
      const subtitleSegmentResult = readResult(payload, subtitleSegmentPath)
      const audioTrackResult = readResult(payload, audioTrackPath)
      callTool(response, payload, index, 'source.apply_changes', {
        changes: [
          {
            path: 'sequences/main/sequence.json', revision: sequence.revision,
            content: withTracks(sequence.content, [videoTrackPath, audioTrackPath]),
          },
          { path: subtitleTrackPath, revision: subtitleTrackResult.revision, content: null },
          { path: subtitleSegmentPath, revision: subtitleSegmentResult.revision, content: null },
          { path: audioTrackPath, revision: audioTrackResult.revision, content: audioTrack('旁白') },
        ],
      })
      return
    }
    if (index === 10) {
      callTool(response, payload, index, 'timeline.check', {})
      return
    }
    if (index === 11) {
      callTool(response, payload, index, 'git.commit', { message: 'Replace subtitles with narration track' })
      return
    }
    response.writeHead(500).end(JSON.stringify({ error: { message: `Unexpected request ${index}` } }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Unable to start dialogue mock')
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, close: () => closeServer(server) }
}

async function projectDirectory(workspaceDir: string): Promise<string> {
  const entries = await readdir(path.join(workspaceDir, 'projects'), { withFileTypes: true })
  const project = entries.find((entry) => entry.isDirectory())
  if (!project) throw new Error('E2E project was not created')
  return path.join(workspaceDir, 'projects', project.name)
}

async function runs(directory: string): Promise<StoredRun[]> {
  const value = JSON.parse(await readFile(path.join(directory, 'ai-editing-runs.json'), 'utf8')) as {
    runs?: StoredRun[]
  }
  return value.runs ?? []
}

async function send(page: Page, message: string): Promise<void> {
  const input = page.getByPlaceholder('描述想要完成的剪辑')
  await input.fill(message)
  await page.getByRole('button', { name: '发送剪辑请求' }).click()
  await expect(input).toBeEnabled({ timeout: 60_000 })
}

test('按实际对话确认剪辑后可原子删除字幕并改为独立旁白', async ({ lunaApp }) => {
  test.setTimeout(180_000)
  const { page, runtimeErrors, workspaceDir } = lunaApp
  const mock = await startDialogueMock()
  try {
    await page.getByRole('link', { name: '剪辑', exact: true }).click()
    await page.evaluate((baseUrl) => window.luna.aiEditingAssistant.saveConfig({
      baseUrl, model: 'source-revision-e2e', apiKey: 'e2e-placeholder-key',
      contextWindowTokens: 256 * 1024,
    }), mock.baseUrl)
    await page.getByRole('link', { name: /^(创建第一个项目|新建项目)$/ }).click()
    await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()
    const input = page.getByPlaceholder('描述想要完成的剪辑')
    if (!(await input.isVisible())) await page.getByRole('button', { name: '打开剪辑助手' }).click()
    await expect(input).toBeEnabled()

    await send(page, SCRIPT_REQUEST)
    await send(page, CONFIRM_REQUEST)
    const directory = await projectDirectory(workspaceDir)
    await expect.poll(async () => (await runs(directory)).length).toBe(2)
    expect((await runs(directory)).at(-1)).toMatchObject({
      request: CONFIRM_REQUEST, status: 'completed', completed: true, changedProject: true,
    })

    await send(page, NARRATION_REQUEST)
    await expect.poll(async () => (await runs(directory)).length).toBe(3)
    const narrationRun = (await runs(directory)).at(-1)!
    expect(narrationRun).toMatchObject({
      request: NARRATION_REQUEST,
      status: 'completed',
      completed: true,
      changedProject: true,
      completionNotes: [],
    })
    expect(narrationRun.toolCalls.filter((call) => !call.ok)).toEqual([])
    expect(narrationRun.toolCalls.filter((call) => call.id === 'source.apply_changes')).toHaveLength(1)
    expect(narrationRun.toolCalls.at(-1)).toMatchObject({ id: 'git.commit', ok: true })

    const sourceRoot = path.join(directory, 'editing-source')
    const sequence = JSON.parse(await readFile(path.join(sourceRoot, 'sequences/main/sequence.json'), 'utf8')) as {
      tracks: string[]
    }
    expect(sequence.tracks).toEqual([videoTrackPath, audioTrackPath])
    expect(JSON.parse(await readFile(path.join(sourceRoot, audioTrackPath), 'utf8')).track.name)
      .toBe('旁白')
    await expect(readFile(path.join(sourceRoot, subtitleTrackPath), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(readFile(path.join(sourceRoot, subtitleSegmentPath), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(runtimeErrors).toEqual([])
  } finally {
    await mock.close()
  }
})
