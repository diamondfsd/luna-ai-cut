import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => {
  const applyChanges = vi.fn()
  const read = vi.fn()
  const list = vi.fn()
  const diff = vi.fn()
  const loadTimeline = vi.fn()
  return {
    applyChanges,
    read,
    list,
    diff,
    loadTimeline,
    bridge: { applyChanges, read, list, diff },
  }
})

vi.mock('@freecut/shared/host/embedded-host', () => ({
  getEmbeddedHostBridge: () => ({ editingSourceGit: harness.bridge }),
}))
vi.mock('@freecut/features/editor/deps/projects', () => ({
  useProjectStore: { getState: () => ({ currentProject: { id: 'project-1' } }) },
}))
vi.mock('@freecut/features/editor/deps/timeline-store', () => ({
  useTimelineStore: { getState: () => ({ loadTimeline: harness.loadTimeline }) },
}))
vi.mock('@freecut/features/project-source/project-source-worktree', () => ({
  readProjectSource: vi.fn(async () => ({ timeline: { items: [], tracks: [] } })),
}))
vi.mock('@freecut/features/project-source/project-source-write-ownership', () => ({
  acquireAiEditingSourceWriteOwnership: () => vi.fn(),
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
    harness.applyChanges.mockResolvedValue(undefined)
    harness.read.mockResolvedValue('{"version":4}\n')
    harness.loadTimeline.mockResolvedValue(undefined)
  })

  it('rejects an ambiguous or incomplete source change before executing it', async () => {
    const tool = getTool('source.apply_changes')
    expect(tool.validate({ changes: [{ path: 'manifest.json', content: '{}' }] })).toMatchObject({ ok: false })
    expect(harness.applyChanges).not.toHaveBeenCalled()
  })

  it('applies expected-content changes and reloads the timeline', async () => {
    const result = await getTool('source.apply_changes').execute({
      changes: [{ path: 'manifest.json', expectedContent: '{"version":4}\n', content: '{"version":4,"name":"Demo"}\n' }],
    })
    expect(result.ok).toBe(true)
    expect(harness.applyChanges).toHaveBeenCalledWith('project-1', [
      { path: 'manifest.json', expectedContent: '{"version":4}\n', content: '{"version":4,"name":"Demo"}\n' },
    ])
    expect(harness.loadTimeline).toHaveBeenCalledWith('project-1')
  })

  it('returns a bounded, structured source read', async () => {
    const result = await getTool('source.read').execute({ path: 'manifest.json', startLine: 1, endLine: 1 })
    expect(result.data).toMatchObject({ path: 'manifest.json', startLine: 1, endLine: 1 })
    expect((result.data as { content: string }).content).toContain('1:')
  })
})
