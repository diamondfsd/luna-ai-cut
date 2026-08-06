/**
 * Transport-agnostic editor tool contract.
 *
 * One registry of tools feeds three consumers, now and later:
 *   1. the on-device Gemma harness (today) — reads the catalog, validates, runs;
 *   2. a future in-browser MCP server — `inputSchema` + `execute` map directly to
 *      MCP `tools/list` / `tools/call` (see `mcp.ts`);
 *   3. the headless edit CLI — the same `execute` surface, no UI.
 *
 * Because every tool already carries a JSON-Schema `inputSchema`, a normalized
 * `execute(args) => ToolResult`, and capability flags, exposing the editor over
 * MCP later is a thin adapter rather than a rewrite.
 */

/** Minimal JSON Schema shape we author for tool inputs (MCP `inputSchema`). */
export interface JsonSchema {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
}

export interface ToolResult {
  ok: boolean
  /** Short, user- and model-facing outcome line. */
  message: string
  /** Optional structured payload (e.g. query results) for loop/MCP consumers. */
  data?: unknown
}

export type ToolValidation =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }

export interface EditorAgentTool {
  /** Stable id used in plans / MCP `tools/call`. */
  readonly name: string
  /** Human-facing title. */
  readonly title: string
  /** LLM- and MCP-facing description of when to use it. */
  readonly description: string
  /** JSON Schema for the args object (MCP `inputSchema`). */
  readonly inputSchema: JsonSchema
  /** Read-only/query tool — safe to run without confirmation; usable in a gather loop. */
  readonly readOnly: boolean
  /** Mutates the timeline destructively (cut/delete) — always confirm before running. */
  readonly destructive: boolean
  /** Hands off to a review dialog instead of mutating directly. */
  readonly handoff: boolean
  /** Validate + normalize raw args (returns a friendly error message on failure). */
  validate: (args: unknown) => ToolValidation
  /** One-line plan-step label. */
  summarize: (args: Record<string, unknown>) => string
  /** Execute against the live editor state. */
  execute: (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult
}
