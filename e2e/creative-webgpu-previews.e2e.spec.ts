import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

import ffmpegPath from 'ffmpeg-static'
import type { Locator, Page } from '@playwright/test'

import { expect, test } from './fixtures/lunaElectron'

const execFileAsync = promisify(execFile)

async function renderedPixelCount(canvas: Locator): Promise<number> {
  return canvas.evaluate(async (element) => {
    const source = element as HTMLCanvasElement
    if (source.width === 0 || source.height === 0) return 0

    const image = new Image()
    image.src = source.toDataURL('image/png')
    await image.decode()

    const sample = document.createElement('canvas')
    sample.width = image.naturalWidth || source.width
    sample.height = image.naturalHeight || source.height
    const context = sample.getContext('2d')
    if (!context) return 0
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data
    let count = 0
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 30 && pixels[index + 3] > 10) count += 1
    }
    return count
  })
}

async function openCreative(
  page: Page,
  name: string,
  canvasSelector: string,
): Promise<Locator> {
  const panel = page.locator('.workspace-creative-panel-list')
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: new RegExp(name) }).click()

  const canvas = page.locator(canvasSelector)
  await expect(canvas).toBeVisible({ timeout: 30_000 })
  await expect(canvas).toHaveAttribute('data-renderer', 'webgpu')
  await expect.poll(() => renderedPixelCount(canvas), { timeout: 30_000 }).toBeGreaterThan(0)
  return canvas
}

