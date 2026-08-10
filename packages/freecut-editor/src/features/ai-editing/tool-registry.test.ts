import { describe, expect, it } from 'vite-plus/test'
import { listAiEditingTools } from './tool-registry'

describe('AI editing tool surface', () => {
  it('exposes one editing surface plus bounded evidence acquisition', () => {
    expect(listAiEditingTools().map((tool) => tool.id).toSorted()).toEqual([
      'analysis.request',
      'analysis.search_transcript',
      'audio.analyze_beats',
      'html.read',
      'html.validate',
      'skill.read',
      'skill.search',
      'workflow.finish',
      'workflow.set_plan',
      'workspace.apply_edit_program',
    ])
  })
})
