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
    expect(ids).toContain('timeline.compose_source')
    expect(ids).toContain('skill.read')
    expect(getAiEditingTool('skill.search')).toBeUndefined()
    expect(getAiEditingTool('skill.read')?.inputSchema).toMatchObject({
      required: ['name'],
      properties: { name: { type: 'string' } },
    })
    expect(getAiEditingTool('tool.load')).toBeUndefined()
    expect(getAiEditingTool('workspace.exec')).toBeUndefined()
    expect(getAiEditingTool('workflow.set_plan')).toBeUndefined()
  })
})
