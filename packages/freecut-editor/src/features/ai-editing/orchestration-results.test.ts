import { describe, expect, it } from 'vite-plus/test'
import { hasSourceChanges, hasUncommittedSourceWork } from './orchestration-results'

describe('AI editing source outcomes', () => {
  it('recognizes high-level source composition as a project change', () => {
    const observations = [{
      toolId: 'timeline.compose_source',
      result: { ok: true, message: 'composed', data: { changedFiles: ['manifest.json'] } },
    }]

    expect(hasSourceChanges(observations)).toBe(true)
    expect(hasUncommittedSourceWork(observations)).toBe(true)
  })
})
