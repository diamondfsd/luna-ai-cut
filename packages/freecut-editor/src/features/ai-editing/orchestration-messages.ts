import type { LlmMessage } from '@freecut/infrastructure/llm'
import type { EmbeddedAiAssistantMessage } from '@freecut/shared/host/embedded-host'
import { buildAiEditingSystemPrompt } from './agent-prompt'
import { getTimelineCodingSession } from './coding-workspace/session-registry'
import fallbackProgressPrompt from './prompts/messages/fallback-progress.md?raw'
import { renderPrompt } from './prompts/render-prompt'
import type { AiEditingRunOptions } from './run-types'
import { serializeForModel } from './tool-execution'
import type { AiEditingObservation } from './types'

const CONFIRMED_PLAN_EXECUTION_DIRECTIVE = [
  '宿主判定：用户已确认上一条剪辑方案。',
  '本轮是实际修改项目的执行请求，必须使用剪辑源码工具完成工程修改，并以成功的 timeline.commit 结束。',
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

function appendExecutionDirective(
  systemPrompt: string,
  userText: string,
  history: readonly LlmMessage[],
  requiresTimelineCommit = false,
): string {
  return requiresTimelineCommit || isConfirmedPlanExecutionRequest(userText, history)
    ? `${systemPrompt}\n\n${CONFIRMED_PLAN_EXECUTION_DIRECTIVE}`
    : systemPrompt
}

export async function currentWorkspace(_options: AiEditingRunOptions): Promise<unknown> {
  void _options
  return getTimelineCodingSession().promptContext()
}

export function toNativeMessages(messages: LlmMessage[]): EmbeddedAiAssistantMessage[] {
  return messages.map((message) => ({ role: message.role, content: message.content }))
}

export async function buildTurnSystemPrompt(
  userText: string,
  history: readonly LlmMessage[],
  evidence: unknown,
  protocol: 'native' | 'json',
  availableToolIds?: ReadonlySet<string>,
  requiresTimelineCommit = false,
): Promise<string> {
  return appendExecutionDirective(
    await buildAiEditingSystemPrompt(evidence, protocol, userText, availableToolIds),
    userText,
    history,
    requiresTimelineCommit,
  )
}

export async function buildInitialMessages(
  userText: string,
  history: LlmMessage[],
  evidence: unknown,
  protocol: 'native' | 'json',
  availableToolIds?: ReadonlySet<string>,
  requiresTimelineCommit = false,
): Promise<LlmMessage[]> {
  return [
    {
      role: 'system',
      content: await buildTurnSystemPrompt(
        userText,
        history,
        evidence,
        protocol,
        availableToolIds,
        requiresTimelineCommit,
      ),
    },
    ...history,
    { role: 'user', content: userText },
  ]
}

export async function buildJsonFallbackMessages(
  userText: string,
  history: LlmMessage[],
  observations: AiEditingObservation[],
  options: AiEditingRunOptions,
  availableToolIds?: ReadonlySet<string>,
): Promise<LlmMessage[]> {
  const messages = await buildInitialMessages(
    userText,
    history,
    await currentWorkspace(options),
    'json',
    availableToolIds,
    options.turnIntent?.kind === 'execute-approved-plan',
  )
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
