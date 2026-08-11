import { createServer, type Server } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from '@playwright/test'

import { expect, test } from './fixtures/lunaElectron'
import {
  beginChatCompletionStream,
  finishChatCompletionStream,
  sendTextCompletion,
  writeChatCompletionDelta,
} from './support/chatCompletionsStream'

const MESSAGE_A = '先帮我设计一个三十秒的开场'
const REPLY_A = '开场方案已经整理好了。'
const MESSAGE_B = '这是另一段临时对话'
const REPLY_B = '临时对话已经收到。'
const MESSAGE_C = '继续刚才的开场方案，补上结尾'
const REPLY_C = '结尾已经补充到原方案。'

interface ChatMessage {
  role?: unknown
  content?: unknown
}

interface ChatRequest {
  stream?: unknown
  messages?: ChatMessage[]
}

interface ConversationFile {
  version?: unknown
  messages?: Array<{ role?: unknown; content?: unknown }>
}

interface ConversationHistoryFile {
  version?: unknown
  sessions?: Array<{ messages?: Array<{ role?: unknown; content?: unknown }> }>
}

async function readRequestBody(request: AsyncIterable<Uint8Array>): Promise<ChatRequest> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as ChatRequest
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

async function startResumeChatMock(): Promise<{
  baseUrl: string
  requests: ChatRequest[]
  releaseRetriedContinuation(): void
  close(): Promise<void>
}> {
  const requests: ChatRequest[] = []
  let releaseContinuation: (() => void) | undefined
  const continuationGate = new Promise<void>((resolve) => {
    releaseContinuation = resolve
  })

  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }

    const payload = await readRequestBody(request)
    requests.push(payload)
    const requestIndex = requests.length - 1
    if (requestIndex === 2) {
      response.writeHead(503, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'Temporary test failure.' } }))
      return
    }
    const replies = [REPLY_A, REPLY_B, '', REPLY_C]
    if (requestIndex !== 3) {
      sendTextCompletion(response, replies[requestIndex] ?? '')
      return
    }

    beginChatCompletionStream(response)
    writeChatCompletionDelta(response, {
      reasoning_content: '正在检查开场节奏\n正在整理结尾衔接',
    })
    await continuationGate
    writeChatCompletionDelta(response, { content: REPLY_C })
    writeChatCompletionDelta(response, {}, 'stop')
    finishChatCompletionStream(response)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    await closeServer(server)
    throw new Error('无法启动剪辑助手测试服务。')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    releaseRetriedContinuation: () => releaseContinuation?.(),
    close: () => closeServer(server),
  }
}

async function findProjectDirectory(workspaceDir: string): Promise<string> {
  const projectsRoot = path.join(workspaceDir, 'projects')
  const entries = await readdir(projectsRoot, { withFileTypes: true })
  const project = entries.find((entry) => entry.isDirectory())
  if (!project) throw new Error('E2E project directory was not created')
  return path.join(projectsRoot, project.name)
}

function messageContents(messages: Array<{ content?: unknown }> | undefined): unknown[] {
  return messages?.map((message) => message.content) ?? []
}

async function ensureAssistantReady(page: Page) {
  const input = page.getByPlaceholder('描述想要完成的剪辑')
  if (!(await input.isVisible())) {
    const openButton = page.getByRole('button', { name: '打开剪辑助手' })
    if (await openButton.isVisible()) await openButton.click()
  }
  if (!(await input.isVisible())) {
    await page.getByRole('button', { name: '剪辑助手设置' }).click()
    await expect(page.getByRole('dialog', { name: '剪辑助手设置' })).toBeVisible()
    await page.keyboard.press('Escape')
  }
  await expect(input).toBeEnabled()
  return input
}

/**
 * AI-CHAT-P0-RESUME-CONTINUE
 * Mode: simulated. Owner: AI.
 * Covers history restore, continued context, visible automatic retry, and disk persistence.
 */
test('AI-CHAT-P0-RESUME-CONTINUE 恢复历史会话后可自动重试并继续交流', async ({ lunaApp }) => {
  const { page, runtimeErrors, workspaceDir } = lunaApp
  const chatMock = await startResumeChatMock()

  try {
    await page.getByRole('link', { name: '剪辑', exact: true }).click()
    await page.evaluate((baseUrl) => window.luna.aiEditingAssistant.saveConfig({
      baseUrl,
      model: 'freecut-resume-e2e',
      apiKey: 'e2e-placeholder-key',
    }), chatMock.baseUrl)
    await page.getByRole('link', { name: /^(创建第一个项目|新建项目)$/ }).click()
    await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()

    const input = await ensureAssistantReady(page)
    const send = page.getByRole('button', { name: '发送剪辑请求' })

    await input.fill(MESSAGE_A)
    await send.click()
    await expect(page.getByText(REPLY_A, { exact: true })).toBeVisible()

    await page.getByRole('button', { name: '新建会话' }).click()
    await expect(page.getByText(MESSAGE_A, { exact: true })).not.toBeVisible()
    await input.fill(MESSAGE_B)
    await send.click()
    await expect(page.getByText(REPLY_B, { exact: true })).toBeVisible()

    await page.getByRole('button', { name: '查看历史会话' }).click()
    const historyDialog = page.getByRole('dialog', { name: '历史会话' })
    await expect(historyDialog.getByRole('button').filter({ hasText: MESSAGE_A })).toBeVisible()
    await historyDialog.getByRole('button', { name: '恢复并继续' }).click()
    await expect(historyDialog).not.toBeVisible()
    await expect(page.getByText(MESSAGE_A, { exact: true })).toBeVisible()
    await expect(page.getByText(REPLY_A, { exact: true })).toBeVisible()
    await expect(page.getByText(MESSAGE_B, { exact: true })).not.toBeVisible()

    await input.fill(MESSAGE_C)
    await send.click()
    await expect.poll(() => chatMock.requests.length).toBe(4)
    expect(chatMock.requests[3]?.stream).toBe(true)
    await expect(page.getByText('正在整理剪辑思路（第 2/3 次）', { exact: true })).toBeVisible()
    await expect(page.getByLabel('剪辑助手实时输出')).toContainText('正在整理结尾衔接')

    const continuationRequest = chatMock.requests[3]
    const continuationContents = messageContents(continuationRequest?.messages)
    expect(continuationContents).toContain(MESSAGE_A)
    expect(continuationContents).toContain(REPLY_A)
    expect(continuationContents).toContain(MESSAGE_C)
    expect(continuationContents).not.toContain(MESSAGE_B)
    expect(continuationContents).not.toContain(REPLY_B)

    chatMock.releaseRetriedContinuation()
    await expect(page.getByText(REPLY_C, { exact: true })).toBeVisible()

    const projectDirectory = await findProjectDirectory(workspaceDir)
    await expect.poll(async () => {
      const current = JSON.parse(await readFile(
        path.join(projectDirectory, 'ai-editing-conversation.json'),
        'utf8',
      )) as ConversationFile
      return messageContents(current.messages)
    }).toEqual([MESSAGE_A, REPLY_A, MESSAGE_C, REPLY_C])

    const history = JSON.parse(await readFile(
      path.join(projectDirectory, 'ai-editing-conversation-history.json'),
      'utf8',
    )) as ConversationHistoryFile
    expect(history.version).toBe(1)
    expect(history.sessions).toHaveLength(1)
    expect(messageContents(history.sessions?.[0]?.messages)).toEqual([MESSAGE_B, REPLY_B])
    expect(runtimeErrors).toEqual([])
  } finally {
    chatMock.releaseRetriedContinuation()
    await chatMock.close()
  }
})
