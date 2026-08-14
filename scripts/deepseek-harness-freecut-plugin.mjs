// DeepSeek Harness plugin for the FreeCut project-source capability.
// The Harness owns the conversation, prompt assembly, agent loop, and UI.
// This plugin only registers typed tools and forwards their structured calls
// to the Electron host over a private loopback endpoint.

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
export const inject = ['tools']

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

export function apply(ctx, config) {
  if (!config || typeof config.endpoint !== 'string' || typeof config.token !== 'string' || typeof config.projectId !== 'string') {
    throw new Error('luna-freecut-project-source: endpoint, token and projectId are required')
  }
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
}
