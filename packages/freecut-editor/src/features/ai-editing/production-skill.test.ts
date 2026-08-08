// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { validateFinishedVideo } from './production-skill'
import { selectAiEditingSkill } from './skills/service'
import type { AiEditingSkill } from './skills/types'
import type { AiProjectEvidence } from './types'

const productSkill: AiEditingSkill = {
  id: 'product-showcase',
  name: 'product-showcase',
  description: '产品短片',
  instructions: '制作短片',
  triggers: ['成片', '原型'],
  toolIds: ['timeline.build_product_showcase'],
  requiresFinishedVideo: true,
  source: 'built-in',
  enabled: true,
}

function evidence(clips: AiProjectEvidence['clips'], durationSeconds: number): AiProjectEvidence {
  return { timelineRevision: 1, fps: 30, clips, durationSeconds, tracks: [], media: [] }
}

describe('AI editing production skill', () => {
  it('selects a matching enabled skill from its trigger catalog', () => {
    expect(selectAiEditingSkill('帮我把这个 UI 原型做成片', [productSkill])).toBe(productSkill)
    expect(selectAiEditingSkill('帮我做成片', [{ ...productSkill, enabled: false }])).toBeNull()
  })

  it('prefers a specialised blueprint skill when it ties a generic skill', () => {
    const blueprintSkill: AiEditingSkill = {
      ...productSkill,
      id: 'product-ui-launch',
      name: 'product-ui-launch',
      productionMode: 'blueprint',
    }
    expect(selectAiEditingSkill('帮我把这个 UI 原型做成片', [productSkill, blueprintSkill])).toBe(blueprintSkill)
  })

  it('does not accept text-only content as a finished video', () => {
    const result = validateFinishedVideo(evidence([
      { id: 'title-1', label: '标题', type: 'text', trackId: 'v1', startSeconds: 0, endSeconds: 60 },
      { id: 'title-2', label: '标题', type: 'text', trackId: 'v1', startSeconds: 60, endSeconds: 120 },
      { id: 'title-3', label: '标题', type: 'text', trackId: 'v1', startSeconds: 0, endSeconds: 120 },
    ], 120))
    expect(result.passed).toBe(false)
    expect(result.reasons.join('')).toContain('可见画面')
  })

  it('accepts a compact visual sequence with all story beats', () => {
    const result = validateFinishedVideo(evidence([
      { id: 'image-1', label: '界面原型', type: 'image', trackId: 'v1', startSeconds: 0, endSeconds: 8, mediaId: 'media-1' },
      { id: 'title-1', label: '开场', type: 'text', trackId: 'v2', startSeconds: 0, endSeconds: 2 },
      { id: 'title-2', label: '展示', type: 'text', trackId: 'v2', startSeconds: 2, endSeconds: 6 },
      { id: 'title-3', label: '收尾', type: 'text', trackId: 'v2', startSeconds: 6, endSeconds: 8 },
    ], 8))
    expect(result).toMatchObject({ passed: true, visualCoverage: 1 })
  })
})