test('五个创意都能通过 WebGPU 渲染真实画面', async ({ lunaApp }) => {
  if (!ffmpegPath) throw new Error('测试媒体生成工具不可用')
  const imagePaths = [0, 1, 2].map((index) => path.join(
    lunaApp.temporaryRoot,
    `creative-webgpu-source-${index + 1}.png`,
  ))
  await Promise.all(imagePaths.map((imagePath, index) => execFileAsync(ffmpegPath, [
    '-f', 'lavfi',
    '-i', 'testsrc2=size=320x180:rate=1',
    '-vf', `hue=h=${index * 55}`,
    '-frames:v', '1',
    '-y', imagePath,
  ])))

  const projectInfo = await lunaApp.page.evaluate(async ({ images }) => {
    const width = 320
    const height = 180
    const assets = [0, 1, 2].map((index) => ({
      id: `creative-webgpu-asset-${index + 1}`,
      name: `creative-webgpu-source-${index + 1}.png`,
      path: images[index],
      kind: 'image' as const,
    }))
    const project = await window.luna.workspace.createProject('五个创意 WebGPU E2E', assets)

    const subjectMask = new Uint8Array(width * height)
    for (let y = 45; y < 145; y += 1) {
      for (let x = 105; x < 215; x += 1) subjectMask[y * width + x] = 255
    }
    const skyMask = new Uint8Array(width * height)
    for (let y = 0; y < 70; y += 1) {
      for (let x = 0; x < width; x += 1) skyMask[y * width + x] = 255
    }
    const depthMask = new Uint8Array(width * height)
    for (let y = 20; y < 160; y += 1) {
      for (let x = 20; x < 300; x += 1) depthMask[y * width + x] = 255
    }

    const subjectPath = await window.luna.workspace.saveColorMask(
      project.id, 'creative-webgpu-subject', width, height, subjectMask, 1,
    )
    const skyPath = await window.luna.workspace.saveColorMask(
      project.id, 'creative-webgpu-sky', width, height, skyMask, 1,
    )
    const depthPath = await window.luna.workspace.saveColorMask(
      project.id, 'creative-webgpu-depth', width, height, depthMask, 1,
    )
    const stretchPath = await window.luna.workspace.saveColorMask(
      project.id, assets[0].id, width, height, subjectMask, 1,
    )

    const pixelFlow = {
      settingsVersion: 18,
      duration: 3,
      pixelCount: 120,
      lightWidth: 24,
      initialSaturation: 0,
      initialBrightness: 0,
      subjectDirection: 'down' as const,
      rainSpeed: 1,
      rainLength: 0.4,
      flowStrength: 1,
      subjectDelay: 0,
      bloomStrength: 0.3,
      filterStrength: 0.5,
      colorTransition: 0.5,
      maskPath: subjectPath.path,
      skyMaskPath: skyPath.path,
      depthMaskPath: depthPath.path,
      maskAssetId: assets[0].id,
    }
    const pixelStretch = {
      preset: 'right' as const,
      subjectModel: 'fast' as const,
      intensity: 100,
      angle: 0,
      samplePosition: 50,
      sampleEndPosition: 50,
      sampleLocked: false,
      ribbonSize: 44,
      sampleRangeStart: 28,
      sampleRangeEnd: 72,
      sampleControlStartOffset: 0,
      sampleControlEndOffset: 0,
      flowShape: 'straight' as const,
      flowLength: 95,
      flowCurve: 55,
      flowWidth: 108,
      flowEndWidth: 18,
      maskPath: stretchPath.path,
      maskAssetId: assets[0].id,
    }
    const onlyYourColor = {
      intensity: 100,
      subjectExposure: 0,
      backgroundExposure: 0,
      backgroundBrightness: 0,
      backgroundContrast: 0,
      subjectSaturation: 35,
      subjectVibrance: 20,
      subjectModel: 'fast' as const,
      maskPath: stretchPath.path,
      maskAssetId: assets[0].id,
      maskProjectId: project.id,
    }
    const pixelFlowByAssetId = Object.fromEntries(assets.map((asset) => [asset.id, {
      ...pixelFlow,
      maskAssetId: asset.id,
    }]))
    const pixelStretchByAssetId = Object.fromEntries(assets.map((asset) => [asset.id, {
      ...pixelStretch,
      maskAssetId: asset.id,
    }]))
    const onlyYourColorByAssetId = Object.fromEntries(assets.map((asset) => [asset.id, {
      ...onlyYourColor,
      maskAssetId: asset.id,
    }]))

    await window.luna.workspace.saveProject({
      ...project,
      creative: {
        pixelFlow,
        pixelFlowByAssetId,
        pixelStretch: pixelStretch,
        pixelStretchByAssetId,
        onlyYourColor: onlyYourColor,
        onlyYourColorByAssetId,
        colorReveal: {
          saturation: -100,
          gray: 35,
          transitionDuration: 1,
          initialHoldDuration: 0,
          midpointHoldDuration: 0,
          stageMode: 'three' as const,
        },
        tripleStitch: {
          selectedIds: assets.map((asset) => asset.id),
          activeSlot: 0,
          slotEdits: assets.map(() => ({ scale: 1, translateX: 0, translateY: 0, startTime: 0 })),
          watermarkStyle: 'luna_ultra_cn',
        },
      },
    })
    return { projectName: project.name }
  }, { images: imagePaths })

  await lunaApp.page.reload()
  await lunaApp.page.waitForLoadState('domcontentloaded')
  await lunaApp.page.evaluate(() => { window.location.hash = '#/workspace' })

  const project = lunaApp.page.locator('.workspace-project-open').filter({ hasText: projectInfo.projectName })
  await expect(project).toBeVisible()
  await project.click()
  await lunaApp.page.locator('.workspace-tool-rail button[aria-label="创意"]').click()

  await test.step('像素流光', async () => {
    await openCreative(lunaApp.page, '像素流光', 'canvas.pixel-flow-canvas')
    await lunaApp.page.getByRole('button', { name: '返回', exact: true }).click()
  })
  await test.step('只有你的色彩', async () => {
    await openCreative(lunaApp.page, '只有你的色彩', 'canvas.only-your-color-canvas')
    await lunaApp.page.getByRole('button', { name: '创意列表', exact: true }).click()
  })
  await test.step('像素拉伸', async () => {
    await openCreative(lunaApp.page, '像素拉伸', 'canvas.pixel-stretch-canvas')
    await lunaApp.page.getByRole('button', { name: '创意列表', exact: true }).click()
  })
  await test.step('色彩还原', async () => {
    await openCreative(lunaApp.page, '色彩还原', 'canvas.color-reveal-canvas')
    await lunaApp.page.getByRole('button', { name: '创意列表', exact: true }).click()
  })
  await test.step('Live 三拼', async () => {
    const canvas = await openCreative(lunaApp.page, 'Live 三拼', 'canvas.triple-stitch-canvas')
    await expect.poll(() => renderedPixelCount(canvas), { timeout: 30_000 }).toBeGreaterThan(10_000)
  })

  expect(lunaApp.runtimeErrors).toEqual([])
})
