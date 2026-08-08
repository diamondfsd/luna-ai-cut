/**
 * Orchestration glue between the UI store, the local LLM adapter, and the tool
 * registry. Pure functions + a thin façade — no React, no Zustand here.
 *
 * The key reliability mechanism for a small local model is the
 * **validation-feedback retry**: when the model emits non-JSON or calls a tool
 * that doesn't exist / with bad args, we feed the exact problem back and let it
 * correct itself once before giving up. Combined with clip-ref grounding, this
 * is what makes Gemma's tool calls usable.
 */

import { getDefaultLlmAdapter, type LlmAdapter, type LlmMessage } from '@freecut/infrastructure/llm'
import { createLogger } from '@freecut/shared/logging/logger'
import legacyInvalidJsonPrompt from '@freecut/features/ai-editing/prompts/messages/legacy-invalid-json.md?raw'
import legacyInvalidToolsPrompt from '@freecut/features/ai-editing/prompts/messages/legacy-invalid-tools.md?raw'
import legacyReadResultsPrompt from '@freecut/features/ai-editing/prompts/messages/legacy-read-results.md?raw'
import { renderPrompt } from '@freecut/features/ai-editing/prompts/render-prompt'
import { buildTimelineContext } from './timeline-context'
import { buildMessages, parsePlan } from './prompt'
import { getEditorTool } from './tools'

const logger = createLogger('AgentService')

const MAX_TOKENS = 512

export interface PlannedStep {
  tool: string
  args: Record<string, unknown>
  summary: string
  /** True when the tool opens a review dialog instead of mutating directly. */
  handoff: boolean
  /** True when the tool destructively mutates the timeline (cut/delete). */
  destructive: boolean
}

export interface PlanResult {
  reply: string
  steps: PlannedStep[]
  /** Tool names the model asked for that were invalid (dropped after retry). */
  dropped: string[]
  raw: string
}

interface DroppedStep {
  tool: string
  reason: string
}

export function getAgentAdapter(): LlmAdapter {
  return getDefaultLlmAdapter()
}

/** Validate raw model steps against the registry, dropping anything invalid. */
function validateSteps(rawSteps: { tool: string; args: Record<string, unknown> }[]): {
  steps: PlannedStep[]
  dropped: DroppedStep[]
} {
  const steps: PlannedStep[] = []
  const dropped: DroppedStep[] = []

  for (const raw of rawSteps) {
    const tool = getEditorTool(raw.tool)
    if (!tool) {
      dropped.push({ tool: raw.tool, reason: 'unknown tool' })
      continue
    }
    const validation = tool.validate(raw.args)
    if (!validation.ok) {
      dropped.push({ tool: raw.tool, reason: validation.error })
      continue
    }
    steps.push({
      tool: tool.name,
      args: validation.value,
      summary: tool.summarize(validation.value),
      handoff: tool.handoff,
      destructive: tool.destructive,
    })
  }

  return { steps, dropped }
}

function buildCorrection(wasValidJson: boolean, dropped: DroppedStep[]): string {
  if (!wasValidJson) {
    return legacyInvalidJsonPrompt.trim()
  }
  const issues = dropped.map((entry) => `"${entry.tool}" (${entry.reason})`).join(', ')
  return renderPrompt(legacyInvalidToolsPrompt, { ISSUES: issues })
}

export interface PlanRequestOptions {
  history: LlmMessage[]
  onToken?: (delta: string, text: string) => void
  signal?: AbortSignal
}

export async function planRequest(
  userText: string,
  options: PlanRequestOptions,
): Promise<PlanResult> {
  const adapter = getAgentAdapter()
  const context = buildTimelineContext()
  const baseMessages = buildMessages(options.history, userText, context.text)

  const raw = await adapter.generate(baseMessages, {
    maxTokens: MAX_TOKENS,
    temperature: 0,
    onToken: options.onToken,
    signal: options.signal,
  })

  let parsed = parsePlan(raw)
  let { steps, dropped } = validateSteps(parsed.steps)

  // One corrective retry when the model emitted no JSON or invalid tool calls.
  if ((!parsed.valid || dropped.length > 0) && !options.signal?.aborted) {
    logger.info('Agent plan needs correction', { valid: parsed.valid, dropped: dropped.length })
    const retryMessages: LlmMessage[] = [
      ...baseMessages,
      { role: 'assistant', content: raw },
      { role: 'user', content: buildCorrection(parsed.valid, dropped) },
    ]
    const retryRaw = await adapter.generate(retryMessages, {
      maxTokens: MAX_TOKENS,
      temperature: 0,
      signal: options.signal,
    })
    const retryParsed = parsePlan(retryRaw)
    const retryValidated = validateSteps(retryParsed.steps)
    // Adopt the retry only if it's no worse than the first attempt.
    if (retryParsed.valid && retryValidated.dropped.length <= dropped.length) {
      parsed = retryParsed
      steps = retryValidated.steps
      dropped = retryValidated.dropped
    }
  }

  let reply = parsed.reply
  let actionSteps = splitReadOnly(steps).actions

  // Bounded resolve hop: if the model asked to look something up (a read-only
  // tool like search_transcript), run those reads, feed the results back, and let
  // it produce a final, grounded plan — exactly one extra round, no open loop.
  const readOnlySteps = splitReadOnly(steps).reads
  if (readOnlySteps.length > 0 && !options.signal?.aborted) {
    const observations: string[] = []
    for (const step of readOnlySteps) {
      const result = await runStep(step)
      observations.push(`${step.summary}: ${result.message}`)
    }
    const hopMessages: LlmMessage[] = [
      ...baseMessages,
      { role: 'assistant', content: raw },
      {
        role: 'user',
        content: renderPrompt(legacyReadResultsPrompt, { OBSERVATIONS: observations.join('\n') }),
      },
    ]
    const hopRaw = await adapter.generate(hopMessages, {
      maxTokens: MAX_TOKENS,
      temperature: 0,
      signal: options.signal,
    })
    const hopParsed = parsePlan(hopRaw)
    if (hopParsed.valid) {
      const hopValidated = validateSteps(hopParsed.steps)
      actionSteps = splitReadOnly(hopValidated.steps).actions
      reply = hopParsed.reply || reply
      dropped = hopValidated.dropped
    }
  }

  const finalReply = reply || (actionSteps.length > 0 ? 'Here is the plan.' : raw.trim())
  return { reply: finalReply, steps: actionSteps, dropped: dropped.map((entry) => entry.tool), raw }
}

/** Partition planned steps into read-only "gather" steps and mutating actions. */
function splitReadOnly(steps: PlannedStep[]): { reads: PlannedStep[]; actions: PlannedStep[] } {
  const reads: PlannedStep[] = []
  const actions: PlannedStep[] = []
  for (const step of steps) {
    if (getEditorTool(step.tool)?.readOnly) reads.push(step)
    else actions.push(step)
  }
  return { reads, actions }
}

export interface StepRunResult {
  ok: boolean
  message: string
}

export async function runStep(step: PlannedStep): Promise<StepRunResult> {
  const tool = getEditorTool(step.tool)
  if (!tool) return { ok: false, message: `Unknown tool: ${step.tool}` }
  try {
    const result = await tool.execute(step.args)
    return { ok: result.ok, message: result.message }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Step failed.' }
  }
}
