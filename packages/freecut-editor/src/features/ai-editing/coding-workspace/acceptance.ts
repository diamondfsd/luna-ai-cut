import { z, ZodError } from 'zod'
import type { EditOperation, EditProgram } from '../edit-program/types'
import type { CodingWorkspaceDiagnostic } from './diagnostics'
import { VirtualEditingWorkspace } from './virtual-files'

const MAX_TEST_DIRECTORY_ENTRIES = 200
const MAX_ACCEPTANCE_FILES = 100
const MAX_ACCEPTANCE_FILE_BYTES = 64 * 1024
const MAX_ACCEPTANCE_TOTAL_BYTES = 256 * 1024
const MAX_ACCEPTANCE_ASSERTIONS = 500

const operationTypes = [
  'replaceRange',
  'insertClip',
  'insertText',
  'insertHtml',
  'updateHtml',
  'updateClip',
  'removeClip',
  'setTransition',
] as const satisfies readonly EditOperation['type'][]

const boundedCount = {
  min: z.number().int().min(0).optional(),
  max: z.number().int().min(0).optional(),
}

const boundedSeconds = {
  minSeconds: z.number().finite().min(0).optional(),
  maxSeconds: z.number().finite().min(0).optional(),
}

const assertionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    id: z.string().trim().min(1).max(120),
    kind: z.literal('operationCount'),
    ...boundedCount,
  }),
  z.strictObject({
    id: z.string().trim().min(1).max(120),
    kind: z.literal('operationType'),
    operation: z.enum(operationTypes),
    ...boundedCount,
  }),
  z.strictObject({
    id: z.string().trim().min(1).max(120),
    kind: z.literal('outputDuration'),
    ...boundedSeconds,
  }),
  z.strictObject({
    id: z.string().trim().min(1).max(120),
    kind: z.literal('changedDuration'),
    ...boundedSeconds,
  }),
  z.strictObject({
    id: z.string().trim().min(1).max(120),
    kind: z.literal('requiredText'),
    text: z.string().min(1).max(500),
    caseSensitive: z.boolean().optional(),
    minOccurrences: z.number().int().min(1).max(1000).optional(),
  }),
])

export const timelineAcceptanceSchema = z
  .strictObject({
    version: z.literal(1),
    name: z.string().trim().min(1).max(200).optional(),
    assertions: z.array(assertionSchema).min(1).max(100),
  })
  .superRefine((file, context) => {
    const ids = new Set<string>()
    file.assertions.forEach((assertion, index) => {
      if (ids.has(assertion.id)) {
        context.addIssue({
          code: 'custom',
          path: ['assertions', index, 'id'],
          message: `Duplicate assertion id: ${assertion.id}`,
        })
      }
      ids.add(assertion.id)
      if (
        (assertion.kind === 'operationCount' || assertion.kind === 'operationType') &&
        assertion.min === undefined &&
        assertion.max === undefined
      ) {
        context.addIssue({
          code: 'custom',
          path: ['assertions', index],
          message: 'Count assertion requires min or max.',
        })
      }
      if (
        (assertion.kind === 'operationCount' || assertion.kind === 'operationType') &&
        assertion.min !== undefined &&
        assertion.max !== undefined &&
        assertion.min > assertion.max
      ) {
        context.addIssue({
          code: 'custom',
          path: ['assertions', index],
          message: 'Count assertion min cannot exceed max.',
        })
      }
      if (
        (assertion.kind === 'outputDuration' || assertion.kind === 'changedDuration') &&
        assertion.minSeconds === undefined &&
        assertion.maxSeconds === undefined
      ) {
        context.addIssue({
          code: 'custom',
          path: ['assertions', index],
          message: 'Duration assertion requires minSeconds or maxSeconds.',
        })
      }
      if (
        (assertion.kind === 'outputDuration' || assertion.kind === 'changedDuration') &&
        assertion.minSeconds !== undefined &&
        assertion.maxSeconds !== undefined &&
        assertion.minSeconds > assertion.maxSeconds
      ) {
        context.addIssue({
          code: 'custom',
          path: ['assertions', index],
          message: 'Duration assertion minSeconds cannot exceed maxSeconds.',
        })
      }
    })
  })

export type TimelineAcceptanceFile = z.infer<typeof timelineAcceptanceSchema>
export type TimelineAcceptanceAssertion = TimelineAcceptanceFile['assertions'][number]

export interface TimelineAcceptanceResult {
  path: string
  assertionId: string
  kind: TimelineAcceptanceAssertion['kind']
  passed: boolean
  expected: Readonly<Record<string, unknown>>
  actual: number
  message: string
}

export interface TimelineAcceptanceMetrics {
  operationCount: number
  operationTypes: Record<string, number>
  outputDurationSeconds: number
  changedDurationSeconds: number
  textValueCount: number
}

export interface TimelineAcceptanceRunResult {
  passed: boolean
  files: string[]
  results: TimelineAcceptanceResult[]
  diagnostics: CodingWorkspaceDiagnostic<number>[]
  metrics: TimelineAcceptanceMetrics
}

