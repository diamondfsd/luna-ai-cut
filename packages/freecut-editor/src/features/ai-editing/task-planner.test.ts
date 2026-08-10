// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'
import type { AgentWorkspaceDocument } from './edit-program/types'
import {
  buildAiEditingTaskInstruction,
  parseAiEditingTaskPlan,
  scopeWorkspaceForTask,
  shouldUseAiEditingTaskMode,
} from './task-planner'
import { runSequentialAiEditingTasks } from './task-runner'

function workspace(): AgentWorkspaceDocument {
  return {
    schemaVersion: 1,
    revision: 4,
    project: { id: 'p1', title: '测试', width: 1920, height: 1080, fps: 30, duration: 20 },
    viewport: { playhead: 0, selectedClipRefs: ['clip:a'] },
    media: [
      { ref: 'media:a', name: 'A.mp4', kind: 'video', duration: 12, evidence: { visual: [], audioAnalysis: 'missing' } },
      { ref: 'media:b', name: 'B.mp4', kind: 'video', duration: 12, evidence: { visual: [], audioAnalysis: 'missing' } },
    ],
    tracks: [
      { ref: 'track:v1', name: '视频 1', kind: 'video', order: 0, locked: false },
      { ref: 'track:v2', name: '视频 2', kind: 'video', order: 1, locked: false },
    ],
    clips: [
      { ref: 'clip:a', label: 'A', type: 'video', trackRef: 'track:v1', start: 0, duration: 8, mediaRef: 'media:a' },
      { ref: 'clip:b', label: 'B', type: 'video', trackRef: 'track:v2', start: 12, duration: 8, mediaRef: 'media:b' },
    ],
    transitions: [],
  }
}

describe('AI editing task planning', () => {
  it('validates task kinds, references, ranges, and the 12-task limit', () => {
    const tasks = Array.from({ length: 14 }, (_, index) => ({
      title: `步骤 ${index + 1}`,
      instruction: '完成这个范围',
      kind: index === 1 ? 'unknown' : 'edit',
      range: { start: -2, end: 50 },
      mediaRefs: ['media:a', 'media:missing'],
    }))
    const parsed = parseAiEditingTaskPlan(JSON.stringify({ tasks }), workspace())
    expect(parsed).toHaveLength(11)
    expect(parsed[0]).toMatchObject({
      id: 'task-1',
      kind: 'edit',
      range: { start: 0, end: 20 },
      mediaRefs: ['media:a'],
    })
  })

  it('scopes clips, tracks, media, selections, and excludes unrelated context', () => {
    const scoped = scopeWorkspaceForTask(workspace(), {
      id: 'task-1',
      title: '片头',
      instruction: '只处理片头',
      kind: 'edit',
      range: { start: 0, end: 10 },
      mediaRefs: ['media:a'],
    })
    expect(scoped.clips.map((entry) => entry.ref)).toEqual(['clip:a'])
    expect(scoped.media.map((entry) => entry.ref)).toEqual(['media:a'])
    expect(scoped.tracks.map((entry) => entry.ref)).toEqual(['track:v1'])
    expect(JSON.stringify(scoped)).not.toContain('media:b')
  })

  it('uses task mode for broad goals while keeping small edits direct', () => {
    expect(shouldUseAiEditingTaskMode('整体剪成一分钟成片', workspace())).toBe(true)
    expect(shouldUseAiEditingTaskMode('加一个标题', { ...workspace(), media: [], clips: [] })).toBe(false)
  })

  it('passes only short completion summaries into the next task instruction', () => {
    const instruction = buildAiEditingTaskInstruction(
      '做完整视频',
      { id: 'task-2', title: '结尾', instruction: '补充结尾', kind: 'edit' },
      1,
      2,
      ['片头：已完成标题'],
    )
    expect(instruction).toContain('已完成：片头：已完成标题')
    expect(instruction).not.toContain('tool_call')
  })

  it('stops after a failed task and keeps later tasks pending', async () => {
    const updates = vi.fn()
    const runTask = vi.fn()
      .mockResolvedValueOnce({ reply: '第一步完成', observations: [], completed: true, completionNotes: [] })
      .mockResolvedValueOnce({ reply: '', observations: [], completed: false, completionNotes: ['素材不足'] })
    const tasks = ['片头', '主体', '复查'].map((title, index) => ({
      id: `task-${index + 1}`,
      title,
      instruction: title,
      kind: 'edit' as const,
    }))
    const result = await runSequentialAiEditingTasks(tasks, { runTask, onTaskActivity: updates })
    expect(runTask).toHaveBeenCalledTimes(2)
    expect(result.completed).toBe(false)
    expect(result.plan).toEqual(['片头', '主体', '复查'])
    expect(updates).toHaveBeenLastCalledWith(expect.objectContaining({ title: '主体', status: 'failed' }))
  })

  it('marks a thrown worker request as failed', async () => {
    const updates = vi.fn()
    const result = await runSequentialAiEditingTasks(
      [{ id: 'task-1', title: '片头', instruction: '制作片头', kind: 'edit' }],
      {
        runTask: vi.fn().mockRejectedValue(new Error('连接中断')),
        onTaskActivity: updates,
      },
    )
    expect(result).toMatchObject({ completed: false, completionNotes: ['连接中断'] })
    expect(updates).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed', message: '连接中断' }))
  })
})
