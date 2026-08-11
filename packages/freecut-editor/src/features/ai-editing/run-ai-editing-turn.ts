import { getAiEditingAdapter, runSingleAiEditingTurn } from './orchestrator'
import type { AiEditingRunOptions, AiEditingRunResult } from './run-types'

export { getAiEditingAdapter }
export type { AiEditingRunOptions, AiEditingRunResult } from './run-types'

export async function runAiEditingTurn(
  userText: string,
  options: AiEditingRunOptions,
): Promise<AiEditingRunResult> {
  return runSingleAiEditingTurn(userText, options)
}
