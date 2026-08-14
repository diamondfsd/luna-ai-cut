// DeepSeek Harness plugin for the FreeCut project-source capability.
// The Harness owns the conversation, prompt assembly, agent loop, and UI.
// This plugin only registers typed tools and forwards their structured calls
// to the Electron host over a private loopback endpoint. The WebUI receives a
// small host marker so its embedded-mode source changes stay scoped to FreeCut.

import { randomUUID } from 'node:crypto'

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    message: { type: 'string' },
    data: {},
  },
  required: ['ok', 'message'],
  additionalProperties: true,
}

const sourceTools = [
  {
    name: 'source.tree',
    description: '列出当前剪辑工程中的源码文件和根目录 AGENTS.md，用于定位序列、轨道和片段数据。',
    parameters: {
      type: 'object',
      properties: { prefix: { type: 'string', description: '可选的目录前缀。' } },
      additionalProperties: false,
    },
  },
  {
    name: 'source.read',
    description: '读取当前剪辑工程中的一个 JSON 源码文件或根目录 AGENTS.md，返回带行号的有限范围内容。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        startLine: { type: 'integer', minimum: 1 },
        endLine: { type: 'integer', minimum: 1 },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'source.search',
    description: '在当前剪辑工程的源码文件和 AGENTS.md 中搜索指定文本，返回文件和行号。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        prefix: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'source.apply_changes',
    description: '按期望内容原子地修改当前剪辑工程源码，并在成功后重新加载时间轴。',
    parameters: {
      type: 'object',
      properties: {
        changes: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { oneOf: [{ type: 'string' }, { type: 'null' }] },
              expectedContent: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            },
            required: ['path', 'content', 'expectedContent'],
            additionalProperties: false,
          },
        },
      },
      required: ['changes'],
      additionalProperties: false,
    },
  },
  {
    name: 'source.check',
    description: '解析并校验当前剪辑工程源码，确认时间轴结构完整。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'source.diff',
    description: '查看当前剪辑工程源码工作树中的文件级修改。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
]

export const name = 'luna-freecut-project-source'
export const inject = ['tools', 'workspaceRegistry', 'agents', 'agentPresets', 'webServer']

function abortableSignal(signal) {
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  if (signal.aborted) abort()
  else signal.addEventListener('abort', abort, { once: true })
  return { controller, dispose: () => signal.removeEventListener('abort', abort) }
}

async function executeSourceTool(config, name, args, signal) {
  const { controller, dispose } = abortableSignal(signal)
  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ projectId: config.projectId, name, args }),
      signal: controller.signal,
    })
    const payload = await response.json()
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || `源码工具返回了 ${response.status}。`)
    return payload.result
  } finally {
    dispose()
  }
}

function validateConfig(config) {
  if (!config || typeof config.endpoint !== 'string' || typeof config.token !== 'string' || typeof config.projectId !== 'string'
    || typeof config.cwd !== 'string' || typeof config.model !== 'string') {
    throw new Error('luna-freecut-project-source: endpoint, token, projectId, cwd and model are required')
  }
}

function escapeAttribute(value) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function markEmbeddedUi(html, cwd) {
  if (html.includes('data-luna-freecut')) return html
  return html.replace(/<html\b/i, `<html data-luna-freecut data-luna-freecut-cwd="${escapeAttribute(cwd)}"`)
}

async function initializeProjectWorkspace(ctx, config) {
  let workspace = await ctx.workspaceRegistry.resolveByPath(config.cwd)
  if (workspace === undefined) workspace = await ctx.workspaceRegistry.create(config.cwd)

  // A workspace with any persisted session is already usable: the client can
  // resume it, and its normal connect flow creates a blank session when needed.
  // Only the first run needs a host-owned blank session to make the workspace
  // immediately selectable by the WebUI's startup policy.
  if (workspace.sessionIds.length > 0) return undefined

  const handle = await ctx.agents.create({
    sessionId: randomUUID(),
    agentOptions: { provider: 'deepseek-official', model: config.model },
    meta: { cwd: workspace.path, agentPreset: 'luna-freecut' },
    setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'luna-freecut').then(() => undefined),
  })
  try {
    await workspace.attachSession(handle.agent.id)
    return handle
  } catch (error) {
    await handle.dispose()
    throw error
  }
}

export async function apply(ctx, config) {
  validateConfig(config)
  for (const definition of sourceTools) {
    ctx.tools.register({
      ...definition,
      output: {
        schema: RESULT_SCHEMA,
        render(_args, value) {
          return [{ type: 'text', text: typeof value?.message === 'string' ? value.message : JSON.stringify(value) ?? String(value) }]
        },
      },
      timeoutMs: definition.name === 'source.apply_changes' ? 120_000 : 30_000,
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const result = await executeSourceTool(config, definition.name, args, exec.signal)
        exec.signal.throwIfAborted()
        return result
      },
    })
  }

  await ctx.effect(async () => {
    const untapIndex = ctx.webServer.tapIndex(html => markEmbeddedUi(html, config.cwd))
    let handle
    try {
      handle = await initializeProjectWorkspace(ctx, config)
    } catch (error) {
      // The UI can still open its workspace picker when startup initialization
      // fails; retain the diagnostic without taking down the Web server.
      ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
    }
    return async () => {
      untapIndex()
      if (handle !== undefined) await handle.dispose()
    }
  }, 'luna-freecut: WebUI adaptation')
}
