import type { LlmAdapter, LlmMessage } from '@freecut/infrastructure/llm'
import { getDefaultLlmAdapter } from '@freecut/infrastructure/llm'
import {
  openAiChatCompletionsLlmAdapter,
  supportsNativeToolCalling,
  type NativeToolCallingLlmAdapter,
} from '@freecut/infrastructure/llm/openai-chat-completions-llm-adapter'
import { useProjectStore } from '@freecut/features/projects/stores/project-store'
import { useTimelineCommandStore } from '@freecut/features/timeline/stores/timeline-command-store'
import { useTimelineStore } from '@freecut/features/timeline/stores/timeline-store-facade'
import {
  getEmbeddedHostBridge,
  type EmbeddedAiAssistantMessage,
  type EmbeddedAiAssistantToolCall,
  type EmbeddedAiAssistantToolDefinition,
} from '@freecut/shared/host/embedded-host'
import { buildProjectEvidence } from './evidence'
import { parseAiEditingResponse } from './response-parser'
import { listAiEditingToolCatalog } from './tool-discovery'
import { getAiEditingTool, listAiEditingTools } from './tool-registry'
import type {
  AiEditingObservation,
  AiEditingToolActivity,
  AiEditingToolCall,
  AiEditingToolResult,
} from './types'

const MAX_TOOL_ROUNDS = 8
const MAX_TOKENS = 1_024
const MAX_TOOL_RESULT_CHARS = 8_000

function toolCatalog(): string {
  return listAiEditingTools()
    .map((tool) => `${tool.id} [${tool.risk}] ${tool.description}\n参数: ${JSON.stringify(tool.inputSchema)}`)
    .join('\n')
}

function toolNameCatalog(): string {
  return listAiEditingToolCatalog(listAiEditingTools())
    .map((tool) => `${tool.id} | ${tool.title}`)
    .join('\n')
}

function systemPrompt(evidence: unknown, protocol: 'native' | 'json'): string {
  const protocolInstructions = protocol === 'native'
    ? `8. 初始只开放基础函数。需要执行目录中的具体操作时，先调用“查看剪辑能力”并传入精确工具 ID；不确定 ID 时再调用“查找剪辑能力”。结果会在下一轮开放对应函数。
9. 工具接口已经提供时，必须调用对应函数，不能用文字或 JSON 模拟工具执行。全部完成后，直接用简短文字说明结果。`
    : `8. 每次只返回一个 JSON 对象，不要 Markdown，不要 JSON 前后的任何解释：
{"reply":"给用户的简短说明","toolCalls":[{"id":"工具 ID","args":{}}]}`
  const availableTools = protocol === 'native'
    ? `可扩展剪辑能力清单（仅工具 ID 和名称）：
${toolNameCatalog()}
`
    : `可用内部工具：
${toolCatalog()}
`
  return `你是本地视频剪辑助手。你只能依据提供的时间轴、字幕、画面描述和音频证据工作。
绝不能要求或假设能读取原始视频帧、音频文件、本地路径、账号信息或密钥。

${availableTools}

工作方式：
1. 你的工具调用会立刻在编辑器中执行；每一个工具结果和更新后的项目证据都会在下一轮发回给你。
2. 不需要等待用户确认。对所有剪辑、分析和设置请求直接执行，编辑器支持撤销。
3. 一轮只调用完成当前决策所需的 1 至 3 个工具。不要预先列出长计划；先观察每一步结果，再决定下一步。
4. 先用 read 工具补足信息。工具参数必须使用素材或片段的真实 ID，时间使用秒。
5. 对口播剪辑，优先引用字幕时间；对卡点剪辑，只有获得节拍证据后才能按节拍编辑。
6. 用户要求从素材库挑选并混剪时，只能使用已有画面描述的素材；没有画面描述则先调用 analysis.request。已有画面描述时，使用 timeline.compose_from_media 编排到时间轴末尾。
7. 所有需要的操作完成后再结束回复。只有纯问答才可以在第一轮直接结束。
${protocolInstructions}

当前项目的结构化证据：
${JSON.stringify(evidence)}`
}

interface NativeToolCatalog {
  definitions: EmbeddedAiAssistantToolDefinition[]
  idsByFunctionName: Map<string, string>
}

function nativeFunctionName(toolId: string): string {
  return `fc_${toolId.replaceAll('.', '_')}`
}

function createNativeToolCatalog(activeToolIds: ReadonlySet<string>): NativeToolCatalog {
  const idsByFunctionName = new Map<string, string>()
  const definitions = listAiEditingTools().filter((tool) => activeToolIds.has(tool.id)).map((tool) => {
    // Chat Completions function names cannot contain the dots used by editor tool IDs.
    const name = nativeFunctionName(tool.id)
    if (idsByFunctionName.has(name)) throw new Error('剪辑助手工具名称重复，无法继续。')
    idsByFunctionName.set(name, tool.id)
    return {
      name,
      description: `${tool.title}。${tool.description}`,
      parameters: tool.inputSchema,
    }
  })
  return { definitions, idsByFunctionName }
}

