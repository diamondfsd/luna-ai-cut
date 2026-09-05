import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { downloadVerifiedFile, writeAll } from '../media/resumableDownloadService.js'

const REQUIRED_FILES = [
  'dist-electron/luna-appMain.js',
  'dist-electron/preload.mjs',
  'dist/index.html',
]
const INSTALL_ENTRIES = ['dist-electron', 'dist', 'pending-native', 'macos-native', 'swift', 'package.json']
const DOWNLOAD_ATTEMPTS = 3

export interface HotUpdateIntegrity {
  sha256: string
  sizeBytes: number
}

export interface HotUpdateArchive {
  version: string
  zipName: string
  downloadUrl: string
  integrity?: HotUpdateIntegrity
}

export interface HotUpdateInstallOptions {
  fetcher?: typeof fetch
}

function safeArchiveName(value: string): boolean {
  return path.basename(value) === value
    && /^renderer-\d+\.\d+\.\d+(?:-beta\.\d+)?-hot\.\d+(?:-[a-z0-9-]+)?\.zip$/.test(value)
}

function safeArchiveEntry(entry: AdmZip.IZipEntry): void {
  const name = entry.entryName
  if (!name || name.includes('\\') || name.includes('\0') || path.posix.isAbsolute(name) || path.win32.isAbsolute(name)) {
    throw new Error('热更新包包含不安全的文件路径')
  }
  const parts = name.replace(/\/$/, '').split('/')
  if (parts.some((part) => !part || part === '.' || part === '..' || part.includes(':') || Array.from(part).some((character) => character.charCodeAt(0) <= 31))) {
    throw new Error('热更新包包含不安全的文件路径')
  }
  if (entry.isDirectory) return

  const unixMode = (entry.attr >>> 16) & 0xffff
  const fileType = unixMode & 0xf000
  if (fileType === 0xa000 || (fileType !== 0 && fileType !== 0x8000)) {
    throw new Error('热更新包包含不支持的文件')
  }
}

function inspectArchive(archivePath: string): AdmZip {
  let zip: AdmZip
  try {
    zip = new AdmZip(archivePath)
  } catch {
    throw new Error('更新包格式异常')
  }

  const entries = zip.getEntries()
  const seen = new Set<string>()
  for (const entry of entries) {
    safeArchiveEntry(entry)
    if (entry.isDirectory) continue
    const key = entry.entryName.toLocaleLowerCase('en-US')
    if (seen.has(key)) throw new Error('热更新包包含重复文件')
    seen.add(key)
    try {
      const content = entry.getData()
      if (content.byteLength !== entry.header.size) throw new Error('大小不匹配')
    } catch {
      throw new Error('更新包内容损坏')
    }
  }
  for (const requiredFile of REQUIRED_FILES) {
    const entry = zip.getEntry(requiredFile)
    if (!entry || entry.isDirectory) throw new Error('热更新包内容不完整')
  }
  return zip
}

function validIntegrity(integrity: HotUpdateIntegrity | undefined): integrity is HotUpdateIntegrity {
  return Boolean(
    integrity
    && Number.isInteger(integrity.sizeBytes)
    && integrity.sizeBytes > 0
    && /^[a-f0-9]{64}$/.test(integrity.sha256),
  )
}

function retryDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 350 * attempt))
}

async function writeResponseBody(response: Response, destination: string): Promise<number> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('下载热更新失败，未收到更新内容')
  const handle = await open(destination, 'w', 0o600)
  let completedBytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return completedBytes
      if (!value) continue
      await writeAll(handle, value)
      completedBytes += value.byteLength
    }
  } finally {
    await handle.close()
  }
}

async function downloadLegacyArchive(archive: HotUpdateArchive, downloadDir: string, fetcher: typeof fetch): Promise<string> {
  const archivePath = path.join(downloadDir, archive.zipName)
  const temporaryPath = `${archivePath}.download`
  if (existsSync(archivePath)) {
    try {
      inspectArchive(archivePath)
      return archivePath
    } catch {
      rmSync(archivePath, { force: true })
    }
  }

  let lastError: unknown
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      rmSync(temporaryPath, { force: true })
      const response = await fetcher(archive.downloadUrl, { redirect: 'follow' })
      if (!response.ok) throw new Error(`下载热更新失败 (${response.status})`)
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
      if (contentType.includes('text/html')) throw new Error('下载热更新失败，服务器返回了错误页面')

      const downloadedBytes = await writeResponseBody(response, temporaryPath)
      const expectedBytes = Number(response.headers.get('content-length'))
      if (Number.isFinite(expectedBytes) && expectedBytes >= 0 && downloadedBytes !== expectedBytes) {
        throw new Error('热更新下载不完整')
      }
      inspectArchive(temporaryPath)
      renameSync(temporaryPath, archivePath)
      return archivePath
    } catch (error) {
      lastError = error
      rmSync(temporaryPath, { force: true })
      rmSync(archivePath, { force: true })
      if (attempt < DOWNLOAD_ATTEMPTS) await retryDelay(attempt)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('下载热更新失败，请稍后重试')
}

