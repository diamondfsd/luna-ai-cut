import { expect, test } from './fixtures/lunaElectron'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

test('Luna 剪辑入口加载完整 OpenCut 编辑器', async ({ lunaApp }) => {
  const diagnosticErrors: string[] = []
  lunaApp.page.on('pageerror', (error) => diagnosticErrors.push(error.stack ?? error.message))
  lunaApp.page.on('console', (message) => {
    if (message.type() !== 'error') return
    const location = message.location()
    diagnosticErrors.push(`${message.text()} (${location.url}:${location.lineNumber}:${location.columnNumber})`)
  })
  await lunaApp.page.evaluate(() => {
    window.location.hash = '/video-editor'
  })

  await expect(lunaApp.page.locator('iframe')).toHaveCount(0)
  const createProject = lunaApp.page.getByRole('button', { name: 'Create your first project' })
  await expect(createProject).toBeVisible()
  await createProject.click()

  await lunaApp.page.getByRole('button', { name: 'Close' }).click({ timeout: 3_000 }).catch(() => undefined)

  for (const label of ['Media', 'Sounds', 'Text', 'Stickers', 'Effects', 'Captions', 'Settings']) {
    await expect(lunaApp.page.getByRole('button', { name: label })).toBeVisible()
  }

  await expect.poll(() => lunaApp.page.locator('.panel').count()).toBeGreaterThanOrEqual(3)
  await expect(lunaApp.page.locator('canvas').first()).toBeVisible()
  await expect(lunaApp.page.getByRole('textbox').first()).toHaveValue('New project')

  await lunaApp.page.getByRole('button', { name: 'Effects' }).click()
  const effectPreview = lunaApp.page.locator('canvas[aria-label="blur effect preview"]')
  await expect(effectPreview).toBeVisible()
  await expect.poll(async () => effectPreview.evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data
    return pixels ? pixels.some((value) => value !== 0) : false
  })).toBe(true)

  const nativeRender = await lunaApp.page.evaluate(async () => {
    const api = (window as unknown as { lunaRenderCore: {
      openCutInit(): Promise<void>
      openCutUpsertTexture(id: string, data: Uint8Array, width: number, height: number): Promise<void>
      openCutRenderFrame(frameJson: string): Promise<Uint8Array>
      openCutReleaseTexture(id: string): Promise<void>
    } }).lunaRenderCore
    const textureId = 'e2e-solid-red'
    await api.openCutInit()
    await api.openCutUpsertTexture(textureId, new Uint8Array([
      255, 0, 0, 255, 255, 0, 0, 255,
      255, 0, 0, 255, 255, 0, 0, 255,
    ]), 2, 2)
    const data = await api.openCutRenderFrame(JSON.stringify({
      width: 2,
      height: 2,
      clear: { color: [0, 0, 0, 1] },
      items: [{
        type: 'layer',
        textureId,
        transform: {
          centerX: 1,
          centerY: 1,
          width: 2,
          height: 2,
          rotationDegrees: 0,
          flipX: false,
          flipY: false,
        },
        opacity: 1,
        blendMode: 'normal',
        effectPassGroups: [],
        mask: null,
      }],
    }))
    await api.openCutReleaseTexture(textureId)
    return { length: data.byteLength, firstPixel: Array.from(data.slice(0, 4)) }
  })
  expect(nativeRender).toEqual({ length: 16, firstPixel: [255, 0, 0, 255] })

  const nativeBlur = await lunaApp.page.evaluate(async () => {
    const api = (window as unknown as { lunaRenderCore: {
      openCutInit(): Promise<void>
      openCutUpsertTexture(id: string, data: Uint8Array, width: number, height: number): Promise<void>
      openCutRenderFrame(frameJson: string): Promise<Uint8Array>
      openCutReleaseTexture(id: string): Promise<void>
    } }).lunaRenderCore
    const size = 5
    const textureId = 'e2e-blur-dot'
    const source = new Uint8Array(size * size * 4)
    for (let pixel = 0; pixel < size * size; pixel += 1) source[pixel * 4 + 3] = 255
    const centerOffset = ((2 * size) + 2) * 4
    source.set([255, 255, 255, 255], centerOffset)
    await api.openCutInit()
    await api.openCutUpsertTexture(textureId, source, size, size)
    try {
      const data = await api.openCutRenderFrame(JSON.stringify({
        width: size,
        height: size,
        clear: { color: [0, 0, 0, 1] },
        items: [{
          type: 'layer',
          textureId,
          transform: {
            centerX: size / 2,
            centerY: size / 2,
            width: size,
            height: size,
            rotationDegrees: 0,
            flipX: false,
            flipY: false,
          },
          opacity: 1,
          blendMode: 'normal',
          effectPassGroups: [[
            { shader: 'gaussian-blur', uniforms: { u_sigma: 2, u_step: 1, u_direction: [1, 0] } },
            { shader: 'gaussian-blur', uniforms: { u_sigma: 2, u_step: 1, u_direction: [0, 1] } },
          ]],
          mask: null,
        }],
      }))
      const adjacentOffset = ((2 * size) + 1) * 4
      return { center: data[centerOffset], adjacent: data[adjacentOffset] }
    } finally {
      await api.openCutReleaseTexture(textureId)
    }
  })
  expect(nativeBlur.center).toBeLessThan(255)
  expect(nativeBlur.adjacent).toBeGreaterThan(0)

  const projectsDir = path.join(lunaApp.temporaryRoot, 'user-data', 'opencut-editor', 'projects')
  await expect.poll(async () => (await readdir(projectsDir).catch(() => [])).filter((name) => name.endsWith('.json')).length).toBe(1)
  const [projectFile] = (await readdir(projectsDir)).filter((name) => name.endsWith('.json'))
  const savedProject = JSON.parse(await readFile(path.join(projectsDir, projectFile), 'utf8'))
  expect(savedProject.metadata.name).toBe('New project')
  expect(diagnosticErrors).toEqual([])
  expect(lunaApp.runtimeErrors).toEqual([])
})
