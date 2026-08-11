import { z } from 'zod'
import type { AgentTextBox, AgentTextStyle, EditOperation } from '../edit-program/types'

function isModuleRef(value: string, root: string, suffix: string): boolean {
  if (!value.startsWith(`${root}/`) || !value.endsWith(suffix) || value.includes('\\')) return false
  return value.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
}

const segmentRefSchema = z
  .string()
  .refine((value) => isModuleRef(value, 'segments', '.segment.json'), 'Invalid segment reference.')
const componentRefSchema = z
  .string()
  .refine(
    (value) => isModuleRef(value, 'components', '.component.json'),
    'Invalid component reference.',
  )

const textStyleSchema = z.strictObject({
  fontSize: z.number().finite().min(1).max(512).optional(),
  fontFamily: z.string().min(1).max(200).optional(),
  fontWeight: z.enum(['normal', 'medium', 'semibold', 'bold']).optional(),
  fontStyle: z.enum(['normal', 'italic']).optional(),
  underline: z.boolean().optional(),
  color: z.string().min(1).max(100).optional(),
  backgroundColor: z.string().min(1).max(100).optional(),
  backgroundRadius: z.number().finite().min(0).max(500).optional(),
  textAlign: z.enum(['left', 'center', 'right']).optional(),
  verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
  lineHeight: z.number().finite().min(0.5).max(5).optional(),
  letterSpacing: z.number().finite().min(-50).max(200).optional(),
  textPadding: z.number().finite().min(0).max(500).optional(),
})

const textBoxSchema = z
  .strictObject({
    left: z.number().finite().min(0).max(1),
    top: z.number().finite().min(0).max(1),
    width: z.number().finite().positive().max(1),
    height: z.number().finite().positive().max(1),
  })
  .refine(
    (box) => box.left + box.width <= 1.000_001 && box.top + box.height <= 1.000_001,
    'Text box must be inside the canvas.',
  )

export const editingManifestSchema = z.strictObject({
  version: z.literal(1),
  main: z.literal('sequences/main.sequence.json'),
  intent: z.string().min(1).max(500),
})

export const editingSequenceSchema = z.strictObject({
  version: z.literal(1),
  imports: z.array(segmentRefSchema).min(1).max(100),
})

export const editingSegmentSchema = z.strictObject({
  version: z.literal(1),
  imports: z.array(segmentRefSchema).max(100).optional(),
  operations: z.array(z.record(z.string(), z.unknown())).max(100),
})

export const textComponentSchema = z
  .strictObject({
    version: z.literal(1),
    type: z.literal('text'),
    role: z.enum(['title', 'caption']).optional(),
    style: textStyleSchema.optional(),
    box: textBoxSchema.optional(),
  })
  .refine(
    (component) =>
      component.role !== undefined || component.style !== undefined || component.box !== undefined,
    'Text component must define at least one default.',
  )

export interface EditingManifestSource {
  version: 1
  main: 'sequences/main.sequence.json'
  intent: string
}

export interface EditingSequenceSource {
  version: 1
  imports: string[]
}

export interface EditingSegmentSource {
  version: 1
  imports?: string[]
  operations: Record<string, unknown>[]
}

export interface TextComponentSource {
  version: 1
  type: 'text'
  role?: 'title' | 'caption'
  style?: AgentTextStyle
  box?: AgentTextBox
}

export type SourceInsertTextOperation = Extract<EditOperation, { type: 'insertText' }> & {
  text: Extract<EditOperation, { type: 'insertText' }>['text'] & {
    componentRef?: string
  }
}

export { componentRefSchema, segmentRefSchema }