function toolError(toolId: string, message: string): AiEditingObservation {
  return { toolId, result: { ok: false, message } }
}

function serializeForModel(value: unknown): string {
  const text = JSON.stringify(value)
  return text.length > MAX_TOOL_RESULT_CHARS ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}…` : text
}

async function yieldForUi(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function saveTimelineAfterEdit(): Promise<void> {
  const timeline = useTimelineStore.getState()
  if (!timeline.isDirty) return
  const projectId = useProjectStore.getState().currentProject?.id
  if (!projectId) throw new Error('当前项目不可用，无法保存剪辑结果。')
  await timeline.saveTimeline(projectId)
}

export interface AiEditingRunResult {
  reply: string
  observations: AiEditingObservation[]
}

export interface AiEditingRunOptions {
  history: LlmMessage[]
  signal?: AbortSignal
  onToken?: (delta: string, fullText: string) => void
  onToolActivity?: (activity: AiEditingToolActivity) => void
  adapter?: LlmAdapter
}

export function getAiEditingAdapter(): LlmAdapter {
  if (getEmbeddedHostBridge().aiAssistant) return openAiChatCompletionsLlmAdapter
  return getDefaultLlmAdapter()
}

async function executeToolCall(
  call: AiEditingToolCall,
  callIndex: number,
  options: AiEditingRunOptions,
): Promise<AiEditingObservation> {
  const tool = getAiEditingTool(call.id)
  if (!tool) return toolError(call.id, '这个操作目前不可用。')

  const validation = tool.validate(call.args)
  if (!validation.ok) return toolError(tool.id, validation.error)

  const activityId = `${callIndex}-${tool.id}`
  options.onToolActivity?.({ id: activityId, toolId: tool.id, title: tool.title, status: 'running' })
  await yieldForUi()

  let result: AiEditingToolResult
  try {
    if (tool.risk === 'edit' && tool.execution === 'sync') {
      result = useTimelineCommandStore.getState().executeTransaction(
        { type: 'AI_EDITING_TOOL', payload: { toolId: tool.id } },
        () => {
          const execution = tool.execute(validation.value)
          if (execution instanceof Promise) throw new Error('剪辑操作未能及时完成。')
          return execution
        },
      )
    } else {
      result = await tool.execute(validation.value)
    }
    if (result.ok && tool.risk === 'edit') await saveTimelineAfterEdit()
  } catch (error) {
    result = { ok: false, message: error instanceof Error ? error.message : '操作未能完成。' }
  }

  options.onToolActivity?.({
    id: activityId,
    toolId: tool.id,
    title: tool.title,
    status: result.ok ? 'succeeded' : 'failed',
    message: result.message,
  })
  return { toolId: tool.id, result }
}

function defaultReply(observations: AiEditingObservation[]): string {
  return observations.length > 0 ? '已完成本次剪辑操作。' : '已完成分析。'
}

function toNativeMessages(messages: LlmMessage[]): EmbeddedAiAssistantMessage[] {
  return messages.map((message) => ({ role: message.role, content: message.content }))
}

function parseNativeArguments(argumentsText: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(argumentsText) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

async function executeNativeToolCall(
  call: EmbeddedAiAssistantToolCall,
  toolIdsByFunctionName: Map<string, string>,
  callIndex: number,
  options: AiEditingRunOptions,
): Promise<AiEditingObservation> {
  const toolId = toolIdsByFunctionName.get(call.name)
  if (!toolId) return toolError(call.name, '这个操作目前不可用。')
  const args = parseNativeArguments(call.arguments)
  if (!args) return toolError(toolId, '操作参数无效，未执行此操作。')
  return executeToolCall({ id: toolId, args }, callIndex, options)
}

function discoveredToolIds(observation: AiEditingObservation): string[] {
  if ((observation.toolId !== 'tool.describe' && observation.toolId !== 'tool.search') || !observation.result.ok) return []
  const data = observation.result.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return []
  const matches = (data as { tools?: unknown }).tools
  if (!Array.isArray(matches)) return []
  return matches.flatMap((match) => {
    if (!match || typeof match !== 'object' || Array.isArray(match)) return []
    const id = (match as { id?: unknown }).id
    return typeof id === 'string' ? [id] : []
  })
}

function buildInitialMessages(
  userText: string,
  history: LlmMessage[],
  evidence: unknown,
  protocol: 'native' | 'json',
): LlmMessage[] {
  return [
    { role: 'system', content: systemPrompt(evidence, protocol) },
    ...history.slice(-6),
    { role: 'user', content: userText },
  ]
}

async function buildJsonFallbackMessages(
  userText: string,
  history: LlmMessage[],
  observations: AiEditingObservation[],
): Promise<LlmMessage[]> {
  const messages = buildInitialMessages(userText, history, await buildProjectEvidence(), 'json')
  if (observations.length > 0) {
    messages.push({
      role: 'user',
      content: `本次已执行的操作结果：${serializeForModel(observations)}。请在此基础上继续完成原始请求。`,
    })
  }
  return messages
}

async function runJsonToolLoop(
  messages: LlmMessage[],
  options: AiEditingRunOptions,
  adapter: LlmAdapter,
  initialRaw?: string,
): Promise<AiEditingRunResult> {
  const observations: AiEditingObservation[] = []
  let reply = ''
  let callIndex = 0
  let rawFromPreviousRequest = initialRaw

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const raw = rawFromPreviousRequest ?? await adapter.generate(messages, {
      maxTokens: MAX_TOKENS,
      temperature: 0,
      signal: options.signal,
      onToken: options.onToken,
    })
    rawFromPreviousRequest = undefined
    const parsed = parseAiEditingResponse(raw)
    if (!parsed) {
      if (round === MAX_TOOL_ROUNDS - 1) {
        throw new Error('助手这次没有按约定返回剪辑操作，已自动重试多次。请再试一次。')
      }
      messages.push({ role: 'assistant', content: raw })
      messages.push({
        role: 'user',
        content: '刚才的回复无法解析。请只返回一个 JSON 对象，不要任何解释；必须包含字符串 reply 和数组 toolCalls。',
      })
      continue
    }

    reply = parsed.reply || reply
    if (parsed.toolCalls.length === 0) break

    const roundObservations: AiEditingObservation[] = []
    for (const call of parsed.toolCalls.slice(0, 3)) {
      if (options.signal?.aborted) break
      const observation = await executeToolCall(call, callIndex, options)
      callIndex += 1
      roundObservations.push(observation)
      observations.push(observation)
    }
    if (options.signal?.aborted) break

    messages.push({ role: 'assistant', content: raw })
    messages.push({
      role: 'user',
      content: `工具结果：${serializeForModel(roundObservations)}。\n最新项目证据：${serializeForModel(await buildProjectEvidence())}\n继续完成用户请求；若已完成，返回 toolCalls: []。`,
    })
  }

  return { reply: reply || defaultReply(observations), observations }
}

async function runNativeToolLoop(
  messages: EmbeddedAiAssistantMessage[],
  userText: string,
  options: AiEditingRunOptions,
  adapter: NativeToolCallingLlmAdapter,
): Promise<AiEditingRunResult> {
  const allTools = listAiEditingTools()
  const knownToolIds = new Set(allTools.map((tool) => tool.id))
  const activeToolIds = new Set([
    'project.inspect',
    'tool.describe',
    'tool.search',
    'analysis.request',
  ])
  const observations: AiEditingObservation[] = []
  let reply = ''
  let callIndex = 0

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const catalog = createNativeToolCatalog(activeToolIds)
    const response = await adapter.generateWithTools(messages, catalog.definitions, {
      maxTokens: MAX_TOKENS,
      temperature: 0,
      signal: options.signal,
    })
    if (response.mode === 'fallback') {
      return runJsonToolLoop(
        await buildJsonFallbackMessages(userText, options.history, observations),
        options,
        adapter,
      )
    }
    if (response.mode === 'json') {
      return runJsonToolLoop(
        await buildJsonFallbackMessages(userText, options.history, observations),
        options,
        adapter,
        response.content,
      )
    }

    if (response.content) reply = response.content
    if (response.toolCalls.length === 0) {
      if (response.content) options.onToken?.(response.content, response.content)
      break
    }

    const roundObservations: Array<{ call: EmbeddedAiAssistantToolCall; observation: AiEditingObservation }> = []
    for (const call of response.toolCalls) {
      if (options.signal?.aborted) break
      const observation = await executeNativeToolCall(call, catalog.idsByFunctionName, callIndex, options)
      callIndex += 1
      observations.push(observation)
      roundObservations.push({ call, observation })
    }
    if (options.signal?.aborted) break

    for (const { observation } of roundObservations) {
      for (const toolId of discoveredToolIds(observation)) {
        if (knownToolIds.has(toolId)) activeToolIds.add(toolId)
      }
    }

    messages.push({
      role: 'assistant',
      ...(response.content ? { content: response.content } : {}),
      toolCalls: response.toolCalls,
    })
    for (const { call, observation } of roundObservations) {
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        content: serializeForModel(observation),
      })
    }
    messages.push({
      role: 'user',
      content: `最新项目证据：${serializeForModel(await buildProjectEvidence())}\n继续完成用户请求；若已完成，请直接说明完成内容。`,
    })
  }

  return { reply: reply || defaultReply(observations), observations }
}

export async function runAiEditingTurn(
  userText: string,
  options: AiEditingRunOptions,
): Promise<AiEditingRunResult> {
  const adapter = options.adapter ?? getAiEditingAdapter()
  const evidence = await buildProjectEvidence()
  if (supportsNativeToolCalling(adapter)) {
    return runNativeToolLoop(
      toNativeMessages(buildInitialMessages(userText, options.history, evidence, 'native')),
      userText,
      options,
      adapter,
    )
  }
  return runJsonToolLoop(
    buildInitialMessages(userText, options.history, evidence, 'json'),
    options,
    adapter,
  )
}