function diagnostic(input: {
  code: string
  message: string
  path?: string
  details?: Readonly<Record<string, unknown>>
}): CodingWorkspaceDiagnostic<number> {
  return {
    code: input.code,
    message: input.message,
    severity: 'error',
    stage: 'test',
    retryable: false,
    ...(input.path ? { path: input.path } : {}),
    ...(input.details ? { details: input.details } : {}),
  }
}

function operationRange(operation: EditOperation): { start: number; end: number } | undefined {
  if (operation.type === 'replaceRange') return operation.range
  if (operation.type === 'insertClip') {
    return { start: operation.clip.start, end: operation.clip.start + operation.clip.duration }
  }
  if (operation.type === 'insertText') {
    return { start: operation.text.start, end: operation.text.start + operation.text.duration }
  }
  if (operation.type === 'insertHtml') {
    return { start: operation.html.start, end: operation.html.start + operation.html.duration }
  }
  return undefined
}

function mergedDuration(ranges: Array<{ start: number; end: number }>): number {
  const sorted = ranges
    .filter((range) => range.end > range.start)
    .toSorted((left, right) => left.start - right.start || left.end - right.end)
  let duration = 0
  let current: { start: number; end: number } | undefined
  for (const range of sorted) {
    if (!current) {
      current = { ...range }
    } else if (range.start <= current.end) {
      current.end = Math.max(current.end, range.end)
    } else {
      duration += current.end - current.start
      current = { ...range }
    }
  }
  return duration + (current ? current.end - current.start : 0)
}

export function measureTimelineProgram(
  program: EditProgram,
): TimelineAcceptanceMetrics & { textValues: string[] } {
  const operationTypeCounts: Record<string, number> = {}
  const ranges: Array<{ start: number; end: number }> = []
  const textValues: string[] = []
  for (const operation of program.operations) {
    operationTypeCounts[operation.type] = (operationTypeCounts[operation.type] ?? 0) + 1
    const range = operationRange(operation)
    if (range) ranges.push(range)
    if (operation.type === 'insertText') textValues.push(operation.text.text)
    if (operation.type === 'insertHtml') textValues.push(operation.html.html)
    if (operation.type === 'updateClip' && operation.changes.text !== undefined) {
      textValues.push(operation.changes.text)
    }
  }
  return {
    operationCount: program.operations.length,
    operationTypes: operationTypeCounts,
    outputDurationSeconds: ranges.reduce((maximum, range) => Math.max(maximum, range.end), 0),
    changedDurationSeconds: mergedDuration(ranges),
    textValueCount: textValues.length,
    textValues,
  }
}

function inRange(value: number, min?: number, max?: number): boolean {
  return (min === undefined || value >= min) && (max === undefined || value <= max)
}

function expectation(assertion: TimelineAcceptanceAssertion): Readonly<Record<string, unknown>> {
  if (assertion.kind === 'requiredText') {
    return { text: assertion.text, minOccurrences: assertion.minOccurrences ?? 1 }
  }
  if (assertion.kind === 'operationType') {
    return { operation: assertion.operation, min: assertion.min, max: assertion.max }
  }
  if (assertion.kind === 'operationCount') return { min: assertion.min, max: assertion.max }
  return { minSeconds: assertion.minSeconds, maxSeconds: assertion.maxSeconds }
}

function evaluateAssertion(
  path: string,
  assertion: TimelineAcceptanceAssertion,
  metrics: TimelineAcceptanceMetrics & { textValues: string[] },
): TimelineAcceptanceResult {
  let actual: number
  let passed: boolean
  if (assertion.kind === 'operationCount') {
    actual = metrics.operationCount
    passed = inRange(actual, assertion.min, assertion.max)
  } else if (assertion.kind === 'operationType') {
    actual = metrics.operationTypes[assertion.operation] ?? 0
    passed = inRange(actual, assertion.min, assertion.max)
  } else if (assertion.kind === 'outputDuration') {
    actual = metrics.outputDurationSeconds
    passed = inRange(actual, assertion.minSeconds, assertion.maxSeconds)
  } else if (assertion.kind === 'changedDuration') {
    actual = metrics.changedDurationSeconds
    passed = inRange(actual, assertion.minSeconds, assertion.maxSeconds)
  } else {
    const needle = assertion.caseSensitive ? assertion.text : assertion.text.toLocaleLowerCase()
    actual = metrics.textValues.reduce((count, text) => {
      const haystack = assertion.caseSensitive ? text : text.toLocaleLowerCase()
      let offset = 0
      while (offset <= haystack.length) {
        const match = haystack.indexOf(needle, offset)
        if (match < 0) break
        count += 1
        offset = match + needle.length
      }
      return count
    }, 0)
    passed = actual >= (assertion.minOccurrences ?? 1)
  }
  return {
    path,
    assertionId: assertion.id,
    kind: assertion.kind,
    passed,
    expected: expectation(assertion),
    actual,
    message: passed ? 'Acceptance assertion passed.' : 'Acceptance assertion failed.',
  }
}

