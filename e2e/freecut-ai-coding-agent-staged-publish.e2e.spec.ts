import { createServer, type Server } from 'node:http'
import * as nodeFs from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from '@playwright/test'
import git from 'isomorphic-git'

import { expect, test } from './fixtures/lunaElectron'
import { sendTextCompletion, sendToolCallCompletion } from './support/chatCompletionsStream'

const USER_MESSAGE = '分两个阶段制作标题：先发布片头，再继续发布结尾。'
const FIRST_TITLE = '第一阶段片头'
const SECOND_TITLE = '第二阶段结尾'
const FINAL_REPLY = '剪辑工程已构建并发布到时间轴。'

interface ChatRequest {
  tools?: Array<{ function?: { name?: string } }>
  messages?: Array<{ role?: string; content?: string }>
}

interface StoredRun {
  completed: boolean
  status?: string
  timelineRevisionBefore: number
  timelineRevisionAfter: number
  toolCalls: Array<{ id: string; ok: boolean }>
  events?: Array<{
    type?: string
    data?: {
      toolId?: string
      result?: {
        ok?: boolean
        data?: {
          commitId?: string
          revisionBefore?: number
          revisionAfter?: number
        }
      }
    }
  }>
}

interface StoredProject {
  timeline: { items: unknown[] }
  aiEditingPublication?: {
    sourceCommitId?: string
    revisionBefore?: number
    revisionAfter?: number
  }
}

const firstStageSource = `${JSON.stringify({
  version: 1,
  operations: [{
    type: 'insertText',
    text: {
      ref: 'stage-one-title',
      text: FIRST_TITLE,
      start: 0,
      duration: 2,
      role: 'title',
    },
  }],
}, null, 2)}\n`

const secondStageSource = `${JSON.stringify({
  version: 1,
  operations: [
    {
      type: 'insertText',
      text: {
        ref: 'stage-one-title',
        text: FIRST_TITLE,
        start: 0,
        duration: 2,
        role: 'title',
      },
    },
    {
      type: 'insertText',
      text: {
        ref: 'stage-two-title',
        text: SECOND_TITLE,
        start: 2,
        duration: 2,
        role: 'title',
      },
    },
  ],
}, null, 2)}\n`

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

function toolName(payload: ChatRequest, toolId: string): string {
  const expected = `fc_${toolId.replaceAll('.', '_')}`
  const tool = payload.tools?.find((candidate) => candidate.function?.name === expected)
  if (!tool?.function?.name) throw new Error(`Missing tool ${toolId}`)
  return tool.function.name
}

function latestSourceCommitId(payload: ChatRequest): string {
  const commitIds = payload.messages
    ?.filter((message) => message.role === 'tool' && typeof message.content === 'string')
    .flatMap((message) => message.content?.match(/[0-9a-f]{40}/g) ?? []) ?? []
  const commitId = commitIds.at(-1)
  if (!commitId) throw new Error('Git commit id is missing from tool history')
  return commitId
}

function toolCall(
  response: Parameters<typeof sendToolCallCompletion>[0],
  payload: ChatRequest,
  index: number,
  toolId: string,
  args: Record<string, unknown>,
): void {
  sendToolCallCompletion(response, {
    id: `call_staged_${index}_${toolId.replaceAll('.', '_')}`,
    name: toolName(payload, toolId),
    arguments: JSON.stringify(args),
  })
}

