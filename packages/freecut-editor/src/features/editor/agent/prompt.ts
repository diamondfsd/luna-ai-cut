/**
 * Prompt construction and plan parsing for the editing agent.
 *
 * The on-device model is small, so we use a single-shot, structured-output
 * strategy: given the tool catalog (generated from the registry) and a grounded
 * timeline snapshot, it returns one JSON object with a short reply plus an
 * ordered list of tool calls. The agent service adds a validation-feedback retry
 * on top, which together are far more reliable on a 4B local model than
 * multi-turn ReAct tool use.
 */

import type { LlmMessage } from '@freecut/infrastructure/llm'
import legacyAgentPrompt from '@freecut/features/ai-editing/prompts/legacy-agent.md?raw'
import legacyRequestPrompt from '@freecut/features/ai-editing/prompts/messages/legacy-request.md?raw'
import { renderPrompt } from '@freecut/features/ai-editing/prompts/render-prompt'
import { buildToolCatalog } from './tools'

export interface RawPlanStep {
  tool: string
  args: Record<string, unknown>
}

export interface ParsedPlan {
  reply: string
  steps: RawPlanStep[]
}

export function buildSystemPrompt(): string {
  return renderPrompt(legacyAgentPrompt, { TOOL_CATALOG: buildToolCatalog() })
}

export function buildMessages(
  history: LlmMessage[],
  userText: string,
  contextText: string,
): LlmMessage[] {
  return [
    { role: 'system', content: buildSystemPrompt() },
    ...history,
    {
      role: 'user',
      content: renderPrompt(legacyRequestPrompt, {
        TIMELINE_CONTEXT: contextText,
        USER_REQUEST: userText,
      }),
    },
  ]
}

/** Extract the first balanced `{…}` JSON object from arbitrary model text. */
function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < raw.length; i++) {
    const char = raw[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) return raw.slice(start, i + 1)
    }
  }
  return null
}

/**
 * Parse the model output into a plan. Tolerant of code fences and surrounding
 * prose. `valid` is false when no JSON object could be found at all, which the
 * service uses to trigger a corrective retry.
 */
export function parsePlan(raw: string): ParsedPlan & { valid: boolean } {
  const json = extractJsonObject(raw)
  if (!json) return { reply: raw.trim(), steps: [], valid: false }

  try {
    const parsed = JSON.parse(json) as unknown
    if (!parsed || typeof parsed !== 'object') {
      return { reply: raw.trim(), steps: [], valid: false }
    }
    const record = parsed as Record<string, unknown>
    const reply = typeof record.reply === 'string' ? record.reply.trim() : ''
    const rawSteps = Array.isArray(record.steps) ? record.steps : []
    const steps: RawPlanStep[] = []
    for (const entry of rawSteps) {
      if (!entry || typeof entry !== 'object') continue
      const step = entry as Record<string, unknown>
      if (typeof step.tool !== 'string') continue
      const args =
        step.args && typeof step.args === 'object' ? (step.args as Record<string, unknown>) : {}
      steps.push({ tool: step.tool, args })
    }
    return { reply, steps, valid: true }
  } catch {
    return { reply: raw.trim(), steps: [], valid: false }
  }
}