async function downloadArchive(archive: HotUpdateArchive, downloadDir: string, fetcher: typeof fetch): Promise<string> {
  if (!safeArchiveName(archive.zipName)) throw new Error('热更新包名称异常')
  mkdirSync(downloadDir, { recursive: true, mode: 0o700 })
  if (!validIntegrity(archive.integrity)) return downloadLegacyArchive(archive, downloadDir, fetcher)

  let lastError: unknown
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      const archivePath = await downloadVerifiedFile(downloadDir, {
        fileName: archive.zipName,
        url: archive.downloadUrl,
        sha256: archive.integrity.sha256,
        sizeBytes: archive.integrity.sizeBytes,
      }, { label: '热更新包', fetcher })
      try {
        inspectArchive(archivePath)
      } catch (error) {
        rmSync(archivePath, { force: true })
        throw error
      }
      return archivePath
    } catch (error) {
      lastError = error
      if (attempt < DOWNLOAD_ATTEMPTS) await retryDelay(attempt)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('下载热更新失败，请稍后重试')
}

function resolveContentRoot(extractDir: string): string {
  if (REQUIRED_FILES.every((file) => existsSync(path.join(extractDir, file)))) return extractDir
  const entries = readdirSync(extractDir, { withFileTypes: true })
  if (entries.length === 1 && entries[0].isDirectory()) {
    const nestedRoot = path.join(extractDir, entries[0].name)
    if (REQUIRED_FILES.every((file) => existsSync(path.join(nestedRoot, file)))) return nestedRoot
  }
  throw new Error('热更新包目录结构异常')
}

function writeVersionAtomically(hotDir: string, version: string): void {
  const destination = path.join(hotDir, 'version.json')
  const temporary = path.join(hotDir, '.version.json.new')
  writeFileSync(temporary, JSON.stringify({ version, updatedAt: new Date().toISOString() }), { encoding: 'utf-8', mode: 0o600 })
  renameSync(temporary, destination)
}

function installArchive(hotDir: string, archivePath: string, version: string): void {
  const stagingDir = path.join(hotDir, '.install-staging')
  const extractDir = path.join(stagingDir, 'extract')
  const backupDir = path.join(stagingDir, 'backup')
  rmSync(stagingDir, { recursive: true, force: true })
  mkdirSync(extractDir, { recursive: true, mode: 0o700 })

  try {
    const zip = inspectArchive(archivePath)
    // macOS native helpers must retain their executable bit after extraction.
    zip.extractAllTo(extractDir, true, true)
    const contentRoot = resolveContentRoot(extractDir)
    writeFileSync(
      path.join(contentRoot, 'package.json'),
      JSON.stringify({ type: 'module', name: 'luna-ai-cut-hot', private: true }),
      { encoding: 'utf-8', mode: 0o600 },
    )

    const entriesToInstall = INSTALL_ENTRIES.filter((entry) => existsSync(path.join(contentRoot, entry)))
    const movedOldEntries: string[] = []
    const movedNewEntries: string[] = []
    mkdirSync(backupDir, { recursive: true, mode: 0o700 })
    try {
      for (const entry of [...INSTALL_ENTRIES, 'version.json']) {
        const destination = path.join(hotDir, entry)
        if (!existsSync(destination)) continue
        renameSync(destination, path.join(backupDir, entry))
        movedOldEntries.push(entry)
      }
      for (const entry of entriesToInstall) {
        renameSync(path.join(contentRoot, entry), path.join(hotDir, entry))
        movedNewEntries.push(entry)
      }
      writeVersionAtomically(hotDir, version)
      movedNewEntries.push('version.json')
    } catch (error) {
      rmSync(path.join(hotDir, '.version.json.new'), { force: true })
      for (const entry of movedNewEntries.reverse()) {
        rmSync(path.join(hotDir, entry), { recursive: true, force: true })
      }
      for (const entry of movedOldEntries.reverse()) {
        const source = path.join(backupDir, entry)
        if (existsSync(source)) renameSync(source, path.join(hotDir, entry))
      }
      throw error
    }
  } finally {
    rmSync(stagingDir, { recursive: true, force: true })
  }
}

export async function installHotUpdateArchive(
  hotDir: string,
  archive: HotUpdateArchive,
  options: HotUpdateInstallOptions = {},
): Promise<void> {
  const archivePath = await downloadArchive(archive, path.join(hotDir, '.downloads'), options.fetcher ?? fetch)
  installArchive(hotDir, archivePath, archive.version)
}
