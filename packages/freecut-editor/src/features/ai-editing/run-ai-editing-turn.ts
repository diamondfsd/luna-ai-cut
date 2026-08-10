import {
  getAiEditingAdapter,
  runSingleAiEditingTurn,
} from './orchestrator'
import type { AiEditingRunOptions, AiEditingRunResult } from './run-types'
import { buildAgentWorkspaceDocument } from './workspace-document/build-workspace-document'

export { getAiEditingAdapter }
export type { AiEditingRunOptions, AiEditingRunResult } from './run-types'

export async function runAiEditingTurn(
  userText: string,
  options: AiEditingRunOptions,
): Promise<AiEditingRunResult> {
  const initialWorkspace = await buildAgentWorkspaceDocument()
  return runSingleAiEditingTurn(userText, options, { evidence: initialWorkspace })
}
