import { execFile } from 'node:child_process'
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import ffprobeStatic from 'ffprobe-static'
import { expect, test } from './fixtures/lunaElectron'

const execFileAsync = promisify(execFile)
const projectId = 'KbZeoE0r'
const sourceUserDataDir = path.join(os.homedir(), 'Library/Application Support/LunaAI-Cut')
const existingUserDataDir = process.env.LUNA_E2E_EXISTING_USER_DATA_DIR

test.use({
  lunaElectronOptions: {
    launchEnv: {
      // pnpm dev owns this Vite server; Playwright launches an isolated Electron profile.
      VITE_DEV_SERVER_URL: 'http://localhost:5173',
    },
    seedProject: existingUserDataDir
      ? undefined
      : {
          sourceUserDataDir,
          projectId,
        },
  },
})

test.setTimeout(20 * 60_000)

interface ProbeResult {
  streams?: Array<{
    codec_type?: string
    codec_name?: string
    width?: number
    height?: number
    channels?: number
  }>
  format?: { duration?: string }
}

async function savePreviewBlob(page: import('@playwright/test').Page, destination: string): Promise<void> {
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
    const chunkSize = 256 * 1024
    const writeChunk = (window as Window & {
      __writeExportChunk: (base64: string) => Promise<void>
    }).__writeExportChunk

    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize))
      let binary = ''
      for (const byte of chunk) binary += String.fromCharCode(byte)
      await writeChunk(btoa(binary))
    }
  })
}

test('通过 Electron Worker 导出当前剪辑并保存 MP4', async ({ lunaApp }) => {
  const { page, runtimeErrors } = lunaApp
  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  const projectCard = page.locator(`[data-project-card][data-project-id="${projectId}"]`)
  await expect(projectCard).toBeVisible()
  await projectCard.dblclick()
  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()

  await page.getByRole('button', { name: '导出', exact: true }).click()
  await page.getByRole('menuitem', { name: '导出视频', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '导出' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Worker 路径', { exact: true })).toBeVisible({ timeout: 120_000 })

  const exportButton = dialog.getByRole('button', { name: '导出视频', exact: true })
  await expect(exportButton).toBeEnabled()
  await exportButton.click()

  await expect(dialog.getByRole('button', { name: '下载', exact: true })).toBeVisible({
    timeout: 20 * 60_000,
  })

  const sourceSettings = JSON.parse(
    await readFile(path.join(sourceUserDataDir, 'settings.json'), 'utf8'),
  ) as { baseDir?: string; exportDir?: string }
  const destinationDir = sourceSettings.exportDir ?? path.join(sourceSettings.baseDir ?? os.tmpdir(), 'export')
  await mkdir(destinationDir, { recursive: true })
  const destination = path.join(destinationDir, `luna-worker-export-${Date.now()}.mp4`)
  await dialog.getByRole('button', { name: '下载', exact: true }).click()
  await savePreviewBlob(page, destination)

  expect((await stat(destination)).size).toBeGreaterThan(10_000)
  const probe = JSON.parse(
    (await execFileAsync(ffprobeStatic.path, [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,codec_name,width,height,channels:format=duration',
      '-of',
      'json',
      destination,
    ])).stdout,
  ) as ProbeResult
  const video = probe.streams?.find((stream) => stream.codec_type === 'video')
  const audio = probe.streams?.find((stream) => stream.codec_type === 'audio')
  expect(video).toMatchObject({ codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 })
  expect(audio).toMatchObject({ codec_type: 'audio', codec_name: 'aac', channels: 2 })
  expect(Number(probe.format?.duration)).toBeGreaterThan(299)
  expect(runtimeErrors).toEqual([])

  console.log(`LUNA_WORKER_EXPORT ${JSON.stringify({ projectId, destination, probe })}`)
})
