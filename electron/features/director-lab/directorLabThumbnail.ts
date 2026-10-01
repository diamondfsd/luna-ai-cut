import { app, ipcMain } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { getFfmpegPath } from '../../platform/ffmpeg/pipeline'
import { lunaKaHttpClient } from '../../network/lunaka_http_client'
import type { DirectorLabPreviewResult } from '../../../src/shared/types'
import { directorThumbnailRequest } from '../../../src/lib/directorThumbnailRequest'

const tasks = new Map<string, Promise<DirectorLabPreviewResult>>()
let workers = 0
const waiting: Array<() => void> = []

async function thumbnail(url: string, positionMs?: number): Promise<DirectorLabPreviewResult> {
  const { cacheKey, seekArgs } = directorThumbnailRequest(url, positionMs)
  const existing = tasks.get(cacheKey)
  if (existing) return existing
  const task = (async () => {
    const directory = path.join(app.getPath('userData'), 'director-lab', 'thumbnails')
    const output = path.join(directory, `${createHash('sha256').update(cacheKey).digest('hex')}.jpg`)
    if ((await fs.stat(output).catch(() => null))?.size) return { url: pathToFileURL(output).toString(), cached: true }
    if (workers >= 3) await new Promise<void>((resolve) => waiting.push(resolve))
    else workers++
    const temporary = `${output}.${randomUUID()}.tmp.jpg`
    try {
      await fs.mkdir(directory, { recursive: true })
      const headers = await lunaKaHttpClient.authorizationHeadersFor(url)
      const headerBlock = Object.entries(headers).map(([name, value]) => `${name}: ${value}\r\n`).join('')
      const args = ['-hide_banner', '-loglevel', 'error', '-y',
        ...headerBlock ? ['-headers', headerBlock] : [],
        ...seekArgs,
        '-i', url.startsWith('file:') ? fileURLToPath(url) : url,
        '-frames:v', '1', '-vf', "scale='min(480,iw)':-2", '-q:v', '3', temporary]
      await new Promise<void>((resolve, reject) => {
        const process = spawn(getFfmpegPath(), args, { stdio: ['ignore', 'ignore', 'pipe'] })
        let errorText = ''
        const timer = setTimeout(() => process.kill('SIGKILL'), 30000)
        process.stderr.on('data', (chunk: Buffer) => { errorText = `${errorText}${chunk}`.slice(-2000) })
        process.once('error', (error) => { clearTimeout(timer); reject(error) })
        process.once('close', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(errorText || '缩略图生成失败')) })
      })
      await fs.rename(temporary, output)
      return { url: pathToFileURL(output).toString(), cached: false }
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
      const next = waiting.shift()
      if (next) next()
      else workers--
    }
  })().finally(() => tasks.delete(cacheKey))
  tasks.set(cacheKey, task)
  return task
}

export function registerDirectorThumbnail() {
  ipcMain.handle('director-lab:prepare-thumbnail', (_event, url: string, positionMs?: number) => thumbnail(url, positionMs))
}
