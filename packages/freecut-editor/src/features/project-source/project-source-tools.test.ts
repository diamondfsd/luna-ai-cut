import { describe, expect, it, vi } from 'vitest'

vi.mock('@freecut/features/editor/deps/projects', () => ({
  useProjectStore: { getState: () => ({ currentProject: { id: 'project-1' } }) },
}))
vi.mock('@freecut/features/editor/deps/timeline-store', () => ({
  useTimelineStore: { getState: () => ({}) },
}))
import { EDITING_TOOLS } from './project-source-tools'

describe('editing capability tools', () => {
  it('does not expose source or raw timeline mutation tools', () => {
    expect(EDITING_TOOLS.some((tool) => tool.name.startsWith('source.'))).toBe(false)
    expect(EDITING_TOOLS.some((tool) => tool.name === 'source.apply_changes')).toBe(false)
    expect(EDITING_TOOLS.some((tool) => tool.name === 'timeline.validate')).toBe(false)
  })
})
