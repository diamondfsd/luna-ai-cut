import { chmod, copyFile, mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { Page } from '@playwright/test'

import { expect, test } from './fixtures/lunaElectron'
import { createMotionPhoto, createTestVideo, sampleJpegPath } from './helpers/exportRecoveryAssets'

async function openExportHistory(page: Page) {
  await page.getByRole('button', { name: '导出记录' }).click()
  return page.getByRole('dialog', { name: '导出记录' })
}

test('recovers a mixed photo, video, and multiple Motion Photo batch', async ({ lunaApp }) => {
  const taskId = `e2e-local-mixed-recovery-${Date.now()}`
  const exportDir = path.join(lunaApp.temporaryRoot, 'downloads', 'local-mixed-export')
  const videoPath = path.join(lunaApp.temporaryRoot, 'motion-source.mp4')
  const firstMotionPhoto = path.join(lunaApp.temporaryRoot, 'motion-one.jpg')
  const secondMotionPhoto = path.join(lunaApp.temporaryRoot, 'motion-two.jpg')
  await mkdir(exportDir, { recursive: true })
  await createTestVideo(videoPath, 3)
  await Promise.all([
    createMotionPhoto(videoPath, firstMotionPhoto),
    createMotionPhoto(videoPath, secondMotionPhoto),
  ])

  const entries = [
    { id: 'photo', sourcePath: sampleJpegPath, outputPath: path.join(exportDir, 'photo.jpg'), kind: 'image' as const, index: 0, passthrough: true },
    { id: 'video', sourcePath: videoPath, outputPath: path.join(exportDir, 'video.mp4'), kind: 'video' as const, index: 1, passthrough: true },
    { id: 'motion-one', sourcePath: firstMotionPhoto, outputPath: path.join(exportDir, 'motion-one.jpg'), kind: 'image' as const, index: 2, isLivePhoto: true, passthrough: true },
    { id: 'motion-two', sourcePath: secondMotionPhoto, outputPath: path.join(exportDir, 'motion-two.jpg'), kind: 'image' as const, index: 3, isLivePhoto: true, passthrough: true },
  ]
  await copyFile(sampleJpegPath, entries[0].outputPath)
  const payload = {
    version: 1 as const,
    kind: 'local-media' as const,
    exportDir,
    taskName: 'E2E 图片、视频和 Live 图恢复',
    entries,
    exportConfig: null,
    appleLivePhoto: false,
  }

  await lunaApp.page.evaluate(async ({ taskId, payload, entries }) => {
    await window.luna.exportTask.create(payload.taskName, entries.map(({ id, sourcePath, outputPath }) => ({ id, sourcePath, outputPath })), taskId, payload)
    await window.luna.exportTask.updateItem(taskId, 'photo', { status: 'done', progress: 100 })
    for (const id of ['video', 'motion-one', 'motion-two']) {
      await window.luna.exportTask.updateItem(taskId, id, { status: 'exporting', progress: 36 })
    }
  }, { taskId, payload, entries })

  await lunaApp.restart()

  await expect.poll(async () => {
    const task = await lunaApp.page.evaluate(async (id) => (await window.luna.exportTask.list()).find((candidate) => candidate.id === id), taskId)
    return task && {
      status: task.status,
      resumable: task.resumable,
      items: task.items.map((item) => ({ id: item.id, status: item.status, progress: item.progress })),
    }
  }).toEqual({
    status: 'interrupted',
    resumable: true,
    items: [
      { id: 'photo', status: 'done', progress: 100 },
      { id: 'video', status: 'interrupted', progress: 0 },
      { id: 'motion-one', status: 'interrupted', progress: 0 },
      { id: 'motion-two', status: 'interrupted', progress: 0 },
    ],
  })

  const dialog = await openExportHistory(lunaApp.page)
  await dialog.getByRole('button', { name: '继续', exact: true }).click()

  await expect.poll(async () => {
    const task = await lunaApp.page.evaluate(async (id) => (await window.luna.exportTask.list()).find((candidate) => candidate.id === id), taskId)
    return task && { status: task.status, items: task.items.map((item) => item.status) }
  }, { timeout: 60_000, intervals: [100, 250, 500] }).toEqual({
    status: 'completed',
    items: ['done', 'done', 'done', 'done'],
  })

  const sourcePaths = [sampleJpegPath, videoPath, firstMotionPhoto, secondMotionPhoto]
  const outputPaths = entries.map((entry) => entry.outputPath)
  for (let index = 0; index < outputPaths.length; index += 1) {
    expect((await stat(outputPaths[index])).size).toBe((await stat(sourcePaths[index])).size)
  }
  expect(lunaApp.runtimeErrors).toEqual([])
})

test('recovers split outputs for multiple Apple Live Photos', async ({ lunaApp }) => {
  test.skip(process.platform !== 'darwin', 'Apple Live Photo export is available on macOS only')
  test.setTimeout(180_000)

  const taskId = `e2e-apple-live-recovery-${Date.now()}`
  const exportDir = path.join(lunaApp.temporaryRoot, 'downloads', 'apple-live-export')
  const videoPath = path.join(lunaApp.temporaryRoot, 'apple-live-source.mp4')
  const firstMotionPhoto = path.join(lunaApp.temporaryRoot, 'apple-live-one.jpg')
  const secondMotionPhoto = path.join(lunaApp.temporaryRoot, 'apple-live-two.jpg')
  const shimDir = path.join(lunaApp.temporaryRoot, 'test-bin')
  await Promise.all([
    mkdir(exportDir, { recursive: true }),
    mkdir(shimDir, { recursive: true }),
  ])
  await createTestVideo(videoPath, 3)
  await Promise.all([
    createMotionPhoto(videoPath, firstMotionPhoto),
    createMotionPhoto(videoPath, secondMotionPhoto),
  ])
  const osascriptShim = path.join(shimDir, 'osascript')
  await writeFile(osascriptShim, '#!/bin/sh\nexit 0\n', 'utf8')
  await chmod(osascriptShim, 0o755)

  const liveSources = [firstMotionPhoto, secondMotionPhoto]
  const layers = liveSources.map((sourcePath, index) => ({
    id: `motion-${index + 1}`,
    sourcePath,
    imageOutputPath: path.join(exportDir, `motion-${index + 1}.jpg`),
    appleOutputPath: path.join(exportDir, `motion-${index + 1}-apple.jpg`),
  }))
  const entries = layers.flatMap((item, index) => [
    {
      id: `motion-${index + 1}`,
      sourcePath: item.sourcePath,
      outputPath: item.imageOutputPath,
      layers: [{ filePath: sampleJpegPath, dstX: 0, dstY: 0, dstW: 1, dstH: 1, srcX: 0, srcY: 0, srcW: 1, srcH: 1, opacity: 1, zIndex: 0 }],
      outputSize: { width: 1280, height: 848 },
      passthrough: true,
      index: index * 2,
      kind: 'image' as const,
      isLivePhoto: true,
      role: 'media' as const,
    },
    {
      id: `motion-${index + 1}-apple`,
      sourcePath: item.sourcePath,
      outputPath: item.appleOutputPath,
      layers: [{ filePath: sampleJpegPath, dstX: 0, dstY: 0, dstW: 1, dstH: 1, srcX: 0, srcY: 0, srcW: 1, srcH: 1, opacity: 1, zIndex: 0 }],
      outputSize: { width: 1280, height: 848 },
      passthrough: true,
      index: index * 2 + 1,
      kind: 'image' as const,
      isLivePhoto: true,
      role: 'apple-live' as const,
    },
  ])
  const payload = {
    version: 1 as const,
    kind: 'local-media' as const,
    exportDir,
    taskName: 'E2E 多张 Apple Live 图恢复',
    entries,
    exportConfig: null,
    appleLivePhoto: true,
  }

  await lunaApp.page.evaluate(async ({ taskId, payload, entries }) => {
    await window.luna.exportTask.create(payload.taskName, entries.map(({ id, sourcePath, outputPath }) => ({ id, sourcePath, outputPath })), taskId, payload)
    for (const entry of entries) await window.luna.exportTask.updateItem(taskId, entry.id, { status: 'exporting', progress: 25 })
  }, { taskId, payload, entries })

  await lunaApp.restart({ PATH: `${shimDir}:${process.env.PATH ?? ''}` })
  await expect.poll(async () => {
    const task = await lunaApp.page.evaluate(async (id) => (await window.luna.exportTask.list()).find((candidate) => candidate.id === id), taskId)
    return task && { status: task.status, resumable: task.resumable, itemStatuses: task.items.map((item) => item.status) }
  }).toEqual({ status: 'interrupted', resumable: true, itemStatuses: ['interrupted', 'interrupted', 'interrupted', 'interrupted'] })

  const dialog = await openExportHistory(lunaApp.page)
  await dialog.getByRole('button', { name: '继续', exact: true }).click()
  await expect.poll(async () => {
    const task = await lunaApp.page.evaluate(async (id) => (await window.luna.exportTask.list()).find((candidate) => candidate.id === id), taskId)
    return task && { status: task.status, items: task.items.map((item) => ({ status: item.status, destinationPath: item.destinationPath })) }
  }, { timeout: 120_000, intervals: [250, 500, 1_000] }).toMatchObject({
    status: 'completed',
    items: [
      { status: 'done' },
      { status: 'done' },
      { status: 'done' },
      { status: 'done' },
    ],
  })

  const task = await lunaApp.page.evaluate(async (id) => (await window.luna.exportTask.list()).find((candidate) => candidate.id === id), taskId)
  const appleOutputs = task?.items.filter((item) => item.id.endsWith('-apple')) ?? []
  expect(appleOutputs).toHaveLength(2)
  for (const item of appleOutputs) {
    expect(item.destinationPath).toBeTruthy()
    expect((await stat(item.destinationPath!)).size).toBeGreaterThan(0)
    const pairedMovie = path.join(path.dirname(item.destinationPath!), `${path.basename(item.destinationPath!, '.jpg')}.mov`)
    expect((await stat(pairedMovie)).size).toBeGreaterThan(0)
  }
  expect(lunaApp.runtimeErrors).toEqual([])
})
