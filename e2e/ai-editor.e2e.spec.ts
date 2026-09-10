import { expect, test } from './fixtures/lunaElectron'
import { access, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

test('AI 剪辑导航打开 OpenReel 编辑器', async ({ lunaApp }) => {
  await lunaApp.page.getByRole('link', { name: 'AI 剪辑' }).click()

  const editorFrame = lunaApp.page.locator('iframe[title="AI 剪辑"]')
  await expect(editorFrame).toBeVisible()
  await expect(editorFrame.contentFrame().locator('#root')).not.toBeEmpty({ timeout: 30_000 })

  expect(lunaApp.runtimeErrors).toEqual([])
})

test('AI 剪辑通过 Luna 文件桥接保存项目并写出导出文件', async ({ lunaApp }) => {
  await lunaApp.page.getByRole('link', { name: 'AI 剪辑' }).click()
  const editorFrame = lunaApp.page.locator('iframe[title="AI 剪辑"]')
  const editor = editorFrame.contentFrame()
  await expect(editor.locator('#root')).not.toBeEmpty({ timeout: 30_000 })
  const editorPageFrame = lunaApp.page.frames().find((frame) => frame.url().includes('/ai-editor/'))
  expect(editorPageFrame).toBeDefined()

  const projectPath = path.join(lunaApp.temporaryRoot, 'project.oreel')
  const exportPath = path.join(lunaApp.temporaryRoot, 'export.mp4')
  const abortedPath = path.join(lunaApp.temporaryRoot, 'aborted.mp4')
  const bridgeResult = await editorPageFrame!.evaluate(async ({ projectPath: nextProjectPath, exportPath: nextExportPath, abortedPath: nextAbortedPath }) => {
    const bridge = (window as unknown as {
      openreel?: {
        platform?: string
        fs?: {
          writeFile(path: string, data: string): Promise<void>
          readFile(path: string): Promise<string>
          openWrite(path: string): Promise<string>
          writeChunk(handleId: string, data: Uint8Array, position: number): Promise<void>
          closeWrite(handleId: string): Promise<void>
          abortWrite(handleId: string): Promise<void>
        }
      }
    }).openreel
    if (!bridge?.fs) return { hasFs: false, platform: bridge?.platform ?? null, project: null, exportBytes: 0 }

    const project = JSON.stringify({ name: 'Luna test project', tracks: [] })
    await bridge.fs.writeFile(nextProjectPath, project)
    const openedProject = await bridge.fs.readFile(nextProjectPath)
    const handleId = await bridge.fs.openWrite(nextExportPath)
    const bytes = new TextEncoder().encode('export-test')
    await bridge.fs.writeChunk(handleId, bytes, 0)
    await bridge.fs.closeWrite(handleId)
    const abortedHandleId = await bridge.fs.openWrite(nextAbortedPath)
    await bridge.fs.writeChunk(abortedHandleId, bytes, 0)
    await bridge.fs.abortWrite(abortedHandleId)
    return {
      hasFs: true,
      platform: bridge.platform ?? null,
      project: openedProject,
      exportBytes: bytes.byteLength,
    }
  }, { projectPath, exportPath, abortedPath })

  expect(bridgeResult).toEqual({
    hasFs: true,
    platform: null,
    project: JSON.stringify({ name: 'Luna test project', tracks: [] }),
    exportBytes: 'export-test'.length,
  })
  await expect(readFile(projectPath, 'utf8')).resolves.toContain('Luna test project')
  await expect(readFile(exportPath, 'utf8')).resolves.toBe('export-test')
  await expect(readFile(abortedPath, 'utf8')).rejects.toThrow()
  expect(lunaApp.runtimeErrors).toEqual([])
})

test('AI 剪辑接收 Luna 本地素材并导入素材面板', async ({ lunaApp }) => {
  const sourcePath = path.resolve(import.meta.dirname, '../build/icon.png')
  await lunaApp.page.evaluate((source) => {
    history.pushState({ usr: { media: [{ path: source, name: 'icon.png', kind: 'image' }] }, key: 'test' }, '', '#/ai-editor')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, sourcePath)

  const editorFrame = lunaApp.page.locator('iframe[title="AI 剪辑"]')
  const editor = editorFrame.contentFrame()
  await expect(editorFrame).toBeVisible()
  await expect(editor.locator('input[type="file"]')).toBeAttached({ timeout: 30_000 })
  await expect(editor.getByRole('button', { name: '素材', exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(editor.getByText('icon.png', { exact: true })).toBeVisible({ timeout: 30_000 })

  const editorPageFrame = lunaApp.page.frames().find((frame) => frame.url().includes('/ai-editor/'))
  expect(editorPageFrame).toBeDefined()
  const locale = await editorPageFrame!.evaluate(() => ({
    lang: document.documentElement.lang,
    title: document.title,
    hasEnglishMediaLabel: document.body.innerText.includes('No media imported'),
  }))
  expect(locale).toEqual({
    lang: 'zh-CN',
    title: 'Luna AI 剪辑',
    hasEnglishMediaLabel: false,
  })

  expect(lunaApp.runtimeErrors).toEqual([])
})

test('AI 剪辑导入素材、调整片段并导出文件', async ({ lunaApp }) => {
  const sourcePath = path.resolve(import.meta.dirname, '../build/icon.png')
  await lunaApp.page.addInitScript(() => {
    localStorage.setItem('openreel-onboarding-complete', 'true')
  })
  await lunaApp.page.evaluate((source) => {
    history.pushState({ usr: { media: [{ path: source, name: 'icon.png', kind: 'image' }] }, key: 'export-test' }, '', '#/ai-editor')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, sourcePath)

  const editorFrame = lunaApp.page.locator('iframe[title="AI 剪辑"]')
  const editor = editorFrame.contentFrame()
  await expect(editor.getByText('icon.png', { exact: true })).toBeVisible({ timeout: 30_000 })

  const thumbnail = editor.locator('img[alt="icon.png"]').first()
  await thumbnail.hover()
  await editor.getByRole('button', { name: '添加到时间线' }).click()

  const timelineClip = editor.getByRole('button', { name: '选择片段：icon.png' })
  await expect(timelineClip).toBeVisible({ timeout: 30_000 })
  await timelineClip.click()

  const rotateUp = editor.getByRole('button', { name: '增大旋转角度' })
  await expect(rotateUp).toBeVisible()
  await rotateUp.click()
  const rotationInput = editor.getByText('旋转', { exact: true }).locator('..').locator('input')
  await expect(rotationInput).toHaveValue('1°')

  const exportPath = path.join(lunaApp.temporaryRoot, 'export.mp4')
  await lunaApp.app.evaluate(({ dialog }, nextPath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: nextPath })
  }, exportPath)

  await editor.getByRole('button', { name: '导出', exact: true }).click()

  await expect.poll(async () => {
    try {
      return (await stat(exportPath)).size
    } catch {
      return 0
    }
  }, { timeout: 30_000 }).toBeGreaterThan(0)

  const logDir = await lunaApp.page.evaluate(() => window.luna.getLogDir())
  const logFiles = await (await import('node:fs/promises')).readdir(logDir)
  const openReelLogName = logFiles.find((name) => name.startsWith('openreel-') && name.endsWith('.log'))
  expect(openReelLogName).toBeDefined()
  const openReelLog = await readFile(path.join(logDir, openReelLogName!), 'utf8')
  expect(openReelLog).toContain('[OpenReel]')
  expect(openReelLog).toContain('导出位置已选择')
  expect(openReelLog).toContain('导出文件写入完成')
  expect(openReelLog).toContain('export.mp4')
  expect(lunaApp.runtimeErrors).toEqual([])

  await access(exportPath)
})
