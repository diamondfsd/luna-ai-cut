import { app } from 'electron'
import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const _require = createRequire(import.meta.url)

/** 缩略图最长边（等比缩放，不裁剪） */
export const THUMBNAIL_MAX = 400

/** 缩略图文件名后缀 */
export const THUMB_EXT = '.webp'

/** 缩略图缓存子目录名 */
export const THUMBNAIL_SUBDIR = 'thumbnails'

/** 并发数 = CPU 核心数 - 1（至少 2，最多 8） */
const WORKER_COUNT = Math.max(2, Math.min(8, os.cpus().length - 1))

/** 获取 ffmpeg 二进制路径（打包后取 resources，开发环境取 ffmpeg-static） */
function getFfmpegPath(): string {
  if (app.isPackaged) {
    const ext = process.platform === 'win32' ? '.exe' : ''
    return path.join(process.resourcesPath, 'ffmpeg', `ffmpeg${ext}`)
  }
  try {
    const p = _require('ffmpeg-static') as string
    return p
  } catch {
    return 'ffmpeg'
  }
}

/** 安全化文件名（替换路径分隔符和特殊字符） */
export function safeId(id: string): string {
  return id.replace(/[\\/:*?"<>|]/g, '_')
}

/** 获取缩略图目录路径 */
export function thumbnailDir(cacheDir: string): string {
  return path.join(cacheDir, THUMBNAIL_SUBDIR)
}

/** 获取指定文件的缩略图路径 */
export function thumbnailPathFor(cacheDir: string, fileId: string): string {
  return path.join(thumbnailDir(cacheDir), `${safeId(fileId)}${THUMB_EXT}`)
}

/** 图片扩展名集合 */
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif', '.heic', '.heif'])

/** 视频扩展名集合 */
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.mts', '.m2ts'])

// ====== 队列系统（多 worker 并发） ======

interface ThumbnailTask {
  sourcePath: string
  thumbDir: string
  fileId: string
  kind?: string
  fileName?: string
  resolve: (path: string | null) => void
}

const taskQueue: ThumbnailTask[] = []
let activeWorkers = 0

async function runWorker(): Promise<void> {
  activeWorkers++
  while (true) {
    const task = taskQueue.shift()
    if (!task) break

    const label = task.fileName || task.fileId
    const start = Date.now()
    console.log(`[缩略图] 开始生成 ${label} (${task.kind || '?'}) worker ${activeWorkers}/${WORKER_COUNT}`)

    try {
      const result = await generateThumbnail(task.sourcePath, task.thumbDir, task.fileId, task.kind)
      const elapsed = Date.now() - start
      console.log(`[缩略图] 完成 ${label} → ${path.basename(result)} (${elapsed}ms)`)
      task.resolve(result)
    } catch (err) {
      console.error(`[缩略图] 失败 ${label}: ${err}`)
      task.resolve(null)
    }
  }
  activeWorkers--
}

function spawnWorkers(): void {
  while (activeWorkers < WORKER_COUNT && taskQueue.length > 0) {
    void runWorker()
  }
}

/**
 * 入队一个缩略图生成任务（多 worker 并发执行）
 * 如果缩略图已存在则直接返回，不重复生成
 * @returns 生成的缩略图路径，或 null 失败
 */
export function enqueueThumbnailGeneration(
  sourcePath: string,
  thumbDir: string,
  fileId: string,
  kind?: string,
  fileName?: string,
): Promise<string | null> {
  const destPath = path.join(thumbDir, `${safeId(fileId)}${THUMB_EXT}`)

  // 检查缩略图是否已存在
  return fs.access(destPath).then(
    () => {
      console.log(`[缩略图] 已存在 ${fileName || fileId}，跳过生成`)
      return destPath
    },
    () => {
      // 不存在，入队生成
      return new Promise<string | null>((resolve) => {
        taskQueue.push({ sourcePath, thumbDir, fileId, kind, fileName, resolve })
        spawnWorkers()
      })
    },
  )
}

// ====== 缩略图生成 ======

/**
 * 为图片生成缩略图（ffmpeg libwebp → WebP）
 * @param sourcePath 原始图片路径
 * @param thumbDir 缩略图输出目录
 * @param fileId 文件 ID（用于命名输出文件）
 * @returns 生成的缩略图路径
 */
export async function generateImageThumbnail(
  sourcePath: string,
  thumbDir: string,
  fileId: string,
): Promise<string> {
  await fs.mkdir(thumbDir, { recursive: true })
  const dest = path.join(thumbDir, `${safeId(fileId)}${THUMB_EXT}`)
  const ffmpegPath = getFfmpegPath()

  await execFileAsync(
    ffmpegPath,
    [
      '-i', sourcePath,
      '-vf', `scale=${THUMBNAIL_MAX}:${THUMBNAIL_MAX}:force_original_aspect_ratio=decrease`,
      '-c:v', 'libwebp',
      '-lossless', '0',
      '-q:v', '80',
      '-y',
      dest,
    ],
    { timeout: 15000 },
  )

  return dest
}

/**
 * 为视频生成缩略图（ffmpeg 取第一帧 → WebP）
 * @param sourcePath 原始视频路径
 * @param thumbDir 缩略图输出目录
 * @param fileId 文件 ID（用于命名输出文件）
 * @returns 生成的缩略图路径
 */
export async function generateVideoThumbnail(
  sourcePath: string,
  thumbDir: string,
  fileId: string,
): Promise<string> {
  await fs.mkdir(thumbDir, { recursive: true })
  const dest = path.join(thumbDir, `${safeId(fileId)}${THUMB_EXT}`)
  const ffmpegPath = getFfmpegPath()

  // 取视频第一帧，等比缩放到最长边 400px
  await execFileAsync(
    ffmpegPath,
    [
      '-ss', '0',
      '-i', sourcePath,
      '-vframes', '1',
      '-vf', `scale=${THUMBNAIL_MAX}:${THUMBNAIL_MAX}:force_original_aspect_ratio=decrease`,
      '-c:v', 'libwebp',
      '-lossless', '0',
      '-q:v', '80',
      '-y',
      dest,
    ],
    { timeout: 15000 },
  )

  return dest
}

/**
 * 根据文件扩展名判断类型并生成缩略图
 * @param sourcePath 原始文件路径
 * @param thumbDir 缩略图输出目录
 * @param fileId 文件 ID
 * @param kind 文件类别（可选，优先使用）
 * @returns 生成的缩略图路径，失败则抛出异常
 */
export async function generateThumbnail(
  sourcePath: string,
  thumbDir: string,
  fileId: string,
  kind?: string,
): Promise<string> {
  const ext = path.extname(sourcePath).toLowerCase()

  if (kind === 'image' || IMAGE_EXTENSIONS.has(ext)) {
    return generateImageThumbnail(sourcePath, thumbDir, fileId)
  }

  if (kind === 'video' || kind === 'lrv' || VIDEO_EXTENSIONS.has(ext)) {
    return generateVideoThumbnail(sourcePath, thumbDir, fileId)
  }

  throw new Error(`不支持的文件格式: ${ext}`)
}
