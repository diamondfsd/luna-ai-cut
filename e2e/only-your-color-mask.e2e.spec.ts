import { execFile } from 'node:child_process'
import { readFile, realpath, readdir } from 'node:fs/promises'
import { promisify } from 'node:util'
import path from 'node:path'

import ffmpegPath from 'ffmpeg-static'

import { expect, test } from './fixtures/lunaElectron'

const execFileAsync = promisify(execFile)

test('只有你的色彩不会加载其他项目的蒙版', async ({ lunaApp }) => {
  if (!ffmpegPath) throw new Error('测试媒体生成工具不可用')

  const imagePath = path.join(lunaApp.temporaryRoot, 'only-your-color-mask.png')
  await execFileAsync(ffmpegPath, [
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=64x64:rate=1',
    '-frames:v',
    '1',
    '-y',
    imagePath,
  ])

  const projectInfo = await lunaApp.page.evaluate(async ({ image }) => {
    const asset = { id: 'only-your-color-asset', name: 'only-your-color-mask.png', path: image, kind: 'image' as const }
    const project = await window.luna.workspace.createProject('只有你的色彩归属测试', [asset])
    const foreignProject = await window.luna.workspace.createProject('其他项目蒙版来源', [asset])
    const mask = new Uint8Array(64 * 64)
    for (let y = 16; y < 48; y += 1) {
      for (let x = 16; x < 48; x += 1) mask[y * 64 + x] = 255
    }
    const foreignMask = await window.luna.workspace.saveColorMask(
      foreignProject.id,
      asset.id,
      64,
      64,
      mask,
      1,
    )
    await window.luna.workspace.saveProject({
      ...project,
      creative: {
        onlyYourColorByAssetId: {
          [asset.id]: {
            intensity: 100,
            maskPath: foreignMask.path,
            maskAssetId: asset.id,
          },
        },
      },
    })
    return { projectId: project.id, projectName: project.name, foreignMaskPath: foreignMask.path }
  }, { image: imagePath })

  await lunaApp.page.reload()
  await lunaApp.page.waitForLoadState('domcontentloaded')
  await lunaApp.page.evaluate(() => { window.location.hash = '#/workspace' })

  const project = lunaApp.page.locator('.workspace-project-open').filter({ hasText: projectInfo.projectName })
  await expect(project).toBeVisible()
  await project.click()

  await lunaApp.page.locator('.workspace-tool-rail button[aria-label="创意"]').click()
  await lunaApp.page.getByRole('button', { name: /只有你的色彩/ }).click()
  await expect(lunaApp.page.locator('.only-your-color-page')).toBeVisible()
  const canvas = lunaApp.page.locator('canvas.only-your-color-canvas[data-renderer="webgpu"]')
  await expect(canvas).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => canvas.evaluate(async (element) => {
    const source = element as HTMLCanvasElement
    const image = new Image()
    image.src = source.toDataURL('image/png')
    await image.decode()
    const sample = document.createElement('canvas')
    sample.width = Math.max(1, source.width)
    sample.height = Math.max(1, source.height)
    const context = sample.getContext('2d')
    if (!context) return 0
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data
    let nonBlackPixels = 0
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 30 && pixels[index + 3] > 10) nonBlackPixels += 1
    }
    return nonBlackPixels
  }), { timeout: 30_000 }).toBeGreaterThan(0)
  await expect.poll(async () => (await lunaApp.page.locator('.toast-item').allTextContents()).join('\n'))
    .not.toContain('蒙版所属项目无效')

  const projectFile = path.join(lunaApp.baseDir, 'workspace-projects', projectInfo.projectId, 'project.json')
  const currentProjectDir = await realpath(path.join(lunaApp.baseDir, 'workspace-projects', projectInfo.projectId))
  const currentMasksDir = `${path.join(currentProjectDir, 'masks')}${path.sep}`
  await expect.poll(async () => {
    const saved = JSON.parse(await readFile(projectFile, 'utf8')) as {
      creative?: { onlyYourColorByAssetId?: Record<string, { maskPath?: string; maskProjectId?: string }> }
    }
    const state = saved.creative?.onlyYourColorByAssetId?.['only-your-color-asset']
    return {
      isCurrentProjectMask: state?.maskPath?.startsWith(currentMasksDir) ?? false,
      maskProjectId: state?.maskProjectId,
    }
  }, { timeout: 30_000 }).toEqual({ isCurrentProjectMask: true, maskProjectId: projectInfo.projectId })

  const logNames = await readdir(path.join(lunaApp.baseDir, 'logs'))
  const logText = await Promise.all(logNames
    .filter((name) => name.endsWith('.log'))
    .map((name) => readFile(path.join(lunaApp.baseDir, 'logs', name), 'utf8')))
  expect(logText.join('\n')).not.toContain('蒙版文件不属于当前项目')
  const finalProject = JSON.parse(await readFile(projectFile, 'utf8')) as {
    creative?: { onlyYourColorByAssetId?: Record<string, { maskPath?: string }> }
  }
  expect(finalProject.creative?.onlyYourColorByAssetId?.['only-your-color-asset']?.maskPath)
    .not.toBe(projectInfo.foreignMaskPath)
  expect(lunaApp.runtimeErrors).toEqual([])
})

