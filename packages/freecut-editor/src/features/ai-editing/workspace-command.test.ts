// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  read: vi.fn(),
  search: vi.fn(),
}))

vi.mock('./coding-workspace/session-registry', () => ({
  getTimelineCodingSession: () => ({
    workspace: mocks,
    repository: {},
  }),
}))

import { executeWorkspaceCommand } from './workspace-command'

describe('executeWorkspaceCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.list.mockReturnValue({ entries: [] })
    mocks.search.mockReturnValue({ matches: [] })
    mocks.read.mockReturnValue({ content: '' })
  })

  it('normalizes trailing slashes on directory arguments', async () => {
    await executeWorkspaceCommand(['ls', 'sequences/main///'])
    await executeWorkspaceCommand(['rg', '-n', 'mediaId', 'sequences/main/'])

    expect(mocks.list).toHaveBeenCalledWith({
      path: 'sequences/main',
      recursive: false,
      limit: 200,
    })
    expect(mocks.search).toHaveBeenCalledWith({
      query: 'mediaId',
      path: 'sequences/main',
      caseSensitive: true,
      limit: 200,
    })
  })

  it('does not turn an absolute root path into the virtual workspace root', async () => {
    await executeWorkspaceCommand(['ls', '/'])

    expect(mocks.list).toHaveBeenCalledWith({ path: '/', recursive: false, limit: 200 })
  })

  it.each([
    ['', '0\tempty.json'],
    ['first line', '0\tno-newline.json'],
    ['first line\n', '1\ttrailing-newline.json'],
    ['first\r\nsecond\r\n', '2\tcrlf.json'],
  ])('counts newline characters for wc -l', async (content, expected) => {
    const path = expected.slice(expected.indexOf('\t') + 1)
    mocks.read.mockReturnValue({ content })

    await expect(executeWorkspaceCommand(['wc', '-l', path])).resolves.toMatchObject({
      stdout: expected,
      exitCode: 0,
    })
  })
})
