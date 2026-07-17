import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmod, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import AdmZip from 'adm-zip'
import {
  downloadVerifiedFile,
  type DownloadProgress,
} from './resumableDownloadService.js'
import { SharedLoadRegistry } from './sharedLoadRegistry.js'
import type { RuntimeResourceDefinition } from './runtimeResourceDefinitions.js'

const MARKER_NAME = '.luna-resource.json'
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
const execFileAsync = promisify(execFile)

interface InstalledFile {
  path: string
  bytes: number
}

interface InstallMarker {
  schemaVersion: 1
  id: string
  version: string
  archiveSha256: string
  files: InstalledFile[]
}

export interface RuntimeResourceProgress {
  phase: 'download' | 'install' | 'verify'
  completedBytes: number
  totalBytes: number
  resumedBytes?: number
}

export interface RuntimeResourceLoadOptions {
  signal?: AbortSignal
  onProgress?: (progress: RuntimeResourceProgress) => void
  fetcher?: typeof fetch
  sevenZipPath?: string
}

const loads = new SharedLoadRegistry<string, string, RuntimeResourceProgress>()

function validateDefinition(definition: RuntimeResourceDefinition): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(definition.id) || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(definition.version)) {
    throw new Error('资源标识不安全')
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(definition.archiveRoot)) throw new Error('资源根目录不安全')
  const expectedSuffix = definition.archiveFormat === '7z' ? '.7z' : '.zip'
  if (path.basename(definition.fileName) !== definition.fileName || !definition.fileName.endsWith(expectedSuffix)) {
    throw new Error('资源包文件名不安全')
  }
  if (!Number.isInteger(definition.unpackedBytes) || definition.unpackedBytes <= 0) throw new Error('资源解包大小异常')
  if (!Number.isInteger(definition.expectedFileCount) || definition.expectedFileCount <= 0) throw new Error('资源文件数量异常')
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) <= 31)
}

function safeEntryPath(entryName: string, definition: RuntimeResourceDefinition): string {
  if (!entryName || entryName.includes('\\') || entryName.includes('\0') || path.posix.isAbsolute(entryName) || path.win32.isAbsolute(entryName)) {
    throw new Error('资源包包含不安全路径')
  }
  const parts = entryName.split('/')
  if (parts.length < 2 || parts.some((part) => (
    !part || part === '.' || part === '..' || part.includes(':') || hasControlCharacter(part)
  ))) {
    throw new Error('资源包包含不安全路径')
  }
  if (parts[0] !== definition.archiveRoot) throw new Error('资源包根目录不匹配')
  const extension = path.posix.extname(entryName).toLowerCase()
  if (definition.allowedExtensions && !definition.allowedExtensions.includes(extension)) throw new Error('资源包包含不允许的文件类型')
  return parts.join('/')
}

function rejectLink(entry: AdmZip.IZipEntry): void {
  const unixMode = (entry.attr >>> 16) & 0xffff
  const fileType = unixMode & 0xf000
  if (fileType === 0xa000) throw new Error('资源包不允许符号链接')
  if (fileType !== 0 && fileType !== 0x8000) throw new Error('资源包包含不支持的文件类型')
}

async function listFiles(root: string, relative = ''): Promise<string[]> {
  const directory = path.join(root, relative)
  const names = await readdir(directory)
  const files: string[] = []
  for (const name of names.sort((a, b) => a.localeCompare(b, 'en'))) {
    const childRelative = relative ? `${relative}/${name}` : name
    const info = await lstat(path.join(root, childRelative))
    if (info.isSymbolicLink()) throw new Error('资源缓存包含符号链接')
    if (info.isDirectory()) files.push(...await listFiles(root, childRelative))
    else if (info.isFile()) files.push(childRelative)
    else throw new Error('资源缓存包含不支持的文件类型')
  }
  return files
}

function isMarker(value: unknown, definition: RuntimeResourceDefinition): value is InstallMarker {
  if (!value || typeof value !== 'object') return false
  const marker = value as Partial<InstallMarker>
  return marker.schemaVersion === 1 && marker.id === definition.id && marker.version === definition.version
    && marker.archiveSha256 === definition.sha256 && Array.isArray(marker.files)
    && marker.files.length === definition.expectedFileCount
}

