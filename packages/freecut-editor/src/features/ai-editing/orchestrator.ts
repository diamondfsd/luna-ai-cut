import type { LlmAdapter, LlmMessage } from '@freecut/infrastructure/llm'
import { getDefaultLlmAdapter } from '@freecut/infrastructure/llm'
import { openAiResponsesLlmAdapter } from '@freecut/infrastructure/llm/openai-responses-llm-adapter'
import { useTimelineCommandStore } from '@freecut/features/timeline/stores/timeline-command-store'
import { getEmbeddedHostBridge } from '@freecut/shared/host/embedded-host'
import { buildProjectEvidence, getTimelineRevision } from './evidence'
import { getAiEditingTool, listAiEditingTools } from './tool-registry'
import type {
  AiEditingObservation,
  AiEditingPlan,
  AiEditingPlanStep,
  AiEditingResponse,
  AiEditingToolCall,
} from './types'

const MAX_TOOL_ROUNDS = 3
const MAX_TOKENS = 768

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

规则：
1. 先用 read 工具补足信息；read 工具会自动执行。
2. analysis、edit、settings 工具只会形成待确认计划，绝不直接生效。
3. 工具参数必须使用素材或片段的真实 ID，时间使用秒。
4. 对口播剪辑，优先引用字幕时间；对卡点剪辑，只有获得节拍证据后才能提出节拍对齐。
5. 每次只返回一个 JSON 对象，不要 Markdown：
{"reply":"给用户的简短说明","toolCalls":[{"id":"工具 ID","args":{}}]}

当前项目的结构化证据：
${JSON.stringify(evidence)}`
}

function parseResponse(raw: string): AiEditingResponse | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const value = JSON.parse(raw.slice(start, end + 1)) as {
      reply?: unknown
      toolCalls?: unknown
    }
    if (typeof value.reply !== 'string' || !Array.isArray(value.toolCalls)) return null
    const toolCalls: AiEditingToolCall[] = []
    for (const candidate of value.toolCalls) {
      if (!candidate || typeof candidate !== 'object') return null
      const call = candidate as { id?: unknown; args?: unknown }
      if (typeof call.id !== 'string' || !call.args || typeof call.args !== 'object' || Array.isArray(call.args)) {
        return null
      }
      toolCalls.push({ id: call.id, args: call.args as Record<string, unknown> })
    }
    return { reply: value.reply, toolCalls }
  } catch {
    return null
  }
}

function toolError(toolId: string, message: string): AiEditingObservation {
  return { toolId, result: { ok: false, message } }
}

function makePlan(reply: string, calls: AiEditingPlanStep[]): AiEditingPlan | null {
  if (calls.length === 0) return null
  return {
    id: crypto.randomUUID(),
    title: calls.length === 1 ? calls[0]!.summary : `执行 ${calls.length} 项剪辑调整`,
    summary: reply,
    timelineRevision: getTimelineRevision(),
    steps: calls,
    createdAt: Date.now(),
  }
}

export interface AiEditingRunResult {
  reply: string
  observations: AiEditingObservation[]
  plan: AiEditingPlan | null
}

export interface AiEditingRunOptions {
  history: LlmMessage[]
  signal?: AbortSignal
  onToken?: (delta: string, fullText: string) => void
  adapter?: LlmAdapter
}

export function getAiEditingAdapter(): LlmAdapter {
  if (getEmbeddedHostBridge().aiAssistant) return openAiResponsesLlmAdapter
  return getDefaultLlmAdapter()
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
  const plannedSteps: AiEditingPlanStep[] = []
  let reply = ''

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const raw = await adapter.generate(messages, {
      maxTokens: MAX_TOKENS,
      temperature: 0,
      signal: options.signal,
      onToken: options.onToken,
    })
    const parsed = parseResponse(raw)
    if (!parsed) {
      if (round === MAX_TOOL_ROUNDS - 1) {
        throw new Error('助手没有返回可执行的剪辑计划，请换一种说法再试。')
      }
      messages.push({ role: 'assistant', content: raw })
      messages.push({
        role: 'user',
        content: '请只返回符合约定格式的 JSON 对象，且 toolCalls 必须是数组。',
      })
      continue
    }

    reply = parsed.reply
    const readObservations: AiEditingObservation[] = []
    for (const call of parsed.toolCalls) {
      const tool = getAiEditingTool(call.id)
      if (!tool) {
        readObservations.push(toolError(call.id, '这个操作目前不可用。'))
        continue
      }
      const validation = tool.validate(call.args)
      if (!validation.ok) {
        readObservations.push(toolError(call.id, validation.error))
        continue
      }
      if (tool.risk === 'read') {
        try {
          readObservations.push({ toolId: tool.id, result: await tool.execute(validation.value) })
        } catch (error) {
          readObservations.push(toolError(tool.id, error instanceof Error ? error.message : '读取失败。'))
        }
        continue
      }
      plannedSteps.push({
        toolId: tool.id,
        args: validation.value,
        summary: tool.summarize(validation.value),
        risk: tool.risk,
      })
    }

    observations.push(...readObservations)
    if (readObservations.length === 0 || plannedSteps.length > 0 || round === MAX_TOOL_ROUNDS - 1) break

    messages.push({ role: 'assistant', content: raw })
    messages.push({
      role: 'user',
      content: `工具结果：${JSON.stringify(readObservations)}。请依据这些结果回答或提出待确认的下一步。`,
    })
  }

  return { reply, observations, plan: makePlan(reply, plannedSteps) }
}

export async function applyAiEditingPlan(plan: AiEditingPlan): Promise<AiEditingObservation[]> {
  if (getTimelineRevision() !== plan.timelineRevision) {
    throw new Error('时间轴已发生变化，请重新生成剪辑计划。')
  }

  const resolved = plan.steps.map((step) => {
    const tool = getAiEditingTool(step.toolId)
    if (!tool) throw new Error(`操作“${step.toolId}”已不可用。`)
    const validation = tool.validate(step.args)
    if (!validation.ok) throw new Error(validation.error)
    return { step, tool, args: validation.value }
  })

  const observations: AiEditingObservation[] = []
  const syncEdits: typeof resolved = []

  const flushSyncEdits = (): void => {
    if (syncEdits.length === 0) return
    useTimelineCommandStore.getState().executeTransaction(
      {
        type: 'APPLY_AI_EDITING_PLAN',
        payload: { planId: plan.id, toolIds: syncEdits.map(({ tool }) => tool.id) },
      },
      () => {
        for (const entry of syncEdits) {
          const result = entry.tool.execute(entry.args)
          if (result instanceof Promise) throw new Error('剪辑操作未能及时完成。')
          observations.push({ toolId: entry.tool.id, result })
          if (!result.ok) throw new Error(result.message)
        }
      },
    )
    syncEdits.length = 0
  }

  for (const entry of resolved) {
    if (entry.tool.risk === 'edit' && entry.tool.execution === 'sync') {
      syncEdits.push(entry)
      continue
    }
    flushSyncEdits()
    observations.push({ toolId: entry.tool.id, result: await entry.tool.execute(entry.args) })
  }
  flushSyncEdits()

  return observations
}
