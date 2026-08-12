import { describe, expect, it } from 'vite-plus/test'
import { isDirectEditingRequest, resolveAiEditingTurnIntent } from './conversation-intent'

describe('AI editing direct edit intent', () => {
  it('requires execution for the subtitle-to-narration request from the regression', () => {
    const request = '帮我将字幕删除掉， 改成独立的旁白 你设计一下'

    expect(isDirectEditingRequest(request)).toBe(true)
    expect(resolveAiEditingTurnIntent(request, [])).toEqual({ kind: 'execute-edit' })
  })

  it('keeps questions and script design requests conversational', () => {
    expect(isDirectEditingRequest('能不能帮我删除字幕？')).toBe(false)
    expect(isDirectEditingRequest('帮我设计一个抖音脚本')).toBe(false)
  })
})