async function validateCache(
  installDir: string,
  definition: RuntimeResourceDefinition,
  report?: (progress: RuntimeResourceProgress) => void,
  signal?: AbortSignal,
): Promise<boolean> {
  let marker: unknown
  try {
    marker = JSON.parse(await readFile(path.join(installDir, MARKER_NAME), 'utf8'))
  } catch {
    return false
  }
  if (!isMarker(marker, definition)) return false
  try {
    const diskFiles = (await listFiles(installDir)).filter((file) => file !== MARKER_NAME).sort()
    const markerPaths = marker.files.map((file) => file.path).sort()
    if (diskFiles.length !== markerPaths.length || diskFiles.some((file, index) => file !== markerPaths[index])) return false
    let completedBytes = 0
    for (const file of marker.files) {
      signal?.throwIfAborted()
      if (safeEntryPath(file.path, definition) !== file.path || !Number.isInteger(file.bytes) || file.bytes < 0) return false
      const info = await lstat(path.join(installDir, file.path))
      if (!info.isFile() || info.size !== file.bytes) return false
      completedBytes += file.bytes
      report?.({ phase: 'verify', completedBytes, totalBytes: definition.unpackedBytes })
    }
    return completedBytes === definition.unpackedBytes
  } catch (error) {
    if (signal?.aborted) throw error
    return false
  }
}

function inspectArchive(zip: AdmZip, definition: RuntimeResourceDefinition): Array<{ entry: AdmZip.IZipEntry; path: string }> {
  const seen = new Set<string>()
  let totalBytes = 0
  const files = zip.getEntries().map((entry) => {
    if (entry.isDirectory) throw new Error('资源包包含非预期目录项')
    rejectLink(entry)
    const entryPath = safeEntryPath(entry.entryName, definition)
    const comparisonPath = entryPath.toLocaleLowerCase('en-US')
    if (seen.has(comparisonPath)) throw new Error('资源包包含重复文件')
    seen.add(comparisonPath)
    if (!Number.isSafeInteger(entry.header.size) || entry.header.size <= 0) throw new Error('资源文件大小异常')
    totalBytes += entry.header.size
    if (totalBytes > definition.unpackedBytes) throw new Error('资源解包大小异常')
    return { entry, path: entryPath }
  })
  if (files.length !== definition.expectedFileCount || totalBytes !== definition.unpackedBytes) {
    throw new Error('资源包内容与清单不匹配')
  }
  return files
}