async function startStagedPublishMock(): Promise<{
  baseUrl: string
  requests: ChatRequest[]
  waitForSecondStageRequest(): Promise<void>
  releaseSecondStage(): void
  close(): Promise<void>
}> {
  const requests: ChatRequest[] = []
  let releaseSecondStage: (() => void) | undefined
  let notifySecondStageRequest: (() => void) | undefined
  const secondStageGate = new Promise<void>((resolve) => {
    releaseSecondStage = resolve
  })
  const secondStageRequested = new Promise<void>((resolve) => {
    notifySecondStageRequest = resolve
  })

  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    const payload = await readRequestBody(request)
    requests.push(payload)
    const index = requests.length - 1

    if (index === 7) {
      notifySecondStageRequest?.()
      await secondStageGate
    }

    const firstStageCalls: Array<[string, Record<string, unknown>]> = [
      ['workspace.patch', {
        operations: [{ op: 'write', path: 'segments/main.segment.json', content: firstStageSource }],
      }],
      ['timeline.check', {}],
      ['timeline.build', {}],
      ['timeline.test', {}],
      ['timeline.diff', {}],
      ['git.commit', { message: 'Stage 1: publish opening title' }],
    ]
    const secondStageCalls: Array<[string, Record<string, unknown>]> = [
      ['workspace.patch', {
        operations: [{ op: 'write', path: 'segments/main.segment.json', content: secondStageSource }],
      }],
      ['timeline.check', {}],
      ['timeline.build', {}],
      ['timeline.test', {}],
      ['timeline.diff', {}],
      ['git.commit', { message: 'Stage 2: publish ending title' }],
    ]

    if (index < firstStageCalls.length) {
      const [id, args] = firstStageCalls[index]!
      toolCall(response, payload, index, id, args)
      return
    }
    if (index === 6) {
      toolCall(response, payload, index, 'timeline.publish_stage', {
        commitId: latestSourceCommitId(payload),
      })
      return
    }
    if (index >= 7 && index < 7 + secondStageCalls.length) {
      const [id, args] = secondStageCalls[index - 7]!
      toolCall(response, payload, index, id, args)
      return
    }
    if (index === 13) {
      toolCall(response, payload, index, 'timeline.commit', {
        commitId: latestSourceCommitId(payload),
      })
      return
    }
    sendTextCompletion(response, FINAL_REPLY)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    await closeServer(server)
    throw new Error('Unable to start staged publish model')
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    waitForSecondStageRequest: () => secondStageRequested,
    releaseSecondStage: () => releaseSecondStage?.(),
    close: () => closeServer(server),
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

async function findProjectDirectory(userDataDir: string): Promise<string> {
  const root = path.join(userDataDir, 'freecut-workspace', 'projects')
  const entries = await readdir(root, { withFileTypes: true })
  const project = entries.find((entry) => entry.isDirectory())
  if (!project) throw new Error('E2E project directory was not created')
  return path.join(root, project.name)
}

async function readRuns(projectDirectory: string): Promise<StoredRun[]> {
  const stored = JSON.parse(
    await readFile(path.join(projectDirectory, 'ai-editing-runs.json'), 'utf8'),
  ) as { runs?: StoredRun[] }
  return stored.runs ?? []
}

test(
  '同一 AI run 分阶段发布两次并保持 Git 与时间轴连续',
  async ({ lunaApp }) => {
    test.setTimeout(180_000)
    const { page, runtimeErrors, userDataDir } = lunaApp
    const mock = await startStagedPublishMock()
    try {
      await page.getByRole('link', { name: '剪辑', exact: true }).click()
      await page.evaluate((baseUrl) => window.luna.aiEditingAssistant.saveConfig({
        baseUrl,
        model: 'freecut-staged-publish-e2e',
        apiKey: 'e2e-placeholder-key',
      }), mock.baseUrl)
      await page.getByRole('link', { name: /^(创建第一个项目|新建项目)$/ }).click()
      await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()

      const input = await ensureAssistantReady(page)
      await input.fill(USER_MESSAGE)
      await page.getByRole('button', { name: '发送剪辑请求' }).click()

      await mock.waitForSecondStageRequest()
      const projectDirectory = await findProjectDirectory(userDataDir)
      const firstPublication = JSON.parse(
        await readFile(path.join(projectDirectory, 'project.json'), 'utf8'),
      ) as StoredProject
      await expect(page.locator('[data-timeline-item]').filter({ hasText: FIRST_TITLE }))
        .toHaveCount(1)
      await expect(input).toBeDisabled()
      await expect.poll(async () => (await readRuns(projectDirectory)).at(-1))
        .toMatchObject({ completed: false, status: 'running' })
      expect(firstPublication.aiEditingPublication?.revisionAfter)
        .toBeGreaterThan(firstPublication.aiEditingPublication?.revisionBefore ?? 0)

      mock.releaseSecondStage()
      await expect(page.getByText(FINAL_REPLY, { exact: true })).toBeVisible()
      await expect(input).toBeEnabled()
      await expect(page.locator('[data-timeline-item]').filter({ hasText: FIRST_TITLE }))
        .toHaveCount(1)
      await expect(page.locator('[data-timeline-item]').filter({ hasText: SECOND_TITLE }))
        .toHaveCount(1)

      const run = (await readRuns(projectDirectory)).at(-1)!
      expect(run).toMatchObject({ completed: true, status: 'completed' })
      expect(run.toolCalls.filter((call) => call.id === 'timeline.publish_stage' && call.ok))
        .toHaveLength(1)
      expect(run.toolCalls.filter((call) => call.id === 'timeline.commit' && call.ok))
        .toHaveLength(1)
      const publications = run.events?.filter((event) => (
        event.type === 'tool-result'
        && (
          event.data?.toolId === 'timeline.publish_stage'
          || event.data?.toolId === 'timeline.commit'
        )
        && event.data.result?.ok
      )).map((event) => event.data!.result!.data!) ?? []
      expect(publications).toHaveLength(2)
      expect(publications[0]!.revisionAfter).toBeGreaterThan(publications[0]!.revisionBefore!)
      expect(publications[1]!.revisionBefore).toBe(publications[0]!.revisionAfter)
      expect(publications[1]!.revisionAfter).toBeGreaterThan(publications[1]!.revisionBefore!)
      expect(run.timelineRevisionAfter).toBe(publications[1]!.revisionAfter)

      const sourceDirectory = path.join(projectDirectory, 'editing-source')
      const sourceLog = await git.log({ fs: nodeFs, dir: sourceDirectory, depth: 10 })
      expect(sourceLog.map((entry) => entry.commit.message.trim())).toEqual([
        'Stage 2: publish ending title',
        'Stage 1: publish opening title',
        'Initialize editing source',
      ])
      expect(sourceLog[0]!.commit.parent[0]).toBe(sourceLog[1]!.oid)
      expect(sourceLog[1]!.commit.parent[0]).toBe(sourceLog[2]!.oid)
      expect(sourceLog.filter((entry) => entry.commit.message.includes('Initialize editing source')))
        .toHaveLength(1)

      const finalProject = JSON.parse(
        await readFile(path.join(projectDirectory, 'project.json'), 'utf8'),
      ) as StoredProject
      expect(finalProject.timeline.items).toHaveLength(2)
      expect(firstPublication.aiEditingPublication?.sourceCommitId).toBe(publications[0]!.commitId)
      expect(finalProject.aiEditingPublication?.sourceCommitId).toBe(publications[1]!.commitId)
      expect(finalProject.aiEditingPublication?.revisionAfter).toBe(publications[1]!.revisionAfter)
      expect(runtimeErrors).toEqual([])
    } finally {
      mock.releaseSecondStage()
      await mock.close()
    }
  },
)
