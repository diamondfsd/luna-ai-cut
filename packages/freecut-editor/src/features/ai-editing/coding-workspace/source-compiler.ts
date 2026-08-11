import { ZodError, type ZodType } from 'zod'
import { editProgramSchema } from '../edit-program/schema'
import type { EditOperation, EditProgram } from '../edit-program/types'
import {
  componentRefSchema,
  editingManifestSchema,
  editingSegmentSchema,
  editingSequenceSchema,
  textComponentSchema,
  type EditingManifestSource,
  type EditingSegmentSource,
  type EditingSequenceSource,
  type SourceInsertTextOperation,
  type TextComponentSource,
} from './source-format'
import { VirtualEditingWorkspace, VirtualFilesError } from './virtual-files'

export type SourceCompilerErrorCode =
  | 'INVALID_BASE_REVISION'
  | 'SOURCE_PARSE_ERROR'
  | 'SOURCE_VALIDATION_ERROR'
  | 'MISSING_REFERENCE'
  | 'IMPORT_CYCLE'
  | 'DUPLICATE_SEGMENT'
  | 'INVALID_COMPONENT_REFERENCE'

export class SourceCompilerError extends Error {
  readonly code: SourceCompilerErrorCode
  readonly path?: string

  constructor(code: SourceCompilerErrorCode, message: string, path?: string) {
    super(message)
    this.name = 'SourceCompilerError'
    this.code = code
    this.path = path
  }
}

function parseSource<T>(workspace: VirtualEditingWorkspace, path: string, schema: ZodType<T>): T {
  let content: string
  try {
    content = workspace.read(path).content
  } catch (error) {
    if (error instanceof VirtualFilesError && error.code === 'FILE_NOT_FOUND') {
      throw new SourceCompilerError('MISSING_REFERENCE', `Missing source file: ${path}`, path)
    }
    throw error
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new SourceCompilerError(
      'SOURCE_PARSE_ERROR',
      `Source file is not valid JSON: ${path}`,
      path,
    )
  }

  try {
    return schema.parse(parsed)
  } catch (error) {
    if (!(error instanceof ZodError)) throw error
    const issue = error.issues[0]
    const location = issue?.path.length ? ` at ${issue.path.join('.')}` : ''
    throw new SourceCompilerError(
      'SOURCE_VALIDATION_ERROR',
      `Invalid source file ${path}${location}: ${issue?.message ?? 'validation failed'}`,
      path,
    )
  }
}

function isInsertTextWithComponent(
  operation: Record<string, unknown>,
): operation is SourceInsertTextOperation {
  if (
    operation.type !== 'insertText' ||
    typeof operation.text !== 'object' ||
    operation.text === null
  ) {
    return false
  }
  return 'componentRef' in operation.text
}

function expandTextComponent(
  workspace: VirtualEditingWorkspace,
  operation: Record<string, unknown>,
  segmentPath: string,
): Record<string, unknown> {
  if (!isInsertTextWithComponent(operation)) return operation
  const componentRef = operation.text.componentRef
  const parsedComponentRef = componentRefSchema.safeParse(componentRef)
  if (!parsedComponentRef.success) {
    throw new SourceCompilerError(
      'INVALID_COMPONENT_REFERENCE',
      `Invalid text component reference in ${segmentPath}.`,
      segmentPath,
    )
  }
  const component = parseSource<TextComponentSource>(
    workspace,
    parsedComponentRef.data,
    textComponentSchema,
  )
  const { componentRef: _componentRef, ...text } = operation.text
  const localStyle = text.style
  const resolvedStyle =
    localStyle === undefined
      ? component.style
      : typeof localStyle === 'object' && localStyle !== null && !Array.isArray(localStyle)
        ? { ...component.style, ...localStyle }
        : localStyle
  return {
    ...operation,
    text: {
      ...text,
      ...(text.role === undefined && component.role !== undefined ? { role: component.role } : {}),
      ...(text.box === undefined && component.box !== undefined ? { box: component.box } : {}),
      ...(resolvedStyle !== undefined ? { style: resolvedStyle } : {}),
    },
  }
}

function validateProgram(program: unknown): EditProgram {
  try {
    return editProgramSchema.parse(program) as EditProgram
  } catch (error) {
    if (!(error instanceof ZodError)) throw error
    const issue = error.issues[0]
    const location = issue?.path.length ? ` at ${issue.path.join('.')}` : ''
    throw new SourceCompilerError(
      'SOURCE_VALIDATION_ERROR',
      `Compiled edit program is invalid${location}: ${issue?.message ?? 'validation failed'}`,
    )
  }
}

export function compileEditingSources(input: {
  workspace: VirtualEditingWorkspace
  baseRevision: number
  projectId?: string
  mode?: EditProgram['mode']
}): EditProgram {
  if (!Number.isInteger(input.baseRevision) || input.baseRevision < 0) {
    throw new SourceCompilerError(
      'INVALID_BASE_REVISION',
      'Compile base revision must be a non-negative integer.',
    )
  }
  const manifest = parseSource<EditingManifestSource>(
    input.workspace,
    'manifest.json',
    editingManifestSchema,
  )
  const sequence = parseSource<EditingSequenceSource>(
    input.workspace,
    manifest.main,
    editingSequenceSchema,
  )
  const visited = new Set<string>()
  const visiting: string[] = []
  const operations: Record<string, unknown>[] = []

  const visitSegment = (path: string): void => {
    const cycleStart = visiting.indexOf(path)
    if (cycleStart >= 0) {
      const cycle = [...visiting.slice(cycleStart), path].join(' -> ')
      throw new SourceCompilerError('IMPORT_CYCLE', `Segment import cycle: ${cycle}`, path)
    }
    if (visited.has(path)) {
      throw new SourceCompilerError(
        'DUPLICATE_SEGMENT',
        `Segment is imported more than once: ${path}`,
        path,
      )
    }
    visiting.push(path)
    const segment = parseSource<EditingSegmentSource>(input.workspace, path, editingSegmentSchema)
    for (const importedPath of segment.imports ?? []) visitSegment(importedPath)
    for (const operation of segment.operations) {
      operations.push(expandTextComponent(input.workspace, operation, path))
    }
    visiting.pop()
    visited.add(path)
  }

  for (const path of sequence.imports) visitSegment(path)

  return validateProgram({
    version: 1,
    baseRevision: input.baseRevision,
    ...(input.projectId ? { sourceProjectId: input.projectId } : {}),
    intent: manifest.intent,
    ...(input.mode ? { mode: input.mode } : {}),
    operations: operations as EditOperation[],
  })
}
