import { createServer, type Server } from 'node:http'
import { existsSync } from 'node:fs'
import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import type { Page } from '@playwright/test'

import { expect, test } from './fixtures/lunaElectron'

const SOURCE_USER_DATA_DIR = process.env.LUNA_E2E_SOURCE_USER_DATA_DIR
  ?? '/Users/zhouchao/Library/Application Support/luna-ai-cut'
const SOURCE_PROJECT_ID = process.env.LUNA_E2E_PROJECT_ID ?? 'Dag9toSB'
const USE_EXISTING_USER_DATA = Boolean(process.env.LUNA_E2E_EXISTING_USER_DATA_DIR)
const AI_CONFIG_FILE = path.join(
  process.env.LUNA_E2E_EXISTING_USER_DATA_DIR ?? SOURCE_USER_DATA_DIR,
  'ai-editing-assistant.json',
)
const FIRST_MESSAGE = '我最近给我家宝宝做了一个 AI-agent， 可以通过语音聊天告诉AI， 会帮助她做一个简单的小游戏， 现在我想做个抖音视频， 帮我设计下脚本呢'
const SECOND_MESSAGE = 'OK就按照这个方案吧'

interface AiConfig {
  baseUrl: string
  model: string
  apiKey: string
}

interface StoredRun {
  request: string
  completed: boolean
  timelineRevisionBefore: number
  timelineRevisionAfter: number
  toolCalls: Array<{ id: string; ok: boolean; message: string }>
  completionNotes: string[]
  events?: Array<{
    type?: string
    data?: {
      toolId?: string
      result?: { ok?: boolean; data?: { commitId?: string } }
    }
  }>
}

interface ConversationFile {
  messages?: Array<{ role?: string; content?: string }>
}

interface StoredProject {
  timeline: { items: unknown[] }
  aiEditingPublication?: {
    version?: number
    sourceCommitId?: string
    buildFingerprint?: string
    revisionBefore?: number
    revisionAfter?: number
    receipt?: unknown
  }
}

async function readRequestBody(request: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

async function startLiveModelProxy(config: AiConfig): Promise<{
  baseUrl: string
  requestCount(): number
  close(): Promise<void>
}> {
  let requests = 0
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    requests += 1
    try {
      const upstream = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': request.headers['content-type'] ?? 'application/json',
        },
        body: await readRequestBody(request),
      })
      response.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-cache',
      })
      if (!upstream.body) {
        response.end()
        return
      }
      const reader = upstream.body.getReader()
      let streamComplete = false
      while (!streamComplete) {
        const { done, value } = await reader.read()
        streamComplete = done
        if (value) response.write(Buffer.from(value))
      }
      response.end()
    } catch (error) {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }))
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Live model proxy did not start')
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requestCount: () => requests,
    close: () => closeServer(server),
  }
}

