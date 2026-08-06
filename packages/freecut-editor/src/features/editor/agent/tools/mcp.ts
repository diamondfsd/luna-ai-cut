/**
 * MCP adapter for the editor tool registry.
 *
 * This is the future-facing seam. The Model Context Protocol describes tools as
 * `{ name, description, inputSchema }` (listing) and `tools/call` → content
 * blocks (invocation) — which is exactly the shape our registry already has. The
 * two functions here are everything an MCP *server* would delegate to; standing
 * one up later is just choosing a transport:
 *
 *   • in-browser: a `postMessage` / `WebSocket` / WebRTC transport so an external
 *     MCP client (or our own cloud agent) can drive this editor tab;
 *   • headless: the edit CLI wraps the same `callTool` over stdio.
 *
 * Keeping this mapping in-tree (and tested) guarantees the registry stays
 * MCP-compatible as tools are added, without yet shipping a server.
 */

import { getEditorTool, listEditorTools } from './registry'
import type { JsonSchema } from './types'

export interface McpToolDescriptor {
  name: string
  description: string
  inputSchema: JsonSchema
  annotations: {
    title: string
    readOnlyHint: boolean
    destructiveHint: boolean
  }
}

export interface McpCallResult {
  content: { type: 'text'; text: string }[]
  isError: boolean
  /** Structured payload mirrored from the tool result (MCP `structuredContent`). */
  structuredContent?: unknown
}

/** MCP `tools/list`. */
export function listMcpTools(): McpToolDescriptor[] {
  return listEditorTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      title: tool.title,
      readOnlyHint: tool.readOnly,
      destructiveHint: tool.destructive,
    },
  }))
}

/** MCP `tools/call`. */
export async function callMcpTool(name: string, args: unknown): Promise<McpCallResult> {
  const tool = getEditorTool(name)
  if (!tool) {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
  }

  const validation = tool.validate(args)
  if (!validation.ok) {
    return {
      content: [{ type: 'text', text: `Invalid arguments — ${validation.error}` }],
      isError: true,
    }
  }

  try {
    const result = await tool.execute(validation.value)
    return {
      content: [{ type: 'text', text: result.message }],
      isError: !result.ok,
      structuredContent: result.data,
    }
  } catch (error) {
    return {
      content: [{ type: 'text', text: error instanceof Error ? error.message : 'Tool failed.' }],
      isError: true,
    }
  }
}
