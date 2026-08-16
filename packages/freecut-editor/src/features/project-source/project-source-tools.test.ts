import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => {
  const read = vi.fn()
  const list = vi.fn()
  const diff = vi.fn()
  return {
    read,
    list,
    diff,
    bridge: { read, list, diff },
  }
})

vi.mock('@freecut/shared/host/embedded-host', () => ({
  getEmbeddedHostBridge: () => ({ editingSourceGit: harness.bridge }),
}))
vi.mock('@freecut/features/editor/deps/projects', () => ({
  useProjectStore: { getState: () => ({ currentProject: { id: 'project-1' } }) },
}))
vi.mock('@freecut/features/editor/deps/timeline-store', () => ({
  useTimelineStore: { getState: () => ({}) },
}))
vi.mock('@freecut/features/project-source/project-source-worktree', () => ({
  readProjectSource: vi.fn(async () => ({ timeline: { items: [], tracks: [] } })),
}))

import { PROJECT_SOURCE_TOOLS } from './project-source-tools'

function getTool(name: string) {
  const tool = PROJECT_SOURCE_TOOLS.find((entry) => entry.name === name)
  if (!tool) throw new Error(`missing tool ${name}`)
  return tool
}

describe('project source tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    harness.list.mockResolvedValue([
      { path: 'manifest.json', name: 'manifest.json', type: 'file' },
      { path: 'sequences', name: 'sequences', type: 'directory' },
    ])
    harness.read.mockResolvedValue('{"version":4}\n')
  })

  it('does not expose a raw source mutation tool', () => {
    expect(PROJECT_SOURCE_TOOLS.some((tool) => tool.name === 'source.apply_changes')).toBe(false)
  })

  it('returns a bounded, structured source read', async () => {
    const result = await getTool('source.read').execute({ path: 'manifest.json', startLine: 1, endLine: 1 })
    expect(result.data).toMatchObject({ path: 'manifest.json', startLine: 1, endLine: 1 })
    expect((result.data as { content: string }).content).toContain('1:')
  })

  it('rejects an inverted source read range', () => {
    expect(getTool('source.read').validate({ path: 'manifest.json', startLine: 4, endLine: 2 })).toMatchObject({
      ok: false,
    })
  })
})
