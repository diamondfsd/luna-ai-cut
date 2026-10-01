import { dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import * as http from 'node:http'
import * as https from 'node:https'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { DirectorLanPlanSummary } from '../../../src/shared/types'
import { parseDirectorPlanImport } from '../../../src/lib/directorPlanImport'
import { directorPlanContentSignature } from '../../../src/lib/directorPlanSync'
import { directorLocalEditHasConflict } from '../../../src/lib/directorPlanLocalEdit'
import { getDirectorPlanDir, getSettings } from '../../storage/fileService'
import { lunaKaHttpClient } from '../../network/lunaka_http_client'
import { downloadToFileWithRetry } from '../../media/fileDownloadService'
import { mediaFileName, mediaFolder, planDirectory, serializePlanWrite, writeDirectorPlanFilesUnlocked } from './directorLabPlanStorage'

export function registerDirectorLocalImport(listPlans: () => Promise<DirectorLanPlanSummary[]>) {
  async function importText(text: string, title = '导演计划'): Promise<DirectorLanPlanSummary> {
    if (typeof text !== 'string' || !text.trim()) throw new Error('请输入计划文本')
    if (Buffer.byteLength(text, 'utf8') > 512 * 1024) throw new Error('计划文本不能超过 512 KB')
    const plan = parseDirectorPlanImport(text, title, randomUUID)
    return save(plan, () => plan)
  }
  async function save(plan: DirectorLanPlanSummary, modify: (current: DirectorLanPlanSummary) => DirectorLanPlanSummary): Promise<DirectorLanPlanSummary> {
    if (!plan || typeof plan.id !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(plan.id)
      || typeof plan.title !== 'string' || !Array.isArray(plan.shots)) throw new Error('计划参数无效')
    return serializePlanWrite(async () => {
      const existing = (await listPlans()).find((item) => item.id === plan.id)
      const current = existing ?? { ...plan, source: 'local' as const,
        synced_revision: plan.synced_revision ?? plan.revision ?? 0,
        synced_signature: plan.synced_signature ?? directorPlanContentSignature(plan),
        shots: plan.shots.map((shot) => ({ ...shot, takes: shot.takes.map((take) => ({ ...take, available: false })) })) }
      const next = modify(current)
      const root = getDirectorPlanDir(await getSettings())
      const directory = existing?.local_directory ?? path.join(root, `${planDirectory(plan.title)}_${plan.id}`)
      await writeDirectorPlanFilesUnlocked(directory, next)
      return { ...next, source: 'local', local_directory: directory,
        local_content_signature: directorPlanContentSignature(next) }
    })
  }
  ipcMain.handle('director-lab:import-plan', async () => {
    const selection = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '导演计划', extensions: ['md', 'txt'] }] })
    if (selection.canceled || !selection.filePaths[0]) return null
    const file = selection.filePaths[0]
    if ((await fs.stat(file)).size > 512 * 1024) throw new Error('计划文件不能超过 512 KB')
    const bytes = await fs.readFile(file)
    if (bytes.length > 512 * 1024) throw new Error('计划文件不能超过 512 KB')
    let text: string
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
    catch { throw new Error('请使用 UTF-8 编码的计划文件') }
    return importText(text, path.basename(file, path.extname(file)))
  })
  ipcMain.handle('director-lab:import-plan-text', (_event, text: string) => importText(text))
  ipcMain.handle('director-lab:acknowledge-local-plan', async (_event, remote: DirectorLanPlanSummary, signature: string) => {
    await save(remote, (current) => {
      const base = directorPlanContentSignature(current) === signature ? remote : current
      const shots = base.shots.map((shot) => {
        const saved = current.shots.find((item) => item.id === shot.id)
        const phoneShot = remote.shots.find((item) => item.id === shot.id)
        const takes = (phoneShot?.takes ?? []).map((take) => {
          const local = saved?.takes.find((item) => item.id === take.id)
          return local?.available ? local : { ...take, available: false, stream_url: null, download_url: null }
        })
        for (const take of saved?.takes ?? []) {
          if (current.pending_take_ids?.includes(take.id) && !takes.some((item) => item.id === take.id)) takes.push(take)
        }
        return { ...shot, takes }
      })
      return { ...base, shots, local_directory: current.local_directory, revision: remote.revision,
        synced_revision: remote.revision, synced_signature: directorPlanContentSignature(remote), pending_create: false,
        pending_take_ids: current.pending_take_ids,
        pending_shot_ids: current.pending_shot_ids?.filter((id) => !remote.shots.some((shot) => shot.id === id)) }
    })
  })
  ipcMain.handle('director-lab:add-local-shot', async (_event, plan: DirectorLanPlanSummary) => save(plan, (current) => {
    if (current.shots.length >= 500) throw new Error('最多支持 500 个镜头')
    const id = `shot-${randomUUID()}`
    return { ...current, updated_at: new Date().toISOString(), shot_count: current.shots.length + 1,
      pending_shot_ids: [...current.pending_shot_ids ?? [], id],
      shots: [...current.shots, { id, order: current.shots.length + 1, name: `镜头 ${current.shots.length + 1}`,
        duration_ms: 5000, remark: '', attributes: [], completed_takes: 0, takes: [] }] }
  }))
  ipcMain.handle('director-lab:save-local-plan', async (_event, plan: DirectorLanPlanSummary, expectedSignature?: string) => save(plan, (current) => {
    if (directorLocalEditHasConflict(current, plan, expectedSignature)) {
      throw new Error('计划已更新，请刷新后重试')
    }
    if (!plan.title?.trim() || plan.title.length > 120 || plan.shots.length > 500
      || new Set(plan.shots.map((shot) => shot.id)).size !== plan.shots.length
      || plan.shots.some((shot) => !shot.name.trim() || shot.name.length > 120 || shot.remark.length > 4000
        || !Number.isSafeInteger(shot.duration_ms) || shot.duration_ms < 1000 || shot.duration_ms > 3600000
        || shot.attributes.some((field) => field.description.length > 4000))) throw new Error('计划内容无效')
    const requestedIds = new Set(plan.shots.map((shot) => shot.id))
    const shots = plan.shots.map((shot, index) => ({ ...shot, order: index + 1,
      takes: current.shots.find((item) => item.id === shot.id)?.takes ?? [] }))
    return { ...current, title: plan.title, shots, shot_count: shots.length,
      updated_at: new Date().toISOString(),
      pending_shot_ids: current.pending_shot_ids?.filter((id) => requestedIds.has(id)),
      pending_take_ids: current.pending_take_ids?.filter((id) => shots.some((shot) => shot.takes.some((take) => take.id === id))) }
  }))
  ipcMain.handle('director-lab:import-materials', async (_event, plan: DirectorLanPlanSummary, shotId: string) => {
    const selection = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'],
      filters: [{ name: '素材', extensions: ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'jpg', 'jpeg', 'png', 'heic', 'webp'] }] })
    if (selection.canceled || !selection.filePaths.length) return null
    if (selection.filePaths.length > 100) throw new Error('一次最多添加 100 个素材')
    return serializePlanWrite(async () => {
      let current = (await listPlans()).find((item) => item.id === plan.id)
      if (!current) throw new Error('请先将计划同步到电脑')
      const shot = current.shots.find((item) => item.id === shotId)
      if (!shot || !current.local_directory) throw new Error('镜头不存在')
      const takeIds: string[] = []
      const copied: string[] = []
      try {
        for (const file of selection.filePaths) {
          const sourceStat = await fs.stat(file)
          if (!sourceStat.isFile() || sourceStat.size <= 0 || sourceStat.size > 8 * 1024 ** 3) throw new Error('素材必须为非空文件且不超过 8 GB')
          const id = `take-${randomUUID()}`
          const extension = path.extname(file).toLowerCase()
          if (!/\.(mp4|mov|m4v|mkv|webm|jpg|jpeg|png|heic|webp)$/.test(extension)) throw new Error('不支持的素材格式')
          const fileName = `${id}${extension}`
          const target = path.join(current.local_directory, mediaFolder(shot.order, shot.name), mediaFileName(shot.takes.length + 1, fileName))
          await fs.mkdir(path.dirname(target), { recursive: true })
          copied.push(target)
          await fs.copyFile(file, target)
          const size = (await fs.stat(target)).size
          if (size <= 0 || size > 8 * 1024 ** 3) throw new Error('素材必须为非空文件且不超过 8 GB')
          const video = ['.mp4', '.mov', '.m4v', '.mkv', '.webm'].includes(extension)
          shot.takes.push({ id, kind: video ? 'video' : 'photo', created_at: new Date().toISOString(),
            file_name: fileName, mime_type: video ? 'video/mp4' : 'image/jpeg', size_bytes: size,
            available: true, selected_range: null, stream_path: null, stream_url: null, download_path: null, download_url: null })
          takeIds.push(id)
        }
        current = { ...current, pending_take_ids: [...current.pending_take_ids ?? [], ...takeIds], updated_at: new Date().toISOString() }
        await writeDirectorPlanFilesUnlocked(current.local_directory!, current)
      } catch (error) {
        await Promise.all(copied.map((file) => fs.rm(file, { force: true })))
        throw error
      }
      return (await listPlans()).find((item) => item.id === plan.id)!
    })
  })
  const syncTasks = new Map<string, Promise<void>>()
  ipcMain.handle('director-lab:sync-materials', async (_event, endpoint: string, planId: string) => {
    const key = `${endpoint}\n${planId}`
    const existing = syncTasks.get(key)
    if (existing) return existing
    const task = (async () => {
      const plan = (await listPlans()).find((item) => item.id === planId)
      if (!plan) return
      for (const shot of plan.shots) for (const take of shot.takes) {
        if (!plan.pending_take_ids?.includes(take.id) || !take.stream_url?.startsWith('file:')) continue
        await lunaKaHttpClient.connect(endpoint)
        const url = new URL(`/api/v1/director/plans/${encodeURIComponent(planId)}/shots/${encodeURIComponent(shot.id)}/media/${encodeURIComponent(take.id)}`, endpoint)
        url.searchParams.set('file_name', take.file_name)
        const file = fileURLToPath(take.stream_url)
        const realFile = await fs.realpath(file)
        const realDirectory = await fs.realpath(plan.local_directory!)
        const relative = path.relative(realDirectory, realFile)
        if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) throw new Error('素材不在计划目录中')
        const headers = await lunaKaHttpClient.authorizationHeadersFor(url.toString())
        const size = (await fs.stat(file)).size
        await new Promise<void>((resolve, reject) => {
          const request = (url.protocol === 'https:' ? https : http).request(url, { method: 'POST',
            headers: { ...headers, 'Content-Length': String(size), 'Content-Type': 'application/octet-stream' } }, (response) => {
            response.resume()
            response.on('end', () => response.statusCode === 200 || response.statusCode === 201
              ? resolve() : reject(new Error(`素材上传失败 HTTP ${response.statusCode}`)))
            response.on('error', reject)
          })
          request.setTimeout(120000, () => request.destroy(new Error('素材上传超时')))
          request.on('error', reject)
          const source = createReadStream(file)
          source.on('error', (error) => request.destroy(error))
          request.on('close', () => source.destroy())
          source.pipe(request)
        })
        await save(plan, (current) => ({ ...current, pending_take_ids: current.pending_take_ids?.filter((id) => id !== take.id) }))
      }
      const remote = await lunaKaHttpClient.request<DirectorLanPlanSummary>(endpoint,
        `/api/v1/director/plans/${encodeURIComponent(planId)}`)
      for (const remoteShot of remote.shots) for (const take of remoteShot.takes) {
        if (!take.available || !(take.download_path || take.download_url)) continue
        const current = (await listPlans()).find((item) => item.id === planId)
        const localShot = current?.shots.find((item) => item.id === remoteShot.id)
        if (!current?.local_directory || !localShot || current.pending_take_ids?.includes(take.id)) continue
        const localTake = localShot.takes.find((item) => item.id === take.id)
        if (localTake?.available && localTake.stream_url?.startsWith('file:')) continue
        const remoteUrl = new URL(take.download_path ?? new URL(take.download_url!).pathname, endpoint).toString()
        const index = localTake ? localShot.takes.indexOf(localTake) : localShot.takes.length
        const destination = path.join(current.local_directory, mediaFolder(localShot.order, localShot.name), mediaFileName(index + 1, take.file_name))
        await downloadToFileWithRetry({ name: take.file_name, bytes: take.size_bytes, sourceUrl: remoteUrl,
          headers: await lunaKaHttpClient.authorizationHeadersFor(remoteUrl) }, destination)
        await save(current, (latest) => ({ ...latest, shots: latest.shots.map((shot) => {
          if (shot.id !== remoteShot.id) return shot
          const downloaded = { ...take, available: true, stream_url: pathToFileURL(destination).toString(),
            download_url: pathToFileURL(destination).toString() }
          const exists = shot.takes.some((item) => item.id === take.id)
          return { ...shot, takes: exists ? shot.takes.map((item) => item.id === take.id ? downloaded : item) : [...shot.takes, downloaded] }
        }) }))
      }
    })().finally(() => syncTasks.delete(key))
    syncTasks.set(key, task)
    return task
  })
}
