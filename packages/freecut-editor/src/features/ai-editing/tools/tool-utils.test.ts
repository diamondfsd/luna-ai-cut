import { describe, expect, it } from 'vite-plus/test'
import { z } from 'zod'
import { zodValidation } from './tool-utils'

describe('zodValidation', () => {
  it('returns actionable paths and received operation types', () => {
    const schema = z.object({
      program: z.object({
        operations: z.array(z.discriminatedUnion('type', [
          z.object({ type: z.literal('insertText'), text: z.string() }),
          z.object({ type: z.literal('removeClip'), clipRef: z.string() }),
        ])),
      }),
    })

    const result = zodValidation(schema, {
      program: { operations: [{ type: 'insertCaption', text: 'hello' }] },
    })

    expect(result).toMatchObject({
      ok: false,
      error: '提交内容不符合当前编辑规范。',
    })
    if (result.ok) throw new Error('expected validation failure')
    expect(result.details?.[0]).toContain('program.operations.0')
    expect(result.details?.[0]).toContain('"insertCaption"')
  })
})
