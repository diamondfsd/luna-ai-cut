// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { assertSingleShotInsert } from './single-shot-policy'

describe('single-shot edit policy', () => {
  it('allows one primary visual with its audio, text, and HTML layers', () => {
    expect(() => assertSingleShotInsert([
      { type: 'video' },
      { type: 'audio' },
      { type: 'text' },
      { type: 'html' },
    ])).not.toThrow()
  })

  it('rejects multiple primary visual shots in one program', () => {
    expect(() => assertSingleShotInsert([
      { type: 'video' },
      { type: 'image' },
    ])).toThrow('一次编辑程序只能新增一个主画面 shot')
  })

  it('allows bulk updates that do not insert primary visuals', () => {
    expect(() => assertSingleShotInsert([{ type: 'text' }, { type: 'text' }])).not.toThrow()
  })
})
