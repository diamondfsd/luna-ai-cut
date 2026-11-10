import { mkdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import type { WorkspaceExportTaskPayload, WorkspaceProjectAsset } from '../src/shared/types'
import { expect, test } from './fixtures/lunaElectron'
import {
  createRenderColor,
  createRenderLayer,
  createTestLut,
  createTestVideo,
  sampleJpegPath,
} from './helpers/exportRecoveryAssets'

test('recovers workbench exports with color, LUT, video, and multiple Live Photo segments', async ({ lunaApp }) => {
  test.setTimeout(180_000)
  const taskId = `e2e-workspace-export-recovery-${Date.now()}`
  const exportDir = path.join(lunaApp.temporaryRoot, 'downloads', 'workspace-export')
  const videoPath = path.join(lunaApp.temporaryRoot, 'workbench-video.mp4')
  const lutPath = path.join(lunaApp.temporaryRoot, 'e2e-warm-shift.cube')
  const projectName = `E2E 调色 LUT ${Date.now()}`
  const videoDuration = 6
  await mkdir(exportDir, { recursive: true })
  await Promise.all([
    createTestVideo(videoPath, videoDuration),
    createTestLut(lutPath),
  ])

  const color = createRenderColor()
  const videoColor = { ...color, exposure: 0.2, contrast: 18, saturation: 15 }
  const stillLayer = createRenderLayer(sampleJpegPath, { color, lutPath })
  const videoLayer = createRenderLayer(videoPath, { video: true, color: videoColor, lutPath })
  const photoPlan = {
    id: 'workbench-photo',
    kind: 'photo' as const,
    sourcePath: sampleJpegPath,
    outputBaseName: 'graded-photo',
    layers: [stillLayer],
    outputSize: { width: 1280, height: 848 },
    isLivePhoto: false,
  }
  const videoPlan = {
    id: 'workbench-video',
    kind: 'video' as const,
    sourcePath: videoPath,
    outputBaseName: 'graded-video',
    layers: [videoLayer],
    outputSize: { width: 320, height: 180 },
    sourceDuration: videoDuration,
    startTime: 0,
    endTime: videoDuration,
  }
  const firstLivePlan = {
    id: 'live-segment-one',
    kind: 'live' as const,
    sourcePath: videoPath,
    outputBaseName: 'graded-video-live-one',
    layers: [videoLayer],
    outputSize: { width: 320, height: 180 },
    sourceDuration: videoDuration,
    startTime: 0,
    endTime: 3,
    coverTime: 1.5,
  }
  const secondLivePlan = {
    id: 'live-segment-two',
    kind: 'live' as const,
    sourcePath: videoPath,
    outputBaseName: 'graded-video-live-two',
    layers: [videoLayer],
    outputSize: { width: 320, height: 180 },
    sourceDuration: videoDuration,
    startTime: 3,
    endTime: 6,
    coverTime: 4.5,
  }
  const payload: WorkspaceExportTaskPayload = {
    version: 1,
    kind: 'workspace',
    exportDir,
    taskName: 'E2E 工作台调色、LUT 与多 Live 导出',
    stamp: Date.now(),
    entries: [
      { id: 'workbench-photo-output', plan: photoPlan, format: 'photo', outputPath: path.join(exportDir, 'graded-photo.jpg'), label: '照片' },
      { id: 'workbench-video-output', plan: videoPlan, format: 'video', outputPath: path.join(exportDir, 'graded-video.mp4'), label: '普通视频' },
      { id: 'live-one-output', plan: firstLivePlan, format: 'google-live', outputPath: path.join(exportDir, 'graded-video-live-one.jpg'), label: 'Live 图' },
      { id: 'live-two-output', plan: secondLivePlan, format: 'google-live', outputPath: path.join(exportDir, 'graded-video-live-two.jpg'), label: 'Live 图' },
    ],
    config: {
      resolution: 'original',
      frameRate: 'original',
      quality: 'low',
      includeAudio: false,
      exportFormats: ['video', 'google-live'],
      exportPhotos: true,
      exportLiveVideo: false,
      liveStartTime: 0,
      liveCoverTime: 1.5,
      trimStartTime: 0,
    },
    adjustableVideoId: videoPlan.id,
  }

  const colorPipeline = {
    exposure: videoColor.exposure,
    brightness: videoColor.brightness,
    temperature: videoColor.temperature,
    tint: videoColor.tint,
    contrast: videoColor.contrast,
    saturation: videoColor.saturation,
    vibrance: videoColor.vibrance,
    highlights: videoColor.highlights,
    shadows: videoColor.shadows,
  }
  const videoAsset = {
    id: 'workbench-video-asset',
    name: 'workbench-video.mp4',
    path: videoPath,
    kind: 'video' as const,
  }
  const photoAsset = {
    id: 'workbench-photo-asset',
    name: 'workbench-photo.jpg',
    path: sampleJpegPath,
    kind: 'image' as const,
  }
  const projectAssets = [
    Object.assign(photoAsset, {
      pipeline: { color: { exposure: color.exposure, contrast: color.contrast, saturation: color.saturation }, lutFilter: { activeId: lutPath, intensity: 72 } },
    }),
    Object.assign(videoAsset, {
      pipeline: {
        color: colorPipeline,
        lutFilter: { activeId: lutPath, intensity: 72 },
        outputMarkers: [
          { id: 'live-segment-one', kind: 'live', startTime: 0, endTime: 3, coverTime: 1.5, note: '第一段' },
          { id: 'live-segment-two', kind: 'live', startTime: 3, endTime: 6, coverTime: 4.5, note: '第二段' },
        ],
      },
    }),
  ] satisfies WorkspaceProjectAsset[]

  await lunaApp.page.evaluate(async ({ projectName, projectAssets, taskId, payload }) => {
    await window.luna.workspace.createProject(projectName, projectAssets)
    const entries = payload.entries.map((entry) => ({
      id: entry.id,
      sourcePath: entry.plan.sourcePath,
      outputPath: entry.outputPath,
      label: entry.label,
    }))
    await window.luna.exportTask.create(payload.taskName, entries, taskId, payload)
    for (const entry of entries) await window.luna.exportTask.updateItem(taskId, entry.id, { status: 'exporting', progress: 28 })
  }, { projectName, projectAssets, taskId, payload })

  const payloadPath = path.join(lunaApp.temporaryRoot, 'downloads', 'cache', 'export-task-payloads', `${taskId}.json`)
  const persistedBeforeRestart = JSON.parse(await readFile(payloadPath, 'utf8')) as WorkspaceExportTaskPayload
  expect(persistedBeforeRestart.kind).toBe('workspace')
  expect(persistedBeforeRestart.entries.filter((entry) => entry.plan.kind === 'live')).toHaveLength(2)
  expect(persistedBeforeRestart.entries.every((entry) => entry.plan.layers[0].lutId === lutPath)).toBe(true)
  expect(persistedBeforeRestart.entries.every((entry) => entry.plan.layers[0].lutIntensity === 72)).toBe(true)
  expect(persistedBeforeRestart.entries[0].plan.layers[0].color).toMatchObject({ exposure: 0.35, contrast: 14, saturation: 12 })

  await lunaApp.restart()
  await expect.poll(async () => {
    const task = await lunaApp.page.evaluate(async (id) => (await window.luna.exportTask.list()).find((candidate) => candidate.id === id), taskId)
    return task && { status: task.status, resumable: task.resumable, itemStatuses: task.items.map((item) => item.status) }
  }).toEqual({
    status: 'interrupted',
    resumable: true,
    itemStatuses: ['interrupted', 'interrupted', 'interrupted', 'interrupted'],
  })

  const projects = await lunaApp.page.evaluate(() => window.luna.workspace.listProjects())
  const restoredProject = projects.find((project) => project.name === projectName)
  expect(restoredProject).toBeTruthy()
  expect(restoredProject?.assets[1].pipeline).toMatchObject({
    lutFilter: { activeId: lutPath, intensity: 72 },
    outputMarkers: [
      { id: 'live-segment-one', kind: 'live', startTime: 0, endTime: 3, coverTime: 1.5 },
      { id: 'live-segment-two', kind: 'live', startTime: 3, endTime: 6, coverTime: 4.5 },
    ],
  })
  const persistedAfterRestart = JSON.parse(await readFile(payloadPath, 'utf8')) as WorkspaceExportTaskPayload
  expect(persistedAfterRestart).toEqual(persistedBeforeRestart)

  await lunaApp.page.getByRole('button', { name: '导出记录' }).click()
  const dialog = lunaApp.page.getByRole('dialog', { name: '导出记录' })
  await dialog.getByRole('button', { name: '继续', exact: true }).click()

  await expect.poll(async () => {
    const task = await lunaApp.page.evaluate(async (id) => (await window.luna.exportTask.list()).find((candidate) => candidate.id === id), taskId)
    return task && { status: task.status, itemStatuses: task.items.map((item) => item.status) }
  }, { timeout: 120_000, intervals: [250, 500, 1_000] }).toEqual({
    status: 'completed',
    itemStatuses: ['done', 'done', 'done', 'done'],
  })

  const completedTask = await lunaApp.page.evaluate(async (id) => (await window.luna.exportTask.list()).find((candidate) => candidate.id === id), taskId)
  expect(completedTask?.items).toHaveLength(4)
  for (const item of completedTask?.items ?? []) {
    expect(item.destinationPath).toBeTruthy()
    expect((await stat(item.destinationPath!)).size).toBeGreaterThan(0)
  }
  for (const item of completedTask?.items.filter((candidate) => candidate.id.startsWith('live-')) ?? []) {
    expect(await lunaApp.page.evaluate((filePath) => window.luna.workspace.isLivePhoto(filePath), item.destinationPath!)).toBe(true)
  }
  expect(lunaApp.runtimeErrors).toEqual([])
})
