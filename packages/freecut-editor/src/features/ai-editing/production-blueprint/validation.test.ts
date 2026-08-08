// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { AiProjectEvidence } from '../types'
import { parseProductUiLaunchBlueprint, reviewProductUiLaunch } from './validation'

const media: AiProjectEvidence['media'] = [{
  mediaId: 'ui-image',
  name: 'ui.png',
  kind: 'image',
  durationSeconds: 0,
  sourceFingerprint: 'image-1',
  visual: [{ timeSeconds: 0, description: '剪辑器界面和时间轴', subjects: ['界面', '时间轴'] }],
  audio: { beatStatus: 'not-requested' },
}]

const source = {
  version: 1,
  title: '挑战一个人做出剪映 Day 01',
  audience: '关注剪辑工具的创作者',
  promise: '直接展示这次界面重构的真实成果',
  tone: '克制的产品发布感',
  aspectRatio: '16:9',
  replaceExisting: true,
  shots: [
    { id: 'SHOT-01', mediaId: 'ui-image', region: 'overview', durationSeconds: 2, purpose: '开场钩子', evidence: '完整剪辑器界面', camera: 'push-in', caption: '挑战一个人做出剪映' },
    { id: 'SHOT-02', mediaId: 'ui-image', region: 'top-left', durationSeconds: 2, purpose: '展示素材区域', evidence: '左上素材区域', camera: 'pan-right' },
    { id: 'SHOT-03', mediaId: 'ui-image', region: 'toolbar', durationSeconds: 2, purpose: '展示工具栏', evidence: '中部工具栏', camera: 'pan-left', caption: '第一天，UI重构' },
    { id: 'SHOT-04', mediaId: 'ui-image', region: 'timeline', durationSeconds: 2, purpose: '展示时间轴', evidence: '底部时间轴', camera: 'pan-right' },
    { id: 'SHOT-05', mediaId: 'ui-image', region: 'overview', durationSeconds: 2, purpose: '完整收束', evidence: '完整剪辑器界面', camera: 'pull-out', caption: '明天继续' },
  ],
}

function evidence(clips: AiProjectEvidence['clips'] = [], durationSeconds = 10): AiProjectEvidence {
  return { timelineRevision: 1, fps: 30, clips, durationSeconds, media }
}

describe('product UI launch blueprint', () => {
  it('accepts real analysed UI evidence with named story beats', () => {
    expect(parseProductUiLaunchBlueprint(JSON.stringify(source), evidence())).toMatchObject({
      title: source.title,
      shots: expect.arrayContaining([expect.objectContaining({ id: 'SHOT-04', region: 'timeline' })]),
    })
  })

  it('rejects a plan without analysed material evidence', () => {
    expect(() => parseProductUiLaunchBlueprint(JSON.stringify({
      ...source,
      shots: source.shots.map((shot) => ({ ...shot, mediaId: 'unanalysed-image' })),
    }), evidence())).toThrow('未完成画面分析')
  })

  it('reviews the compiled timeline against every planned shot', () => {
    const blueprint = parseProductUiLaunchBlueprint(JSON.stringify(source), evidence())
    const clips: AiProjectEvidence['clips'] = [
      ...source.shots.map((shot, index) => ({ id: shot.id, label: shot.id, type: 'image' as const, trackId: 'video', startSeconds: index * 2, endSeconds: (index + 1) * 2, mediaId: 'ui-image' })),
      { id: 'title-1', label: '开场', type: 'text', trackId: 'overlay', startSeconds: 0, endSeconds: 2 },
      { id: 'title-2', label: '展示', type: 'text', trackId: 'overlay', startSeconds: 4, endSeconds: 6 },
      { id: 'title-3', label: '收尾', type: 'text', trackId: 'overlay', startSeconds: 8, endSeconds: 10 },
    ]
    expect(reviewProductUiLaunch(blueprint, evidence(clips))).toMatchObject({ passed: true, expectedShotCount: 5, actualVisualCount: 5 })
  })
})
