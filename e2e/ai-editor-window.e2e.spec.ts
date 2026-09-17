import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectron'

test('AI 剪辑独立窗口打开项目并导入素材', async ({ lunaApp }) => {
  const editorWindowPromise = lunaApp.app.waitForEvent('window')
  await lunaApp.page.getByRole('link', { name: 'AI 剪辑' }).click()
  const editor = await editorWindowPromise

  const runtimeErrors: string[] = []
  editor.on('pageerror', (error) => runtimeErrors.push(error.message))
  editor.on('console', (message) => {
    if (message.type() !== 'error') return
    if (message.text().includes('[WebGPURenderer] Initialization failed')) return
    runtimeErrors.push(message.text())
  })

  await expect(editor.getByRole('button', { name: '素材', exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(editor.getByText('项目打开失败', { exact: true })).toHaveCount(0)

  const assetPaths = [
    path.resolve('public/pocket3.png'),
    path.resolve('public/pocket4.png'),
    path.resolve('public/pocket4p-white.png'),
  ]
  await editor.locator('input[type="file"]').setInputFiles(assetPaths)

  const assetNames = assetPaths.map((assetPath) => path.basename(assetPath))
  for (const assetName of assetNames) {
    await expect(editor.getByText(assetName, { exact: true })).toBeVisible({ timeout: 30_000 })
  }

  const projectId = new URL(editor.url()).hash.match(/projectId=([^&]+)/)?.[1]
  expect(projectId).toBeTruthy()
  const editorDocumentPath = path.join(
    lunaApp.temporaryRoot,
    'downloads',
    'ai-editor-projects',
    decodeURIComponent(projectId!),
    'editor',
    'openreel.json',
  )
  await expect.poll(async () => {
    const document = JSON.parse(await readFile(editorDocumentPath, 'utf8')) as {
      mediaLibrary?: { items?: Array<{ name?: string }> }
    }
    return document.mediaLibrary?.items?.map((item) => item.name)
  }, { timeout: 30_000 }).toEqual(assetNames)

  expect(runtimeErrors).toEqual([])
  expect(lunaApp.runtimeErrors).toEqual([])
})
