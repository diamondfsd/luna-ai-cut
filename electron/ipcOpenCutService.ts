import { app, ipcMain } from 'electron'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

interface SoundSearchRequest {
  query?: string
  type?: 'songs' | 'effects'
  page?: number
  pageSize?: number
  sort?: 'downloads' | 'rating' | 'created' | 'score'
  minRating?: number
  commercialOnly?: boolean
}

function numberInRange(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < min || value > max) throw new Error('Invalid sound search parameters')
  return value
}

async function searchSounds(request: SoundSearchRequest) {
  if (request.type === 'songs') throw new Error('Songs are not available yet')
  const token = process.env.FREESOUND_API_KEY
  if (!token) throw new Error('Sound search is not configured')

  const query = request.query?.slice(0, 500) ?? ''
  const page = numberInRange(request.page, 1, 1, 1000)
  const pageSize = numberInRange(request.pageSize, 20, 1, 150)
  const minRating = Math.min(Math.max(request.minRating ?? 3, 0), 5)
  const sort = request.sort ?? 'downloads'
  const params = new URLSearchParams({
    query,
    token,
    page: String(page),
    page_size: String(pageSize),
    sort: query && sort === 'score' ? 'score' : `${sort}_desc`,
    fields: 'id,name,description,url,previews,download,duration,filesize,type,channels,bitrate,bitdepth,samplerate,username,tags,license,created,num_downloads,avg_rating,num_ratings',
  })
  params.append('filter', 'duration:[* TO 30.0]')
  params.append('filter', `avg_rating:[${minRating} TO *]`)
  if (request.commercialOnly ?? true) {
    params.append('filter', 'license:("Attribution" OR "Creative Commons 0" OR "Attribution Commercial")')
  }
  params.append('filter', 'tag:sound-effect OR tag:sfx OR tag:foley OR tag:ambient OR tag:nature OR tag:mechanical OR tag:electronic OR tag:impact OR tag:whoosh OR tag:explosion')

  const response = await fetch(`https://freesound.org/apiv2/search/text/?${params}`)
  if (!response.ok) throw new Error(`Sound search failed (${response.status})`)
  const data = await response.json() as { count: number; next: string | null; previous: string | null; results: any[] }
  return {
    count: data.count,
    next: data.next,
    previous: data.previous,
    results: data.results.map((result) => ({
      id: result.id,
      name: result.name,
      description: result.description,
      url: result.url,
      previewUrl: result.previews?.['preview-hq-mp3'] ?? result.previews?.['preview-lq-mp3'],
      downloadUrl: result.download,
      duration: result.duration,
      filesize: result.filesize,
      type: result.type,
      channels: result.channels,
      bitrate: result.bitrate,
      bitdepth: result.bitdepth,
      samplerate: result.samplerate,
      username: result.username,
      tags: result.tags,
      license: result.license,
      created: result.created,
      downloads: result.num_downloads ?? 0,
      rating: result.avg_rating ?? 0,
      ratingCount: result.num_ratings ?? 0,
    })),
    query,
    type: 'effects',
    page,
    pageSize,
    sort,
    minRating,
  }
}

export function register(): void {
  ipcMain.handle('opencut:search-sounds', async (_event, request: SoundSearchRequest) => {
    return await searchSounds(request)
  })
  ipcMain.handle('opencut:submit-feedback', async (_event, message: string) => {
    const normalized = message.trim()
    if (!normalized || normalized.length > 5000) throw new Error('Invalid feedback message')
    const entry = { id: randomUUID(), message: normalized, createdAt: new Date().toISOString() }
    const directory = join(app.getPath('userData'), 'opencut-editor', 'feedback')
    await mkdir(directory, { recursive: true })
    await appendFile(join(directory, 'entries.jsonl'), `${JSON.stringify(entry)}\n`, 'utf8')
    return entry
  })
}
