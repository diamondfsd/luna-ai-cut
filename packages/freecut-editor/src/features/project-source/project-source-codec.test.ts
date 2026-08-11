// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { Project } from '@freecut/types/project'
import { projectFromSourceFiles, projectToSourceFiles } from './project-source-codec'

function makeProject(): Project {
  return {
    id: 'project-1',
    name: 'normalized text source',
    description: '',
    createdAt: 1,
    updatedAt: 2,
    duration: 10,
    metadata: { width: 1920, height: 1080, fps: 30 },
    timeline: {
      tracks: [{
        id: 'subtitle', name: 'S1', kind: 'subtitle', height: 40, locked: false,
        visible: true, muted: false, solo: false, order: -1,
      }],
      items: [{
        id: 'text-1', trackId: 'subtitle', type: 'text', label: '字幕',
        from: 0, durationInFrames: 90, text: '归一化字幕',
        transform: {
          x: 0, y: 367.2, width: 1536, height: 129.6,
          rotation: 4, opacity: 0.9,
        },
      }],
      compositions: [{
        id: 'component-1',
        name: '方形组件',
        editorKind: 'composite-2d',
        width: 1000,
        height: 1000,
        fps: 30,
        durationInFrames: 120,
        tracks: [{
          id: 'component-subtitle', name: 'S1', kind: 'subtitle', height: 40,
          locked: false, visible: true, muted: false, solo: false, order: -1,
        }],
        items: [{
          id: 'component-text', trackId: 'component-subtitle', type: 'text',
          label: '组件文字', from: 0, durationInFrames: 90, text: '组件',
          transform: { x: -50, y: -100, width: 500, height: 200 },
        }],
      }],
    },
  } as Project
}

function clipSegments(files: Record<string, string>): Array<{
  path: string
  value: { clips: Array<Record<string, unknown>> }
}> {
  return Object.entries(files)
    .filter(([path]) => path.includes('/segments/'))
    .map(([path, content]) => ({ path, value: JSON.parse(content) }))
}

function reader(files: Record<string, string>) {
  return { read: async (path: string) => {
    const content = files[path]
    if (content === undefined) throw new Error(`missing ${path}`)
    return content
  } }
}

describe('project source normalized text layout', () => {
  it('writes textBox in 0..1 and restores internal pixel transforms', async () => {
    const files = projectToSourceFiles(makeProject())
    const segments = clipSegments(files)
    const mainClip = segments.find(({ value }) => value.clips[0]?.id === 'text-1')!
      .value.clips[0]!
    const componentClip = segments.find(
      ({ value }) => value.clips[0]?.id === 'component-text',
    )!.value.clips[0]!

    expect(mainClip.textBox).toEqual({ left: 0.1, top: 0.78, width: 0.8, height: 0.12 })
    expect(mainClip.transform).toEqual({ rotation: 4, opacity: 0.9 })
    expect(componentClip.textBox).toEqual({ left: 0.2, top: 0.3, width: 0.5, height: 0.2 })

    const restored = await projectFromSourceFiles(reader(files))
    expect(restored.timeline?.items[0]?.transform).toMatchObject({
      x: 0, y: 367.2, width: 1536, height: 129.6, rotation: 4, opacity: 0.9,
    })
    expect(restored.timeline?.compositions?.[0]?.items[0]?.transform).toMatchObject({
      x: -50, y: -100, width: 500, height: 200,
    })
  })

  it('encodes default text layout as the full normalized canvas', () => {
    const project = makeProject()
    project.timeline!.items[0]!.transform = undefined
    const sourceClip = clipSegments(projectToSourceFiles(project))
      .find(({ value }) => value.clips[0]?.id === 'text-1')!.value.clips[0]!

    expect(sourceClip.textBox).toEqual({ left: 0, top: 0, width: 1, height: 1 })
    expect(sourceClip).not.toHaveProperty('transform')
  })

  it('rejects pixel layout fields and out-of-range textBox values in source', async () => {
    const pixelFiles = projectToSourceFiles(makeProject())
    const pixelSegment = clipSegments(pixelFiles).find(
      ({ value }) => value.clips[0]?.id === 'text-1',
    )!
    pixelSegment.value.clips[0]!.transform = { x: 960 }
    pixelFiles[pixelSegment.path] = `${JSON.stringify(pixelSegment.value)}\n`
    await expect(projectFromSourceFiles(reader(pixelFiles))).rejects.toThrow(/transform.x/)

    const rangeFiles = projectToSourceFiles(makeProject())
    const rangeSegment = clipSegments(rangeFiles).find(
      ({ value }) => value.clips[0]?.id === 'text-1',
    )!
    rangeSegment.value.clips[0]!.textBox = { left: 0.1, top: 0.95, width: 0.8, height: 0.12 }
    rangeFiles[rangeSegment.path] = `${JSON.stringify(rangeSegment.value)}\n`
    await expect(projectFromSourceFiles(reader(rangeFiles))).rejects.toThrow(/0 到 1/)
  })
})
