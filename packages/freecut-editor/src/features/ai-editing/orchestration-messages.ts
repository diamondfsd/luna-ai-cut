import type { LlmMessage } from '@freecut/infrastructure/llm'
import type { EmbeddedAiAssistantMessage } from '@freecut/shared/host/embedded-host'
import {
  buildAiEditingSystemPrompt,
  buildAiEditingTurnContext,
} from './agent-prompt'
import fallbackProgressPrompt from './prompts/messages/fallback-progress.md?raw'
import { renderPrompt } from './prompts/render-prompt'
import { serializeForModel } from './tool-execution'
import type { AiEditingObservation } from './types'

const CONFIRMED_PLAN_EXECUTION_DIRECTIVE = [
  '宿主判定：用户已确认上一条剪辑方案。',
  '本轮是实际修改项目的执行请求，必须使用剪辑源码工具完成工程修改，并以成功的 git.commit 结束。',
  '不要再次只提供文本建议或重复脚本。',
].join('')

function normalizedConfirmation(text: string): string {
  return text
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s，,。.!！、;；:：]/g, '')
}

function hasDeliveredEditingPlan(history: readonly LlmMessage[]): boolean {
  const previousAssistant = history.findLast((message) => message.role === 'assistant')
  if (!previousAssistant || previousAssistant.content.trim().length < 20) return false
  return /(脚本|方案|分镜|镜头|画面|剪辑|节奏|开场|收尾)/.test(previousAssistant.content)
}

export function isConfirmedPlanExecutionRequest(
  userText: string,
  history: readonly LlmMessage[],
): boolean {
  if (!hasDeliveredEditingPlan(history)) return false
  const text = normalizedConfirmation(userText)
  if (!text || /[?？]|怎么样|好不好|是否|能不能/.test(userText)) return false
  if (/^(ok|okay|好的?|可以|行|没问题)$/.test(text)) return true
  return /^(?:(?:ok|okay|好的?|可以|行|没问题))?(?:就)?(?:按照|按|照|依照|采用|用)(?:这个|此|刚才的|上面的)?(?:方案|脚本|分镜)?(?:来|执行|做|剪|开始)?(?:吧|了|就行)?$/.test(text)
}

function executionDirectiveForTurn(
  userText: string,
  history: readonly LlmMessage[],
  requiresEditCommit = false,
): string | undefined {
  return requiresEditCommit || isConfirmedPlanExecutionRequest(userText, history)
    ? CONFIRMED_PLAN_EXECUTION_DIRECTIVE
    : undefined
}

function currentTurnContextMessage(
  userText: string,
  history: readonly LlmMessage[],
  evidence: unknown,
  requiresEditCommit: boolean,
): string {
  return buildAiEditingTurnContext(
    evidence,
    executionDirectiveForTurn(userText, history, requiresEditCommit),
  )
}

export function toNativeMessages(messages: LlmMessage[]): EmbeddedAiAssistantMessage[] {
  return messages.map((message) => ({ role: message.role, content: message.content }))
}

export function replayMessagesForJson(
  messages: readonly EmbeddedAiAssistantMessage[],
): LlmMessage[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'user' as const,
        content: `工具调用 ${message.toolCallId} 的执行结果：\n${message.content}`,
      }
    }
    if (message.role !== 'assistant' || !message.toolCalls?.length) {
      return { role: message.role, content: message.content ?? '' } as LlmMessage
    }
    const calls = message.toolCalls.map((call) => ({
      id: call.id,
      name: call.name,
      arguments: call.arguments,
    }))
    return {
      role: 'assistant',
      content: [
        message.content ?? '',
        `已请求工具调用：\n${JSON.stringify(calls)}`,
      ].filter(Boolean).join('\n\n'),
    }
  })
}

export async function buildInitialNativeMessages(
  userText: string,
  history: EmbeddedAiAssistantMessage[],
  evidence: unknown,
  availableToolIds: ReadonlySet<string>,
  requiresEditCommit = false,
): Promise<EmbeddedAiAssistantMessage[]> {
  const textHistory = replayMessagesForJson(history)
  return [
    {
      role: 'system',
      content: await buildAiEditingSystemPrompt('native', availableToolIds),
    },
    ...history,
    {
      role: 'system',
      content: currentTurnContextMessage(
        userText,
        textHistory,
        evidence,
        requiresEditCommit,
      ),
    },
    { role: 'user', content: userText },
  ]
}

export async function buildInitialMessages(
  userText: string,
  history: LlmMessage[],
  evidence: unknown,
  protocol: 'native' | 'json',
  availableToolIds: ReadonlySet<string>,
  requiresEditCommit = false,
): Promise<LlmMessage[]> {
  return [
    {
      role: 'system',
      content: await buildAiEditingSystemPrompt(protocol, availableToolIds),
    },
    ...history,
    {
      role: 'system',
      content: currentTurnContextMessage(
        userText,
        history,
        evidence,
        requiresEditCommit,
      ),
    },
    { role: 'user', content: userText },
  ]
}

export function buildJsonFallbackMessages(
  initialMessages: LlmMessage[],
  observations: AiEditingObservation[],
): LlmMessage[] {
  const messages = [...initialMessages]
  if (observations.length > 0) {
    messages.push({
      role: 'user',
      content: renderPrompt(fallbackProgressPrompt, {
        OBSERVATIONS: serializeForModel(observations),
      }),
    })
  }
  return messages
}
