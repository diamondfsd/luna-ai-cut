import { z } from 'zod'
import type {
  AiEditingTool,
  AiEditingToolExecutionContext,
  AiEditingToolResult,
  AiEditingToolValidation,
} from '../types'

type JsonSchema = AiEditingTool['inputSchema']

function valueAtPath(value: unknown, path: PropertyKey[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<PropertyKey, unknown>)[key]
  }, value)
}

function summarizeValue(value: unknown): string {
  if (Array.isArray(value)) return `数组(${value.length})`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const type = typeof record.type === 'string' ? `type=${record.type}; ` : ''
    return `对象(${type}字段=${Object.keys(record).slice(0, 12).join(',')})`
  }
  const serialized = JSON.stringify(value)
  return serialized === undefined ? typeof value : serialized.slice(0, 160)
}

export function objectSchema(properties: Record<string, unknown>, required?: string[]): JsonSchema {
  return { type: 'object', properties, required, additionalProperties: false }
}

export function zodValidation<S extends z.ZodType>(schema: S, value: unknown): AiEditingToolValidation {
  const result = schema.safeParse(value)
  if (result.success) return { ok: true, value: result.data as Record<string, unknown> }
  return {
    ok: false,
    error: '提交内容不符合当前编辑规范。',
    details: result.error.issues.slice(0, 8).map((issue) => {
      const path = issue.path.map(String).join('.') || '参数'
      return `${path}: ${issue.message}; 收到 ${summarizeValue(valueAtPath(value, issue.path))}`
    }),
  }
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
  execute: (
    args: z.infer<S>,
    context?: AiEditingToolExecutionContext,
  ) => Promise<AiEditingToolResult> | AiEditingToolResult
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
    execute: (args, context) => definition.execute(args as z.infer<S>, context),
  }
}
