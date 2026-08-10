// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { buildDirectExportFiles } from './direct-export-files'

describe('buildDirectExportFiles', () => {
  it('uses the project name, timestamp, and rendered MIME type', () => {
    const files = buildDirectExportFiles({
      blob: new Blob(['video'], { type: 'video/webm' }),
      mimeType: 'video/webm',
      duration: 1,
      fileSize: 5,
    }, '宝宝/小游戏', new Date(2026, 7, 10, 18, 30, 5))

    expect(files).toHaveLength(1)
    expect(files[0]?.fileName).toBe('宝宝_小游戏-20260810-183005.webm')
  })

  it('keeps a sidecar subtitle next to the rendered media', async () => {
    const files = buildDirectExportFiles({
      blob: new Blob(['video'], { type: 'video/mp4' }),
      mimeType: 'video/mp4',
      duration: 1,
      fileSize: 5,
      subtitleSidecar: { filename: 'subtitles.srt', content: '字幕内容' },
    }, '项目', new Date(2026, 7, 10, 18, 30, 5))

    expect(files.map((file) => file.fileName)).toEqual([
      '项目-20260810-183005.mp4',
      '项目-20260810-183005.srt',
    ])
    expect(await files[1]?.data.text()).toBe('字幕内容')
  })
})