async function readRuns(projectDirectory: string): Promise<StoredRun[]> {
  try {
    const stored = JSON.parse(
      await readFile(path.join(projectDirectory, 'ai-editing-runs.json'), 'utf8'),
    ) as { runs?: StoredRun[] }
    return stored.runs ?? []
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function ensureAssistantReady(page: Page) {
  const input = page.getByPlaceholder('描述想要完成的剪辑')
  if (!(await input.isVisible())) {
    const openButton = page.getByRole('button', { name: '打开剪辑助手' })
    if (await openButton.isVisible()) await openButton.click()
  }
  await expect(input).toBeEnabled()
  return input
}

async function waitForRun(
  page: Page,
  projectDirectory: string,
  expectedCount: number,
  timeout: number,
): Promise<StoredRun> {
  await Promise.race([
    expect.poll(async () => (await readRuns(projectDirectory)).length, { timeout }).toBe(expectedCount),
    page.getByRole('alert').waitFor({ state: 'visible', timeout }).then(async () => {
      throw new Error(`剪辑助手报错：${await page.getByRole('alert').innerText()}`)
    }),
  ])
  await expect(page.getByPlaceholder('描述想要完成的剪辑')).toBeEnabled({ timeout })
  return (await readRuns(projectDirectory)).at(-1)!
}

test.skip(process.env.LUNA_E2E_LIVE !== '1', '需要显式设置 LUNA_E2E_LIVE=1 才会调用真实模型')
test.skip(!existsSync(AI_CONFIG_FILE), '没有可用的剪辑助手模型配置')
test.use({
  lunaElectronOptions: {
    launchEnv: {},
    ...(USE_EXISTING_USER_DATA
      ? {}
      : { seedProject: { sourceUserDataDir: SOURCE_USER_DATA_DIR, projectId: SOURCE_PROJECT_ID } }),
  },
})
test.setTimeout(20 * 60_000)

test('真实 Coding Agent 可从脚本讨论继续完成模块化剪辑工程', async ({ lunaApp }) => {
  const { page, runtimeErrors, workspaceDir } = lunaApp
  const config = JSON.parse(await readFile(AI_CONFIG_FILE, 'utf8')) as AiConfig
  const proxy = await startLiveModelProxy(config)
  let proxyConfigSaved = false
  try {
    await page.getByRole('link', { name: '剪辑', exact: true }).click()
    await page.evaluate(({ baseUrl, model }) => window.luna.aiEditingAssistant.saveConfig({
      baseUrl,
      model,
      apiKey: 'e2e-live-proxy-key',
      nativeToolCalling: true,
    }), { baseUrl: proxy.baseUrl, model: config.model })
    proxyConfigSaved = true

    const projectCard = page.locator(`[data-project-card][data-project-id="${SOURCE_PROJECT_ID}"]`)
    await expect(projectCard).toBeVisible()
    await projectCard.dblclick()
    await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()
    const projectDirectory = path.join(
      workspaceDir,
      'projects',
      SOURCE_PROJECT_ID,
    )
    await access(path.join(projectDirectory, 'project.json'))
    const initialRunCount = (await readRuns(projectDirectory)).length
    const initialProject = JSON.parse(
      await readFile(path.join(projectDirectory, 'project.json'), 'utf8'),
    ) as StoredProject
    const input = await ensureAssistantReady(page)
    const send = page.getByRole('button', { name: '发送剪辑请求' })

    await page.evaluate(() => {
      const state = window as typeof window & { __sawFirstAttemptLabel?: boolean }
      state.__sawFirstAttemptLabel = false
      new MutationObserver(() => {
        if (/第\s*1\/3\s*次/.test(document.body.innerText)) state.__sawFirstAttemptLabel = true
      }).observe(document.body, { childList: true, subtree: true, characterData: true })
    })

    await input.fill(FIRST_MESSAGE)
    await send.click()
    const scriptRun = await waitForRun(
      page,
      projectDirectory,
      initialRunCount + 1,
      7 * 60_000,
    )
    expect(scriptRun).toMatchObject({
      request: FIRST_MESSAGE,
      completed: true,
      toolCalls: [],
      completionNotes: [],
    })
    expect(scriptRun.timelineRevisionAfter).toBe(scriptRun.timelineRevisionBefore)
    const firstConversation = JSON.parse(await readFile(
      path.join(projectDirectory, 'ai-editing-conversation.json'),
      'utf8',
    )) as ConversationFile
    const scriptReply = firstConversation.messages?.at(-1)?.content ?? ''
    expect(scriptReply.length).toBeGreaterThan(20)
    expect(scriptReply).toMatch(/脚本|镜头|画面|开场|抖音/)

    await input.fill(SECOND_MESSAGE)
    await send.click()
    const editRun = await waitForRun(
      page,
      projectDirectory,
      initialRunCount + 2,
      12 * 60_000,
    )
    expect(editRun.request).toBe(SECOND_MESSAGE)
    expect(editRun.completed).toBe(true)
    expect(editRun.completionNotes).toEqual([])
    expect(editRun.timelineRevisionAfter).toBeGreaterThan(editRun.timelineRevisionBefore)

    const toolIds = editRun.toolCalls.map((call) => call.id)
    for (const expectedTool of [
      'workspace.patch',
      'timeline.check',
      'timeline.build',
      'timeline.test',
      'timeline.diff',
      'git.commit',
      'timeline.commit',
    ]) expect(toolIds).toContain(expectedTool)
    for (const toolId of ['timeline.check', 'timeline.build', 'timeline.test', 'timeline.diff']) {
      expect(editRun.toolCalls.findLast((call) => call.id === toolId)?.ok).toBe(true)
    }
    const failedCalls = editRun.toolCalls.filter((call) => !call.ok)
    expect(failedCalls).toEqual([])
    expect(toolIds).not.toContain('workspace.apply_edit_program')
    expect(toolIds.indexOf('workspace.patch')).toBeLessThan(toolIds.indexOf('git.commit'))
    expect(toolIds.indexOf('git.commit')).toBeLessThan(toolIds.indexOf('timeline.commit'))

    const sourceDirectory = path.join(projectDirectory, 'editing-source')
    await access(path.join(sourceDirectory, '.git', 'HEAD'))
    await access(path.join(sourceDirectory, 'manifest.json'))
    const sourceFiles = await readdir(sourceDirectory, { recursive: true })
    expect(sourceFiles.some((file) => file.endsWith('.segment.json'))).toBe(true)

    const project = JSON.parse(
      await readFile(path.join(projectDirectory, 'project.json'), 'utf8'),
    ) as StoredProject
    expect(project.timeline.items.length).toBeGreaterThan(0)
    expect(project.aiEditingPublication).toMatchObject({
      version: 1,
    })
    expect(project.aiEditingPublication?.revisionBefore)
      .toBeGreaterThanOrEqual(editRun.timelineRevisionBefore)
    expect(project.aiEditingPublication?.revisionAfter)
      .toBeGreaterThan(project.aiEditingPublication?.revisionBefore ?? 0)
    expect(project.aiEditingPublication?.sourceCommitId).toMatch(/^[0-9a-f]{40}$/)
    expect(project.aiEditingPublication?.sourceCommitId)
      .not.toBe(initialProject.aiEditingPublication?.sourceCommitId)
    expect(project.aiEditingPublication?.buildFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(project.aiEditingPublication?.receipt).toBeTruthy()

    const headReference = (await readFile(path.join(sourceDirectory, '.git', 'HEAD'), 'utf8'))
      .trim()
      .replace(/^ref:\s*/, '')
    const gitHead = (await readFile(path.join(sourceDirectory, '.git', headReference), 'utf8')).trim()
    expect(gitHead).toBe(project.aiEditingPublication?.sourceCommitId)
    const successfulResults = editRun.events?.filter((event) => (
      event.type === 'tool-result' && event.data?.result?.ok
    )) ?? []
    const sourceCommitId = successfulResults.findLast(
      (event) => event.data?.toolId === 'git.commit',
    )?.data?.result?.data?.commitId
    const publishedCommitId = successfulResults.findLast(
      (event) => event.data?.toolId === 'timeline.commit',
    )?.data?.result?.data?.commitId
    expect(sourceCommitId).toBe(gitHead)
    expect(publishedCommitId).toBe(gitHead)

    const conversation = JSON.parse(await readFile(
      path.join(projectDirectory, 'ai-editing-conversation.json'),
      'utf8',
    )) as ConversationFile
    expect(conversation.messages?.map((message) => message.content).slice(-4)).toEqual([
      FIRST_MESSAGE,
      scriptReply,
      SECOND_MESSAGE,
      expect.any(String),
    ])
    expect(await page.evaluate(() => (
      window as typeof window & { __sawFirstAttemptLabel?: boolean }
    ).__sawFirstAttemptLabel)).toBe(false)
    expect(proxy.requestCount()).toBeGreaterThanOrEqual(2)
    expect(runtimeErrors).toEqual([])
  } finally {
    if (proxyConfigSaved && !page.isClosed()) {
      await page.evaluate((original) => window.luna.aiEditingAssistant.saveConfig(original), config)
        .catch(() => undefined)
    }
    await proxy.close()
  }
})
