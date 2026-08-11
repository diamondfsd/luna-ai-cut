// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  search: vi.fn(),
  status: vi.fn(),
  diff: vi.fn(),
  log: vi.fn(),
}))

vi.mock('../coding-workspace/session-registry', () => ({
  getTimelineCodingSession: () => ({
    workspace: { list: mocks.list, search: mocks.search },
    repository: { status: mocks.status, diff: mocks.diff, log: mocks.log },
  }),
}))

import { aiEditingToolModule } from './coding-workspace-tools'

const tools = aiEditingToolModule.createTools({ listTools: () => [] })
const tool = (id: string) => tools.find((candidate) => candidate.id === id)!

describe('structured coding workspace tools', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes directory and search arguments without command parsing', async () => {
    mocks.list.mockReturnValue({ entries: [] })
    mocks.search.mockReturnValue({ matches: [] })

    const listArgs = tool('workspace.list').validate({
      path: 'media/', recursive: true, cursor: 2, limit: 25,
    })
    expect(listArgs.ok).toBe(true)
    if (!listArgs.ok) throw new Error(listArgs.error)
    await tool('workspace.list').execute(listArgs.value)
    await tool('workspace.search').execute({
      query: 'mediaId', path: 'sequences/main', caseSensitive: true, cursor: 3, limit: 10,
    })

    expect(mocks.list).toHaveBeenCalledWith({
      path: 'media', recursive: true, cursor: 2, limit: 25,
    })
    expect(mocks.search).toHaveBeenCalledWith({
      query: 'mediaId', path: 'sequences/main', caseSensitive: true, cursor: 3, limit: 10,
    })
  })

  it('delegates repository inspection to explicit git operations', async () => {
    mocks.status.mockResolvedValue({ clean: true })
    mocks.diff.mockResolvedValue({ files: [] })
    mocks.log.mockResolvedValue([{ oid: 'abc' }])

    await tool('git.status').execute({})
    await tool('git.diff').execute({})
    await tool('git.log').execute({ limit: 7 })

    expect(mocks.status).toHaveBeenCalledOnce()
    expect(mocks.diff).toHaveBeenCalledOnce()
    expect(mocks.log).toHaveBeenCalledWith(7)
  })

  it('rejects paths outside the virtual workspace', () => {
    expect(tool('workspace.list').validate({ path: '/media' }).ok).toBe(false)
    expect(tool('workspace.search').validate({ query: 'cat media/index.json', path: '..' }).ok)
      .toBe(false)
  })
})
