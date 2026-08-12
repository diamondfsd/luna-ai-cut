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
      }, {
        id: 'video', name: 'V1', kind: 'video', height: 60, locked: false,
        visible: true, muted: false, solo: false, order: 0,
      }],
      items: [{
        id: 'text-1', trackId: 'subtitle', type: 'text', label: '字幕',
        from: 0, durationInFrames: 90, text: '归一化字幕',
        transform: {
          x: 0, y: 367.2, width: 1536, height: 129.6,
          anchorX: 384, anchorY: 97.2, rotation: 4, opacity: 0.9,
        },
      }, {
        id: 'video-1', trackId: 'video', type: 'video', label: '画中画',
        from: 0, durationInFrames: 90, src: 'media:test',
        transform: { x: 320, y: -180, width: 640, height: 360 },
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
  return {
    read: async (path: string) => {
      const content = files[path]
      if (content === undefined) throw new Error(`missing ${path}`)
      return content
    },
    list: async (directory: string) => {
      const prefix = directory ? `${directory}/` : ''
      const entries = new Map<string, 'file' | 'directory'>()
      for (const path of Object.keys(files)) {
        if (!path.startsWith(prefix)) continue
        const remainder = path.slice(prefix.length)
        if (!remainder) continue
        const separator = remainder.indexOf('/')
        const name = separator < 0 ? remainder : remainder.slice(0, separator)
        entries.set(`${prefix}${name}`, separator < 0 ? 'file' : 'directory')
      }
      return [...entries].map(([path, type]) => ({ path, type }))
    },
  }
}

describe('project source normalized text layout', () => {
  it('discovers tracks and clip segments from the directory tree', async () => {
    const files = projectToSourceFiles(makeProject())

    expect(JSON.parse(files['sequences/main/sequence.json']!)).not.toHaveProperty('tracks')
    expect(JSON.parse(files['sequences/main/tracks/id-video/track.json']!))
      .not.toHaveProperty('segments')

    const restored = await projectFromSourceFiles(reader(files))
    expect(restored.timeline?.tracks.map((track) => track.id)).toEqual(['subtitle', 'video'])
    expect(restored.timeline?.items.map((item) => item.id)).toEqual(['text-1', 'video-1'])
  })

  it('does not duplicate the id prefix in generated track paths', () => {
    const project = makeProject()
    project.timeline!.tracks[1]!.id = 'id-video'
    project.timeline!.items[1]!.trackId = 'id-video'

    const files = projectToSourceFiles(project)
    expect(files).toHaveProperty('sequences/main/tracks/id-video/track.json')
    expect(files).not.toHaveProperty('sequences/main/tracks/id-id-video/track.json')
  })

  it('writes textBox in 0..1 and restores internal pixel transforms', async () => {
    const files = projectToSourceFiles(makeProject())
    const segments = clipSegments(files)
    const mainClip = segments.find(({ value }) => value.clips[0]?.id === 'text-1')!
      .value.clips[0]!
    const componentClip = segments.find(
      ({ value }) => value.clips[0]?.id === 'component-text',
    )!.value.clips[0]!
    const videoClip = segments.find(({ value }) => value.clips[0]?.id === 'video-1')!
      .value.clips[0]!

    expect(mainClip.textBox).toEqual({
      left: expect.closeTo(0.1),
      top: expect.closeTo(0.78),
      width: expect.closeTo(0.8),
      height: expect.closeTo(0.12),
    })
    expect(mainClip.transform).toEqual({ rotation: 4, opacity: 0.9 })
    expect(mainClip.textAnchor).toEqual({ x: 0.25, y: 0.75 })
    expect(componentClip.textBox).toEqual({
      left: expect.closeTo(0.2),
      top: expect.closeTo(0.3),
      width: expect.closeTo(0.5),
      height: expect.closeTo(0.2),
    })
    expect(videoClip.transform).toEqual({ x: 320, y: -180, width: 640, height: 360 })
    expect(videoClip).not.toHaveProperty('textBox')

    const restored = await projectFromSourceFiles(reader(files))
    expect(restored.timeline?.items[0]?.transform).toMatchObject({
      x: expect.closeTo(0),
      y: expect.closeTo(367.2),
      width: expect.closeTo(1536),
      height: expect.closeTo(129.6),
      anchorX: expect.closeTo(384),
      anchorY: expect.closeTo(97.2),
      rotation: 4,
      opacity: 0.9,
    })
    expect(restored.timeline?.compositions?.[0]?.items[0]?.transform).toMatchObject({
      x: -50, y: -100, width: 500, height: 200,
    })
    expect(restored.timeline?.items.find((item) => item.id === 'video-1')?.transform).toEqual({
      x: 320, y: -180, width: 640, height: 360,
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
