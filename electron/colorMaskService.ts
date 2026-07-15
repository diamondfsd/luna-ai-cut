import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const PROJECTS_DIR = 'workspace-projects'
const MASKS_DIR = 'masks'
const MAX_MASK_PIXELS = 100_000_000

function safePathSegment(value: string, fallback: string): string {
  return value.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || fallback
}

function projectDirectory(downloadDir: string, projectId: string): string {
  const safeProjectId = safePathSegment(projectId, '')
  if (!safeProjectId || safeProjectId !== projectId) throw new Error('项目标识无效')
  return path.resolve(downloadDir, PROJECTS_DIR, safeProjectId)
}

function maskDirectory(downloadDir: string, projectId: string): string {
  return path.join(projectDirectory(downloadDir, projectId), MASKS_DIR)
}

async function resolveExistingMaskPath(downloadDir: string, projectId: string, filePath: string): Promise<string> {
  const root = await fs.realpath(maskDirectory(downloadDir, projectId))
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
  offset += 1
  if (buffer.length - offset !== pixels) throw new Error('蒙版文件数据不完整')
  return { width, height, bytes: new Uint8Array(buffer.subarray(offset)) }
}

export async function saveColorMask(
  downloadDir: string,
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

  const projectDir = projectDirectory(downloadDir, projectId)
  await fs.access(path.join(projectDir, 'project.json'))
  const masksDir = maskDirectory(downloadDir, projectId)
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
  downloadDir: string,
  projectId: string,
  filePath: string,
): Promise<{ width: number; height: number; bytes: ArrayBuffer }> {
  const parsed = parsePgm(await fs.readFile(await resolveExistingMaskPath(downloadDir, projectId, filePath)))
  const bytes = parsed.bytes.buffer.slice(parsed.bytes.byteOffset, parsed.bytes.byteOffset + parsed.bytes.byteLength) as ArrayBuffer
  return { width: parsed.width, height: parsed.height, bytes }
}

export async function deleteColorMask(downloadDir: string, projectId: string, filePath: string): Promise<void> {
  await fs.rm(await resolveExistingMaskPath(downloadDir, projectId, filePath), { force: true })
}
