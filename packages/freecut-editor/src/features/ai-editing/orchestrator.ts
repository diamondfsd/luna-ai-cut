import type { LlmAdapter, LlmMessage } from '@freecut/infrastructure/llm'
import { getDefaultLlmAdapter } from '@freecut/infrastructure/llm'
import { openAiChatCompletionsLlmAdapter } from '@freecut/infrastructure/llm/openai-chat-completions-llm-adapter'
import { useProjectStore } from '@freecut/features/projects/stores/project-store'
import { useTimelineCommandStore } from '@freecut/features/timeline/stores/timeline-command-store'
import { useTimelineStore } from '@freecut/features/timeline/stores/timeline-store-facade'
import { getEmbeddedHostBridge } from '@freecut/shared/host/embedded-host'
import { buildProjectEvidence } from './evidence'
import { parseAiEditingResponse } from './response-parser'
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

function systemPrompt(evidence: unknown): string {
  return `你是本地视频剪辑助手。你只能依据提供的时间轴、字幕、画面描述和音频证据工作。
绝不能要求或假设能读取原始视频帧、音频文件、本地路径、账号信息或密钥。

可用内部工具：
${toolCatalog()}

工作方式：
1. 你的 toolCalls 会立刻在编辑器中执行；每一个工具结果和更新后的项目证据都会在下一轮发回给你。
2. 不需要等待用户确认。对所有剪辑、分析和设置请求直接执行，编辑器支持撤销。
3. 一轮只调用完成当前决策所需的 1 至 3 个工具。不要预先列出长计划；先观察每一步结果，再决定下一步。
4. 先用 read 工具补足信息。工具参数必须使用素材或片段的真实 ID，时间使用秒。
5. 对口播剪辑，优先引用字幕时间；对卡点剪辑，只有获得节拍证据后才能按节拍编辑。
6. 用户要求从素材库挑选并混剪时，只能使用已有画面描述的素材；没有画面描述则先调用 analysis.request。已有画面描述时，使用 timeline.compose_from_media 编排到时间轴末尾。
7. 所有需要的操作完成后，返回 toolCalls: [] 并在 reply 中简短说明完成内容。只有纯问答才可以在第一轮返回空数组。
8. 每次只返回一个 JSON 对象，不要 Markdown，不要 JSON 前后的任何解释：
{"reply":"给用户的简短说明","toolCalls":[{"id":"工具 ID","args":{}}]}

当前项目的结构化证据：
${JSON.stringify(evidence)}`
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

export async function runAiEditingTurn(
  userText: string,
  options: AiEditingRunOptions,
): Promise<AiEditingRunResult> {
  const adapter = options.adapter ?? getAiEditingAdapter()
  const evidence = await buildProjectEvidence()
  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt(evidence) },
    ...options.history.slice(-6),
    { role: 'user', content: userText },
  ]
  const observations: AiEditingObservation[] = []
  let reply = ''
  let callIndex = 0

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const raw = await adapter.generate(messages, {
      maxTokens: MAX_TOKENS,
      temperature: 0,
      signal: options.signal,
      onToken: options.onToken,
    })
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

  return { reply: reply || (observations.length > 0 ? '已完成本次剪辑操作。' : '已完成分析。'), observations }
}
