import { createServer, type Server } from 'node:http'

import { expect, test } from './fixtures/lunaElectron'
import { sendTextCompletion } from './support/chatCompletionsStream'

interface ChatRequest {
  model?: string
  tools?: unknown[]
  tool_choice?: unknown
  stream?: boolean
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

async function startCapabilityMock() {
  const connectionRequests: ChatRequest[] = []
  const capabilityRequests: ChatRequest[] = []
  const editingRequests: ChatRequest[] = []
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    const payload = await readRequestBody(request)
    if (payload.tool_choice) {
      capabilityRequests.push(payload)
      const message = payload.model === 'native-supported'
        ? {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'capability-probe',
              type: 'function',
              function: { name: 'luna_capability_probe', arguments: '{}' },
            }],
          }
        : { role: 'assistant', content: 'Tool calling is unavailable.' }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        id: 'capability-result',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1_000),
        model: payload.model,
        choices: [{ index: 0, finish_reason: 'stop', message }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }))
      return
    }
    if (payload.stream !== true) {
      connectionRequests.push(payload)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        id: 'connection-result',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1_000),
        model: payload.model,
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'OK' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }))
      return
    }
    editingRequests.push(payload)
    sendTextCompletion(response, JSON.stringify({ reply: '兼容模式已响应', toolCalls: [] }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Capability mock did not start')
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    connectionRequests,
    capabilityRequests,
    editingRequests,
    close: () => closeServer(server),
  }
}

test('原生工具调用测试自动更新开关并控制首轮协议', async ({ lunaApp }) => {
  const { page, runtimeErrors } = lunaApp
  const mock = await startCapabilityMock()
  try {
    await page.getByRole('link', { name: '剪辑', exact: true }).click()
    await page.getByRole('link', { name: /^(创建第一个项目|新建项目)$/ }).click()
    await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()
    await page.getByRole('button', { name: '剪辑助手设置' }).click()

    const dialog = page.getByRole('dialog', { name: '剪辑助手设置' })
    const nativeSwitch = dialog.getByRole('switch', { name: '原生工具调用' })
    await expect(nativeSwitch).not.toBeChecked()
    await dialog.getByLabel('服务地址').fill(mock.baseUrl)
    await dialog.getByLabel('API Key').fill('e2e-placeholder-key')

    await dialog.getByLabel('模型', { exact: true }).fill('native-supported')
    await dialog.getByRole('button', { name: '测试连接' }).click()
    await expect(nativeSwitch).toBeChecked()
    await expect(dialog.getByText('连接成功，已开启原生工具调用。')).toBeVisible()

    await dialog.getByLabel('模型', { exact: true }).fill('native-unsupported')
    await dialog.getByRole('button', { name: '测试连接' }).click()
    await expect(nativeSwitch).not.toBeChecked()
    await expect(dialog.getByText('连接成功，当前模型将使用兼容模式。')).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.luna.aiEditingAssistant.getConfig()))
      .toMatchObject({ model: 'native-unsupported', nativeToolCalling: false })
    await page.keyboard.press('Escape')

    const assistant = page.getByRole('complementary', { name: '剪辑助手' })
    await expect(assistant).toBeVisible()
    const input = assistant.getByRole('textbox')
    await input.fill('请检查当前项目')
    await page.getByRole('button', { name: '发送剪辑请求' }).click()
    await expect(assistant.getByText('兼容模式已响应', { exact: true })).toBeVisible()

    expect(mock.editingRequests).toHaveLength(1)
    expect(mock.connectionRequests).toHaveLength(2)
    expect(mock.capabilityRequests).toHaveLength(2)
    expect(mock.editingRequests[0]?.tools).toBeUndefined()
    expect(runtimeErrors).toEqual([])
  } finally {
    await mock.close()
  }
})
