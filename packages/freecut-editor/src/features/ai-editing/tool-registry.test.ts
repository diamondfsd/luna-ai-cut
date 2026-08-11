import { describe, expect, it } from 'vite-plus/test'
import { listAiEditingTools } from './tool-registry'

describe('AI editing tool surface', () => {
  it('exposes the coding workspace plus bounded legacy and evidence tools', () => {
    expect(
      listAiEditingTools()
        .map((tool) => tool.id)
        .toSorted(),
    ).toEqual([
      'analysis.request',
      'analysis.search_transcript',
      'audio.analyze_beats',
      'git.branch',
      'git.commit',
      'git.diff',
      'git.log',
      'git.status',
      'html.read',
      'html.validate',
      'skill.read',
      'skill.search',
      'timeline.build',
      'timeline.check',
      'timeline.commit',
      'timeline.diff',
      'timeline.publish_stage',
      'timeline.test',
      'workflow.set_plan',
      'workspace.list',
      'workspace.patch',
      'workspace.read',
      'workspace.search',
      'workspace.status',
    ])
  })
})
