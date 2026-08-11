// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'

vi.mock('./tool-registry', () => ({
  listAiEditingTools: () => [
    { id: 'media.list' },
    { id: 'source.read' },
    { id: 'git.diff' },
  ],
}))

import { AiEditingToolSet } from './tool-set'

describe('AiEditingToolSet', () => {
  it('makes every allowed tool active immediately', () => {
    const tools = new AiEditingToolSet()

    expect([...tools.availableToolIds]).toEqual(['media.list', 'source.read', 'git.diff'])
    expect(tools.availableToolIds.has('tool.load')).toBe(false)
  })

  it('applies the configured allowlist to the complete tool set', () => {
    const tools = new AiEditingToolSet(new Set(['media.list', 'missing.tool']))

    expect([...tools.availableToolIds]).toEqual(['media.list'])
  })
})
