import { createServer, type Server } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from '@playwright/test'

import { expect, test } from './fixtures/lunaElectron'
import { sendTextCompletion, sendToolCallCompletion } from './support/chatCompletionsStream'

const USER_MESSAGE = '请整体制作一个完整成片，按镜头分步骤完成'

interface ChatRequest {
  tools?: Array<{ function?: { name?: string; description?: string } }>
  messages?: Array<{ role?: string; content?: string; tool_calls?: unknown }>
}

async function readRequestBody(request: AsyncIterable<Uint8Array>): Promise<ChatRequest> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as ChatRequest
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

async function startTaskModeMock() {
  const requests: ChatRequest[] = []
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    const payload = await readRequestBody(request)
    requests.push(payload)
    const index = requests.length - 1
    if (index === 0) {
      sendTextCompletion(response, JSON.stringify({ tasks: [
        { title: '制作片头', instruction: '添加一个三秒片头标题', kind: 'edit', range: { start: 0, end: 3 } },
        { title: '检查结果', instruction: '检查片头是否已经完成', kind: 'review', range: { start: 0, end: 3 } },
      ] }))
      return
    }
    if (index === 1) {
      const editTool = payload.tools?.find((tool) => tool.function?.description?.includes('声明式编辑程序'))
      if (!editTool?.function?.name) throw new Error('Missing edit program tool')
      sendToolCallCompletion(response, {
        id: 'call_task_1_title',
        name: editTool.function.name,
        arguments: JSON.stringify({ program: {
          version: 1,
          baseRevision: 0,
          intent: '制作片头',
          operations: [{
            type: 'insertText',
            text: { ref: 'task-title', text: '精彩时刻', start: 0, duration: 3, role: 'title' },
          }],
        } }),
      })
      return
    }
    sendTextCompletion(response, index === 2 ? '片头标题已经完成。' : '已检查片头，结果正常。')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Task mock did not start')
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, requests, close: () => closeServer(server) }
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

async function findProjectDirectory(workspaceDir: string): Promise<string> {
  const root = path.join(workspaceDir, 'projects')
  const entries = await readdir(root, { withFileTypes: true })
  const project = entries.find((entry) => entry.isDirectory())
  if (!project) throw new Error('E2E project directory was not created')
  return path.join(root, project.name)
}

/** AI-TASK-P0-SEQUENTIAL: simulated, AI-owned. */
test('AI-TASK-P0-SEQUENTIAL 复杂剪辑按独立任务逐项完成', async ({ lunaApp }) => {
  const { page, runtimeErrors, workspaceDir } = lunaApp
  const mock = await startTaskModeMock()
  try {
    await page.getByRole('link', { name: '剪辑', exact: true }).click()
    await page.evaluate((baseUrl) => window.luna.aiEditingAssistant.saveConfig({
      baseUrl, model: 'freecut-task-e2e', apiKey: 'e2e-placeholder-key',
      nativeToolCalling: true,
    }), mock.baseUrl)
    await page.getByRole('link', { name: /^(创建第一个项目|新建项目)$/ }).click()
    await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()

    const input = await ensureAssistantReady(page)
    await input.fill(USER_MESSAGE)
    await page.getByRole('button', { name: '发送剪辑请求' }).click()

    const tasks = page.getByRole('region', { name: '剪辑任务进度' })
    await expect(tasks).toContainText('制作片头')
    await expect(tasks).toContainText('检查结果')
    await expect(page.getByText('已检查片头，结果正常。', { exact: true }).last()).toBeVisible()
    await expect(page.locator('[data-timeline-item]')).toHaveCount(1)
    expect(mock.requests).toHaveLength(4)

    const secondWorkerMessages = mock.requests[3]?.messages ?? []
    expect(secondWorkerMessages.map((message) => message.role)).toEqual(['system', 'user'])
    expect(JSON.stringify(secondWorkerMessages)).not.toContain('call_task_1_title')
    expect(JSON.stringify(secondWorkerMessages)).not.toContain('tool_calls')
    expect(secondWorkerMessages[1]?.content).toContain('片头标题已经完成')

    const projectDirectory = await findProjectDirectory(workspaceDir)
    await expect.poll(async () => {
      const runs = JSON.parse(await readFile(path.join(projectDirectory, 'ai-editing-runs.json'), 'utf8')) as {
        runs?: Array<{ plan?: string[]; completed?: boolean }>
      }
      return runs.runs?.at(-1)
    }).toMatchObject({ plan: ['制作片头', '检查结果'], completed: true })
    expect(runtimeErrors).toEqual([])
  } finally {
    await mock.close()
  }
})