async function installArchive(
  archivePath: string,
  stagingDir: string,
  definition: RuntimeResourceDefinition,
  signal: AbortSignal,
  report: (progress: RuntimeResourceProgress) => void,
): Promise<void> {
  const files = inspectArchive(new AdmZip(archivePath), definition)
  const markerFiles: InstalledFile[] = []
  let completedBytes = 0
  for (const { entry, path: entryPath } of files) {
    signal.throwIfAborted()
    const content = entry.getData()
    if (content.byteLength !== entry.header.size) throw new Error('资源文件解包大小异常')
    signal.throwIfAborted()
    const destination = path.join(stagingDir, ...entryPath.split('/'))
    await mkdir(path.dirname(destination), { recursive: true })
    await writeFile(destination, content, { flag: 'wx', mode: 0o600 })
    markerFiles.push({ path: entryPath, bytes: content.byteLength })
    completedBytes += content.byteLength
    report({ phase: 'install', completedBytes, totalBytes: definition.unpackedBytes })
  }
  const marker: InstallMarker = {
    schemaVersion: 1,
    id: definition.id,
    version: definition.version,
    archiveSha256: definition.sha256,
    files: markerFiles,
  }
  await writeFile(path.join(stagingDir, MARKER_NAME), `${JSON.stringify(marker, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
}

interface SevenZipEntry {
  path: string
  size: number
}

function parseSevenZipEntries(output: string, definition: RuntimeResourceDefinition): SevenZipEntry[] {
  const entries: SevenZipEntry[] = []
  const seen = new Set<string>()
  for (const block of output.split(/\r?\n\r?\n/)) {
    const fields = new Map<string, string>()
    for (const line of block.split(/\r?\n/)) {
      const separator = line.indexOf(' = ')
      if (separator > 0) fields.set(line.slice(0, separator), line.slice(separator + 3))
    }
    const entryPath = fields.get('Path')
    if (!entryPath) continue
    const attributes = fields.get('Attributes') ?? ''
    if (attributes.startsWith('D')) {
      if (entryPath !== definition.archiveRoot && !entryPath.startsWith(`${definition.archiveRoot}/`)) {
        throw new Error('资源包根目录不匹配')
      }
      continue
    }
    const safePath = safeEntryPath(entryPath, definition)
    const comparisonPath = safePath.toLocaleLowerCase('en-US')
    if (seen.has(comparisonPath)) throw new Error('资源包包含重复文件')
    seen.add(comparisonPath)
    const size = Number(fields.get('Size'))
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('资源文件大小异常')
    entries.push({ path: safePath, size })
  }
  const totalBytes = entries.reduce((total, entry) => total + entry.size, 0)
  if (entries.length !== definition.expectedFileCount || totalBytes !== definition.unpackedBytes) {
    throw new Error('资源包内容与清单不匹配')
  }
  return entries
}

async function installSevenZipArchive(
  archivePath: string,
  stagingDir: string,
  definition: RuntimeResourceDefinition,
  sevenZipPath: string,
  signal: AbortSignal,
  report: (progress: RuntimeResourceProgress) => void,
): Promise<void> {
  const listResult = await execFileAsync(sevenZipPath, ['l', '-slt', '-ba', archivePath], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    signal,
  })
  const entries = parseSevenZipEntries(listResult.stdout, definition)
  report({ phase: 'install', completedBytes: 0, totalBytes: definition.unpackedBytes })
  await execFileAsync(sevenZipPath, ['x', '-y', `-o${stagingDir}`, archivePath], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    signal,
  })
  const diskFiles = await listFiles(stagingDir)
  if (diskFiles.length !== entries.length) throw new Error('资源解包文件数量异常')
  const entrySizes = new Map(entries.map((entry) => [entry.path, entry.size]))
  const markerFiles: InstalledFile[] = []
  let completedBytes = 0
  for (const file of diskFiles) {
    signal.throwIfAborted()
    const expectedBytes = entrySizes.get(file)
    const info = await lstat(path.join(stagingDir, file))
    if (!info.isFile() || expectedBytes === undefined || info.size !== expectedBytes) throw new Error('资源解包内容异常')
    markerFiles.push({ path: file, bytes: info.size })
    completedBytes += info.size
    report({ phase: 'verify', completedBytes, totalBytes: definition.unpackedBytes })
  }
  for (const executablePath of definition.executablePaths ?? []) {
    if (!entrySizes.has(executablePath)) throw new Error('资源包缺少可执行文件')
    await chmod(path.join(stagingDir, executablePath), 0o755)
  }
  const marker: InstallMarker = {
    schemaVersion: 1,
    id: definition.id,
    version: definition.version,
    archiveSha256: definition.sha256,
    files: markerFiles,
  }
  await writeFile(path.join(stagingDir, MARKER_NAME), `${JSON.stringify(marker, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
}

async function performLoad(
  cacheRoot: string,
  definition: RuntimeResourceDefinition,
  signal: AbortSignal,
  report: (progress: RuntimeResourceProgress) => void,
  fetcher?: typeof fetch,
  sevenZipPath?: string,
): Promise<string> {
  validateDefinition(definition)
  const packRoot = path.join(cacheRoot, definition.id)
  const installDir = path.join(packRoot, definition.version)
  if (await validateCache(installDir, definition, report, signal)) return path.join(installDir, definition.archiveRoot)
  await rm(installDir, { recursive: true, force: true })

  const archivePath = await downloadVerifiedFile(path.join(cacheRoot, '.downloads', definition.id, definition.version), {
    fileName: definition.fileName,
    url: definition.url,
    sha256: definition.sha256,
    sizeBytes: definition.archiveBytes,
  }, {
    signal,
    fetcher,
    maxBytes: MAX_ARCHIVE_BYTES,
    label: '资源包',
    onProgress: (progress: DownloadProgress) => report({ phase: 'download', ...progress }),
  })

  signal.throwIfAborted()
  await mkdir(packRoot, { recursive: true })
  const stagingDir = path.join(packRoot, `.${definition.version}.${randomUUID()}.staging`)
  try {
    await mkdir(stagingDir, { recursive: false })
    if (definition.archiveFormat === '7z') {
      if (!sevenZipPath) throw new Error('缺少资源解压组件')
      await installSevenZipArchive(archivePath, stagingDir, definition, sevenZipPath, signal, report)
    } else {
      await installArchive(archivePath, stagingDir, definition, signal, report)
    }
    signal.throwIfAborted()
    if (!await validateCache(stagingDir, definition, report, signal)) throw new Error('资源安装校验失败')
    await rename(stagingDir, installDir)
    await rm(archivePath, { force: true })
    return path.join(installDir, definition.archiveRoot)
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true })
    throw error
  }
}

export function loadRuntimeResource(
  cacheRoot: string,
  definition: RuntimeResourceDefinition,
  options: RuntimeResourceLoadOptions = {},
): Promise<string> {
  const key = `${path.resolve(cacheRoot)}\0${definition.id}\0${definition.version}\0${definition.sha256}`
  return loads.load(key, (signal, report) => performLoad(cacheRoot, definition, signal, report, options.fetcher, options.sevenZipPath), options)
}

export async function getRuntimeResourceCachePath(
  cacheRoot: string,
  definition: RuntimeResourceDefinition,
  options: Pick<RuntimeResourceLoadOptions, 'signal' | 'onProgress'> = {},
): Promise<string | null> {
  const installDir = path.join(cacheRoot, definition.id, definition.version)
  return await validateCache(installDir, definition, options.onProgress, options.signal)
    ? path.join(installDir, definition.archiveRoot)
    : null
}