test('只有你的色彩保留蒙版主体的原始颜色', async ({ lunaApp }) => {
  if (!ffmpegPath) throw new Error('测试媒体生成工具不可用')

  const imagePath = path.join(lunaApp.temporaryRoot, 'only-your-color-red.png')
  await execFileAsync(ffmpegPath, [
    '-f',
    'lavfi',
    '-i',
    'color=c=red:size=64x64:rate=1',
    '-frames:v',
    '1',
    '-y',
    imagePath,
  ])

  const projectInfo = await lunaApp.page.evaluate(async ({ image }) => {
    const asset = { id: 'only-your-color-red-asset', name: 'only-your-color-red.png', path: image, kind: 'image' as const }
    const project = await window.luna.workspace.createProject('只有你的色彩颜色测试', [asset])
    const maskData = new Uint8Array(64 * 64)
    for (let y = 16; y < 48; y += 1) {
      for (let x = 16; x < 48; x += 1) maskData[y * 64 + x] = 255
    }
    const mask = await window.luna.workspace.saveColorMask(project.id, asset.id, 64, 64, maskData, 1)
    await window.luna.workspace.saveProject({
      ...project,
      creative: {
        onlyYourColorByAssetId: {
          [asset.id]: {
            intensity: 100,
            subjectExposure: 0,
            backgroundExposure: 0,
            backgroundBrightness: 0,
            backgroundContrast: 0,
            subjectSaturation: 0,
            subjectVibrance: 0,
            maskPath: mask.path,
            maskAssetId: asset.id,
            maskProjectId: project.id,
          },
        },
      },
    })
    return { projectId: project.id, projectName: project.name }
  }, { image: imagePath })

  await lunaApp.page.reload()
  await lunaApp.page.waitForLoadState('domcontentloaded')
  await lunaApp.page.evaluate(() => { window.location.hash = '#/workspace' })

  const project = lunaApp.page.locator('.workspace-project-open').filter({ hasText: projectInfo.projectName })
  await expect(project).toBeVisible()
  await project.click()
  await lunaApp.page.locator('.workspace-tool-rail button[aria-label="创意"]').click()
  await lunaApp.page.getByRole('button', { name: /只有你的色彩/ }).click()
  await expect(lunaApp.page.locator('.only-your-color-page')).toBeVisible()

  const canvas = lunaApp.page.locator('canvas.only-your-color-canvas[data-renderer="webgpu"]')
  await expect(canvas).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => canvas.evaluate(async (element) => {
    const source = element as HTMLCanvasElement
    const image = new Image()
    image.src = source.toDataURL('image/png')
    await image.decode()
    const sample = document.createElement('canvas')
    sample.width = Math.max(1, source.width)
    sample.height = Math.max(1, source.height)
    const context = sample.getContext('2d')
    if (!context) return null
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data
    const pixelAt = (x: number, y: number) => {
      const index = (y * sample.width + x) * 4
      return [pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3]]
    }
    const center = pixelAt(Math.floor(sample.width / 2), Math.floor(sample.height / 2))
    const corner = pixelAt(2, 2)
    return {
      subjectIsRed: center[0] > 120 && center[1] < 80 && center[2] < 80 && center[3] > 200,
      backgroundIsGray: Math.max(corner[0], corner[1], corner[2]) - Math.min(corner[0], corner[1], corner[2]) < 8 && corner[3] > 200,
    }
  }), { timeout: 30_000 }).toEqual({ subjectIsRed: true, backgroundIsGray: true })
  expect(lunaApp.runtimeErrors).toEqual([])
})