function parseAcceptanceFile(path: string, content: string): TimelineAcceptanceFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw diagnostic({
      code: 'ACCEPTANCE_PARSE_ERROR',
      message: `Acceptance file is not valid JSON: ${path}`,
      path,
    })
  }
  try {
    return timelineAcceptanceSchema.parse(parsed)
  } catch (error) {
    if (!(error instanceof ZodError)) throw error
    const issue = error.issues[0]
    const location = issue?.path.length ? ` at ${issue.path.join('.')}` : ''
    throw diagnostic({
      code: 'ACCEPTANCE_SCHEMA_INVALID',
      message: `Invalid acceptance file ${path}${location}: ${issue?.message ?? 'validation failed'}`,
      path,
    })
  }
}

function isDiagnostic(error: unknown): error is CodingWorkspaceDiagnostic<number> {
  return typeof error === 'object' && error !== null && 'code' in error && 'stage' in error
}

export function runTimelineAcceptance(
  workspace: VirtualEditingWorkspace,
  program: EditProgram,
): TimelineAcceptanceRunResult {
  const measured = measureTimelineProgram(program)
  const { textValues: _textValues, ...metrics } = measured
  const listed = workspace.list({ path: 'tests', limit: MAX_TEST_DIRECTORY_ENTRIES })
  if (listed.nextCursor !== undefined) {
    const error = diagnostic({
      code: 'ACCEPTANCE_DIRECTORY_LIMIT_EXCEEDED',
      message: `The tests directory exceeds ${MAX_TEST_DIRECTORY_ENTRIES} entries.`,
      path: 'tests',
    })
    return { passed: false, files: [], results: [], diagnostics: [error], metrics }
  }
  const paths = listed.entries
    .filter(
      (entry) =>
        entry.type === 'file' &&
        entry.path.startsWith('tests/') &&
        entry.path.endsWith('.acceptance.json'),
    )
    .map((entry) => entry.path)
    .toSorted()
  if (paths.length > MAX_ACCEPTANCE_FILES) {
    const error = diagnostic({
      code: 'ACCEPTANCE_FILE_LIMIT_EXCEEDED',
      message: `At most ${MAX_ACCEPTANCE_FILES} acceptance files are allowed.`,
      path: 'tests',
    })
    return { passed: false, files: paths, results: [], diagnostics: [error], metrics }
  }

  const results: TimelineAcceptanceResult[] = []
  const diagnostics: CodingWorkspaceDiagnostic<number>[] = []
  let totalBytes = 0
  let assertionCount = 0
  for (const path of paths) {
    const read = workspace.read(path)
    const bytes = new TextEncoder().encode(read.content).byteLength
    totalBytes += bytes
    if (bytes > MAX_ACCEPTANCE_FILE_BYTES || totalBytes > MAX_ACCEPTANCE_TOTAL_BYTES) {
      diagnostics.push(
        diagnostic({
          code: 'ACCEPTANCE_SIZE_LIMIT_EXCEEDED',
          message: `Acceptance files exceed the bounded read limit: ${path}`,
          path,
        }),
      )
      break
    }
    try {
      const file = parseAcceptanceFile(path, read.content)
      assertionCount += file.assertions.length
      if (assertionCount > MAX_ACCEPTANCE_ASSERTIONS) {
        diagnostics.push(
          diagnostic({
            code: 'ACCEPTANCE_ASSERTION_LIMIT_EXCEEDED',
            message: `At most ${MAX_ACCEPTANCE_ASSERTIONS} acceptance assertions are allowed.`,
            path,
          }),
        )
        break
      }
      for (const assertion of file.assertions) {
        const result = evaluateAssertion(path, assertion, measured)
        results.push(result)
        if (!result.passed) {
          diagnostics.push(
            diagnostic({
              code: 'ACCEPTANCE_ASSERTION_FAILED',
              message: `${path}#${assertion.id} failed.`,
              path,
              details: {
                assertionId: assertion.id,
                kind: assertion.kind,
                expected: result.expected,
                actual: result.actual,
              },
            }),
          )
        }
      }
    } catch (error) {
      diagnostics.push(
        isDiagnostic(error)
          ? error
          : diagnostic({
              code: 'ACCEPTANCE_TEST_FAILED',
              message: error instanceof Error ? error.message : 'Acceptance test failed.',
              path,
            }),
      )
    }
  }
  return {
    passed: diagnostics.length === 0,
    files: paths,
    results,
    diagnostics,
    metrics,
  }
}

export const TIMELINE_ACCEPTANCE_LIMITS = {
  directoryEntries: MAX_TEST_DIRECTORY_ENTRIES,
  files: MAX_ACCEPTANCE_FILES,
  fileBytes: MAX_ACCEPTANCE_FILE_BYTES,
  totalBytes: MAX_ACCEPTANCE_TOTAL_BYTES,
  assertions: MAX_ACCEPTANCE_ASSERTIONS,
} as const
