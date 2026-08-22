import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectronLive'

const projectId = 'iXBrE40P'
const baseDir = '/Users/REDACTED/Pictures/LunaAI-Cut'
const destination = path.join('/Users/REDACTED/Pictures', 'LunaUltra-直播功能教程-60s-full.mp4')

test.skip(process.env.LUNA_E2E_LIVE !== '1', '需要显式设置 LUNA_E2E_LIVE=1 才会导出真实项目')
test.setTimeout(30 * 60_000)

async function savePreviewBlob(page: import('@playwright/test').Page): Promise<void> {
  await writeFile(destination, Buffer.alloc(0))
  await page.exposeFunction('__writeExportChunk', async (base64: string) => {
    await appendFile(destination, Buffer.from(base64, 'base64'))
  })
  await page.evaluate(async () => {
    const media = document.querySelector<HTMLVideoElement>('[role="dialog"] video[src^="blob:"]')
    if (!media?.src) throw new Error('完成页没有找到导出预览')
    const response = await fetch(media.src)
    if (!response.ok) throw new Error(`读取导出预览失败: ${response.status}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    const writeChunk = (window as Window & {
      __writeExportChunk: (base64: string) => Promise<void>
    }).__writeExportChunk
    const chunkSize = 256 * 1024
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize))
      let binary = ''
      for (const byte of chunk) binary += String.fromCharCode(byte)
      await writeChunk(btoa(binary))
    }
  })
}

test('通过 Electron 正式导出新的 LunaUltra 教程', async ({ lunaLiveApp }) => {
  const { page, runtimeErrors } = lunaLiveApp
  await mkdir(path.dirname(destination), { recursive: true })
  await page.evaluate(async (settings) => window.luna.saveSettings(settings), {
    baseDir,
    localResourcesDir: path.join(baseDir, 'localResources'),
    exportDir: path.join(baseDir, 'export'),
  })
  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  const projectCard = page.locator(`[data-project-card][data-project-id="${projectId}"]`)
  await expect(projectCard).toBeVisible({ timeout: 30_000 })
  await projectCard.dblclick()
  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible({ timeout: 30_000 })

  await page.getByRole('button', { name: '导出', exact: true }).click()
  await page.getByRole('menuitem', { name: '导出视频', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '导出' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Worker 路径', { exact: true })).toBeVisible({ timeout: 120_000 })
  const exportButton = dialog.getByRole('button', { name: '导出视频', exact: true })
  await expect(exportButton).toBeEnabled()
  await exportButton.click()
  await expect(dialog.getByRole('button', { name: '下载', exact: true })).toBeVisible({ timeout: 25 * 60_000 })
  await dialog.getByRole('button', { name: '下载', exact: true }).click()
  await savePreviewBlob(page)

  expect((await stat(destination)).size).toBeGreaterThan(100_000)
  expect(runtimeErrors.filter((message) => /Maximum update depth|Minified React error #185|crashed/i.test(message))).toEqual([])
  console.log(JSON.stringify({ projectId, destination, size: (await stat(destination)).size, project: JSON.parse(await readFile(path.join(baseDir, 'freecut-workspace', 'projects', projectId, 'project.json'), 'utf8')) }))
})
