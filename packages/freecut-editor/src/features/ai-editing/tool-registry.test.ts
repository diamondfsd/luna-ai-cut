import { describe, expect, it } from 'vite-plus/test'
import { getAiEditingTool, listAiEditingTools } from './tool-registry'

describe('AI editing tool registry', () => {
  it('exposes the structured catalog without deferred or command tools', () => {
    const ids = listAiEditingTools().map((tool) => tool.id)

    expect(ids).toContain('media.list')
    expect(ids).toContain('media.read')
    expect(ids).toContain('workspace.list')
    expect(ids).toContain('workspace.search')
    expect(ids).toContain('git.diff')
    expect(getAiEditingTool('tool.load')).toBeUndefined()
    expect(getAiEditingTool('workspace.exec')).toBeUndefined()
  })
})
