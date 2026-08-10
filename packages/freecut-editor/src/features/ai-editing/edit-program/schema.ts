import { z } from 'zod'

const ref = (prefix: string) => z.string().startsWith(`${prefix}:`)
const finiteNonNegative = z.number().finite().min(0)

const poseSchema = z.object({
  center: z.tuple([z.number().finite().min(0).max(1), z.number().finite().min(0).max(1)]),
  zoom: z.number().finite().min(1).max(20),
  rotation: z.number().finite().min(-360).max(360).optional(),
})

const framingSchema = z.object({
  mode: z.enum(['cover', 'contain']),
  pose: poseSchema,
})

const cameraMoveSchema = z.object({
  type: z.literal('move'),
  from: poseSchema,
  to: poseSchema,
  easing: z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out']).optional(),
})

const htmlViewportSchema = z.object({
  width: z.number().int().min(1).max(8192),
  height: z.number().int().min(1).max(8192),
  deviceScaleFactor: z.number().finite().min(0.25).max(4),
})

const htmlDraftSchema = z.object({
  ref: z.string().min(1).max(80),
  html: z.string().min(1).max(500_000),
  css: z.string().max(500_000),
  start: finiteNonNegative,
  duration: z.number().finite().positive().max(86_400),
  label: z.string().min(1).max(200).optional(),
  trackRef: ref('track').optional(),
  viewport: htmlViewportSchema.optional(),
  renderMode: z.enum(['static', 'animated']).optional(),
})

const updateHtmlSchema = z.object({
  type: z.literal('updateHtml'),
  clipRef: ref('clip'),
  expectedRevision: z.number().int().min(1),
  changes: z.object({
    html: z.string().min(1).max(500_000).optional(),
    css: z.string().max(500_000).optional(),
    viewport: htmlViewportSchema.optional(),
    renderMode: z.enum(['static', 'animated']).optional(),
  }).refine((changes) => Object.keys(changes).length > 0, 'HTML 修改不能为空。'),
})

const clipDraftSchema = z.object({
  ref: z.string().min(1).max(80),
  mediaRef: ref('media'),
  trackRef: ref('track'),
  start: finiteNonNegative,
  duration: z.number().finite().positive().max(86_400),
  label: z.string().min(1).max(200).optional(),
  source: z.object({ in: finiteNonNegative, out: z.number().finite().positive() })
    .refine((source) => source.out > source.in, '素材终点必须晚于起点。')
    .optional(),
  framing: framingSchema.optional(),
  cameraMove: cameraMoveSchema.optional(),
})

const transitionSpecSchema = z.object({
  presentation: z.string().min(1).max(80),
  duration: z.number().finite().positive().max(10),
  direction: z.enum(['from-left', 'from-right', 'from-top', 'from-bottom']).optional(),
  alignment: z.number().finite().min(0).max(1).optional(),
})

const transitionSchema = z.object({
  between: z.tuple([z.string().min(1), z.string().min(1)]),
  transition: transitionSpecSchema,
})

const replaceRangeSchema = z.object({
  type: z.literal('replaceRange'),
  range: z.object({ start: finiteNonNegative, end: z.number().finite().positive() })
    .refine((range) => range.end > range.start, '替换范围终点必须晚于起点。'),
  trackRefs: z.array(ref('track')).min(1).max(20).optional(),
  clips: z.array(clipDraftSchema).max(100),
  transitions: z.array(transitionSchema).max(100).optional(),
})

const updateClipSchema = z.object({
  type: z.literal('updateClip'),
  clipRef: ref('clip'),
  changes: z.object({
    start: finiteNonNegative.optional(),
    duration: z.number().finite().positive().max(86_400).optional(),
    trackRef: ref('track').optional(),
    label: z.string().min(1).max(200).optional(),
    text: z.string().min(1).max(2_000).optional(),
    framing: framingSchema.optional(),
    cameraMove: cameraMoveSchema.nullable().optional(),
    volumeDb: z.number().finite().min(-60).max(12).optional(),
  }).refine((changes) => Object.keys(changes).length > 0, '片段修改不能为空。'),
})

const textDraftSchema = z.object({
  ref: z.string().min(1).max(80),
  text: z.string().min(1).max(2_000),
  start: finiteNonNegative,
  duration: z.number().finite().positive().max(86_400),
  label: z.string().min(1).max(200).optional(),
  trackRef: ref('track').optional(),
  role: z.enum(['title', 'caption']).optional(),
})

export const editProgramSchema = z.object({
  version: z.literal(1),
  baseRevision: z.number().int().min(0),
  intent: z.string().min(1).max(500),
  mode: z.enum(['preview', 'commit']).optional(),
  operations: z.array(z.discriminatedUnion('type', [
    replaceRangeSchema,
    z.object({ type: z.literal('insertClip'), clip: clipDraftSchema }),
    z.object({ type: z.literal('insertText'), text: textDraftSchema }),
    z.object({ type: z.literal('insertHtml'), html: htmlDraftSchema }),
    updateHtmlSchema,
    updateClipSchema,
    z.object({ type: z.literal('removeClip'), clipRef: ref('clip') }),
    z.object({
      type: z.literal('setTransition'),
      between: z.tuple([z.string().min(1), z.string().min(1)]),
      transition: transitionSpecSchema.nullable(),
    }),
  ])).min(1).max(100),
})

const editProgramToolSchema = z.object({ program: editProgramSchema })
const generatedToolSchema = z.toJSONSchema(editProgramToolSchema)

export const editProgramToolInputSchema = {
  type: 'object' as const,
  properties: generatedToolSchema.properties ?? {},
  required: generatedToolSchema.required,
  additionalProperties: false,
}
