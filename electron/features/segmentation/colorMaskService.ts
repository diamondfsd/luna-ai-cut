import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const PROJECTS_DIR = 'workspace-projects'
const MASKS_DIR = 'masks'
const MAX_MASK_PIXELS = 100_000_000
const DEFAULT_ORPHAN_GRACE_MS = 60 * 60 * 1000

function safePathSegment(value: string, fallback: string): string {
  return value.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || fallback
}

function projectDirectory(baseDir: string, projectId: string): string {
  const safeProjectId = safePathSegment(projectId, '')
  if (!safeProjectId || safeProjectId !== projectId || projectId === '.' || projectId === '..') {
    throw new Error('项目标识无效')
  }
  const root = path.resolve(baseDir, PROJECTS_DIR)
  const directory = path.resolve(root, safeProjectId)
  const relative = path.relative(root, directory)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('项目标识无效')
  }
  return directory
}

function maskDirectory(baseDir: string, projectId: string): string {
  return path.join(projectDirectory(baseDir, projectId), MASKS_DIR)
}

async function resolveExistingMaskPath(baseDir: string, projectId: string, filePath: string): Promise<string> {
  const root = await fs.realpath(maskDirectory(baseDir, projectId))
  const resolved = await fs.realpath(path.resolve(filePath))
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('蒙版文件不属于当前项目')
  }
  return resolved
}

function checkedDimensions(width: number, height: number): number {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('蒙版尺寸无效')
  }
  const pixels = width * height
  if (!Number.isSafeInteger(pixels) || pixels > MAX_MASK_PIXELS) throw new Error('蒙版尺寸过大')
  return pixels
}

function parsePgm(buffer: Buffer): { width: number; height: number; bytes: Uint8Array } {
  let offset = 0
  const nextToken = (): string => {
    while (offset < buffer.length) {
      if (buffer[offset] === 35) {
        while (offset < buffer.length && buffer[offset] !== 10 && buffer[offset] !== 13) offset += 1
      } else if (buffer[offset] <= 32) offset += 1
      else break
    }
    const start = offset
    while (offset < buffer.length && buffer[offset] > 32 && buffer[offset] !== 35) offset += 1
    if (start === offset) throw new Error('蒙版文件格式无效')
    return buffer.toString('ascii', start, offset)
  }

  if (nextToken() !== 'P5') throw new Error('不支持的蒙版文件格式')
  const width = Number(nextToken())
  const height = Number(nextToken())
  if (Number(nextToken()) !== 255) throw new Error('蒙版灰度范围无效')
  const pixels = checkedDimensions(width, height)
  if (offset >= buffer.length || buffer[offset] > 32) throw new Error('蒙版文件格式无效')
  const delimiter = buffer[offset]
  offset += 1
  if (delimiter === 13 && buffer[offset] === 10) offset += 1
  if (buffer.length - offset !== pixels) throw new Error('蒙版文件数据不完整')
  return { width, height, bytes: new Uint8Array(buffer.subarray(offset)) }
}

export async function saveColorMask(
  baseDir: string,
  projectId: string,
  assetId: string,
  width: number,
  height: number,
  input: ArrayBuffer,
  feather: number,
): Promise<{ path: string; width: number; height: number }> {
  void feather // 羽化是非破坏性参数，持久化层始终保存原始蒙版。
  const pixels = checkedDimensions(width, height)
  const bytes = new Uint8Array(input)
  if (bytes.byteLength !== pixels) throw new Error('蒙版数据与尺寸不匹配')

  const projectDir = projectDirectory(baseDir, projectId)
  await fs.access(path.join(projectDir, 'project.json'))
  const masksDir = maskDirectory(baseDir, projectId)
  await fs.mkdir(masksDir, { recursive: true })
  const [realProjectDir, realMasksDir] = await Promise.all([fs.realpath(projectDir), fs.realpath(masksDir)])
  if (!realMasksDir.startsWith(`${realProjectDir}${path.sep}`)) throw new Error('蒙版目录不属于当前项目')
  // 使用不可变版本文件名，避免 GPU/导出缓存继续读取被覆盖的旧蒙版。
  // 历史文件同时保证撤销后引用仍然有效。
  const destination = path.join(realMasksDir, `${safePathSegment(assetId, 'asset')}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pgm`)
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`
  const header = Buffer.from(`P5\n${width} ${height}\n255\n`, 'ascii')
  try {
    await fs.writeFile(temporary, Buffer.concat([header, Buffer.from(bytes)]), { mode: 0o600 })
    await fs.rename(temporary, destination)
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
  }
  return { path: destination, width, height }
}

export async function loadColorMask(
  baseDir: string,
  projectId: string,
  filePath: string,
): Promise<{ width: number; height: number; bytes: ArrayBuffer }> {
  const parsed = parsePgm(await fs.readFile(await resolveExistingMaskPath(baseDir, projectId, filePath)))
  const bytes = parsed.bytes.buffer.slice(parsed.bytes.byteOffset, parsed.bytes.byteOffset + parsed.bytes.byteLength) as ArrayBuffer
  return { width: parsed.width, height: parsed.height, bytes }
}

export async function deleteColorMask(baseDir: string, projectId: string, filePath: string): Promise<void> {
  await fs.rm(await resolveExistingMaskPath(baseDir, projectId, filePath), { force: true })
}

function collectPersistedMaskPaths(value: unknown, paths: Set<string>): void {
  if (typeof value === 'string') {
    if (path.extname(value).toLowerCase() === '.pgm') paths.add(path.resolve(value))
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPersistedMaskPaths(item, paths)
    return
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectPersistedMaskPaths(item, paths)
  }
}

export async function cleanupUnreferencedColorMasks(
  baseDir: string,
  projectId: string,
  retainedPaths: string[],
  minimumAgeMs = DEFAULT_ORPHAN_GRACE_MS,
): Promise<{ deleted: number; retained: number }> {
  const projectDir = projectDirectory(baseDir, projectId)
  const masksDir = maskDirectory(baseDir, projectId)
  const project = JSON.parse(await fs.readFile(path.join(projectDir, 'project.json'), 'utf8')) as unknown
  const reachable = new Set<string>()
  collectPersistedMaskPaths(project, reachable)
  for (const retainedPath of retainedPaths) reachable.add(path.resolve(retainedPath))

  const realMasksDir = await fs.realpath(masksDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (!realMasksDir) return { deleted: 0, retained: 0 }
  const entries = await fs.readdir(realMasksDir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  let deleted = 0
  let retained = 0
  const now = Date.now()
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || path.extname(entry.name).toLowerCase() !== '.pgm') continue
    const filePath = path.resolve(realMasksDir, entry.name)
    if (reachable.has(filePath)) {
      retained += 1
      continue
    }
    const stats = await fs.lstat(filePath)
    if (minimumAgeMs > 0 && now - stats.mtimeMs < minimumAgeMs) {
      retained += 1
      continue
    }
    await fs.rm(filePath, { force: true })
    deleted += 1
  }
  return { deleted, retained }
}
