export type { EditorAgentTool, JsonSchema, ToolResult, ToolValidation } from './types'
export { buildToolCatalog, getEditorTool, listEditorTools } from './registry'
export {
  buildClipRefs,
  resolveClipRef,
  resolveClipRefs,
  resolveItemRef,
  resolveTargetItems,
  type ClipRefEntry,
} from './clip-refs'
export { callMcpTool, listMcpTools, type McpCallResult, type McpToolDescriptor } from './mcp'
