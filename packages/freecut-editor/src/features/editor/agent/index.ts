/**
 * Public API for the editing agent.
 */

export { useAgentStore } from './agent-store'
export type {
  AgentPhase,
  ChatMessage,
  ModelStatus,
  PlanStepState,
  PlanStepStatus,
} from './agent-store'
// Tool registry surface — also the seam a future MCP server / headless CLI uses.
export {
  buildToolCatalog,
  callMcpTool,
  getEditorTool,
  listEditorTools,
  listMcpTools,
  type EditorAgentTool,
  type McpToolDescriptor,
} from './tools'
