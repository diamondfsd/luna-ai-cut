import { z } from 'zod'
import type { AiEditingTool, AiEditingToolResult, AiEditingToolValidation } from '../types'

type JsonSchema = AiEditingTool['inputSchema']

export function objectSchema(properties: Record<string, unknown>, required?: string[]): JsonSchema {
  return { type: 'object', properties, required, additionalProperties: false }
}

export function zodValidation<S extends z.ZodType>(schema: S, value: unknown): AiEditingToolValidation {
  const result = schema.safeParse(value)
  if (result.success) return { ok: true, value: result.data as Record<string, unknown> }
  return { ok: false, error: result.error.issues[0]?.message ?? '参数无效。' }
}

export function defineAiEditingTool<S extends z.ZodType>(definition: {
  id: string
  title: string
  description: string
  risk: AiEditingTool['risk']
  execution?: AiEditingTool['execution']
  inputSchema: JsonSchema
  schema: S
  summarize: (args: z.infer<S>) => string
  execute: (args: z.infer<S>) => Promise<AiEditingToolResult> | AiEditingToolResult
}): AiEditingTool {
  return {
    id: definition.id,
    title: definition.title,
    description: definition.description,
    risk: definition.risk,
    execution: definition.execution ?? 'sync',
    inputSchema: definition.inputSchema,
    validate: (value) => zodValidation(definition.schema, value),
    summarize: (args) => definition.summarize(args as z.infer<S>),
    execute: (args) => definition.execute(args as z.infer<S>),
  }
}
