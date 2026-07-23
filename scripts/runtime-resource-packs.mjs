import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import AdmZip from 'adm-zip'

export const RESOURCE_RELEASE_VERSION = '1.0.0'
export const RESOURCE_RELEASE_TAG = `runtime-resources-v${RESOURCE_RELEASE_VERSION}`
export const RESOURCE_MANIFEST_NAME = `${RESOURCE_RELEASE_TAG}.json`

const FIXED_ZIP_TIME = new Date('1980-01-01T00:00:00.000Z')
const DEFAULT_OWNER = 'diamondfsd'
const DEFAULT_REPO = 'luna-ai-cut-package-release'

export const RESOURCE_PACKS = [
  {
    id: 'source-han-sans-sc',
    kind: 'font',
    version: RESOURCE_RELEASE_VERSION,
    sourceDir: 'public/fonts',
    archiveRoot: 'fonts',
    fileName: `luna-runtime-fonts-v${RESOURCE_RELEASE_VERSION}.zip`,
  },
  {
    id: 'builtin-luts',
    kind: 'lut',
    version: RESOURCE_RELEASE_VERSION,
    sourceDir: 'public/luts',
    archiveRoot: 'luts',
    fileName: `luna-runtime-luts-v${RESOURCE_RELEASE_VERSION}.zip`,
  },
]

function toPosix(path) {
  return path.split(sep).join('/')
}

function listFiles(rootDir) {
  const root = resolve(rootDir)
  const files = []

  function visit(directory) {
    for (const name of readdirSync(directory).sort((a, b) => a.localeCompare(b, 'en'))) {
      const path = join(directory, name)
      const stats = statSync(path)
      if (stats.isDirectory()) visit(path)
      else if (stats.isFile()) files.push(path)
    }
  }

  visit(root)
  return files.sort((a, b) => toPosix(relative(root, a)).localeCompare(toPosix(relative(root, b)), 'en'))
}

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

export function sha256File(path) {
  return sha256Buffer(readFileSync(path))
}

function buildPack(rootDir, outputDir, definition) {
  const sourceDir = resolve(rootDir, definition.sourceDir)
  if (!existsSync(sourceDir)) throw new Error(`资源目录不存在: ${sourceDir}`)

  const zip = new AdmZip()
  const files = listFiles(sourceDir).map((path) => {
    const content = readFileSync(path)
    const relativePath = toPosix(relative(sourceDir, path))
    const archivePath = `${definition.archiveRoot}/${relativePath}`
    zip.addFile(archivePath, content)
    const entry = zip.getEntry(archivePath)
    if (entry) {
      entry.header.time = FIXED_ZIP_TIME
      entry.attr = 0o100644 << 16
    }
    return {
      path: archivePath,
      bytes: content.byteLength,
      sha256: sha256Buffer(content),
    }
  })

  if (files.length === 0) throw new Error(`资源目录为空: ${sourceDir}`)

  const outputPath = join(outputDir, definition.fileName)
  zip.writeZip(outputPath)
  return {
    id: definition.id,
    kind: definition.kind,
    version: definition.version,
    fileName: definition.fileName,
    archiveBytes: statSync(outputPath).size,
    unpackedBytes: files.reduce((total, file) => total + file.bytes, 0),
    sha256: sha256File(outputPath),
    files,
    outputPath,
  }
}

export function buildRuntimeResourceRelease({
  rootDir = process.cwd(),
  outputDir = join(rootDir, 'release', 'runtime-resources', RESOURCE_RELEASE_TAG),
  owner = DEFAULT_OWNER,
  repo = DEFAULT_REPO,
} = {}) {
  mkdirSync(outputDir, { recursive: true })
  const packs = RESOURCE_PACKS.map((definition) => buildPack(rootDir, outputDir, definition))
  const downloadBase = `https://gitcode.com/${owner}/${repo}/releases/download/${RESOURCE_RELEASE_TAG}`
  const manifest = {
    schemaVersion: 1,
    releaseTag: RESOURCE_RELEASE_TAG,
    releaseVersion: RESOURCE_RELEASE_VERSION,
    repository: `${owner}/${repo}`,
    packs: packs.map((pack) => ({
      id: pack.id,
      kind: pack.kind,
      version: pack.version,
      fileName: pack.fileName,
      archiveBytes: pack.archiveBytes,
      unpackedBytes: pack.unpackedBytes,
      sha256: pack.sha256,
      files: pack.files,
      url: `${downloadBase}/${encodeURIComponent(pack.fileName)}`,
    })),
  }
  const manifestPath = join(outputDir, RESOURCE_MANIFEST_NAME)
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return { outputDir, manifest, manifestPath, packs }
}

async function gitCodeRequest(url, options, label) {
  const response = await fetch(url, options)
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500)
    throw new Error(`${label}失败: HTTP ${response.status}${detail ? ` ${detail}` : ''}`)
  }
  return response
}

async function getRelease(api, token) {
  const response = await fetch(`${api}/releases/tags/${RESOURCE_RELEASE_TAG}`, {
    headers: { 'PRIVATE-TOKEN': token },
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`查询 GitCode Release 失败: HTTP ${response.status}`)
  return response.json()
}

async function ensureRelease(api, token) {
  const existing = await getRelease(api, token)
  if (existing) return existing
  await gitCodeRequest(`${api}/releases`, {
    method: 'POST',
    headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: RESOURCE_RELEASE_TAG,
      name: `Luna AI Cut Runtime Resources v${RESOURCE_RELEASE_VERSION}`,
      body: 'Luna AI Cut 按需下载的运行时静态资源。本版本包含字体与内置 LUT；后续模型资源沿用 runtime-resources 发布通道。',
    }),
  }, '创建 GitCode Release')
  return getRelease(api, token)
}

function releaseAssets(release) {
  return Array.isArray(release?.assets) ? release.assets : []
}

async function uploadAsset(api, token, path) {
  const fileName = basename(path)
  const response = await gitCodeRequest(
    `${api}/releases/${RESOURCE_RELEASE_TAG}/upload_url?file_name=${encodeURIComponent(fileName)}`,
    { headers: { 'PRIVATE-TOKEN': token } },
    `获取 ${fileName} 上传地址`,
  )
  const payload = await response.json()
  if (!payload.url) throw new Error(`获取 ${fileName} 上传地址失败: 响应缺少 url`)
  await gitCodeRequest(payload.url, {
    method: 'PUT',
    headers: payload.headers ?? {},
    body: readFileSync(path),
  }, `上传 ${fileName}`)
}

async function hashDownload(url) {
  const response = await gitCodeRequest(url, {}, `下载验证 ${url}`)
  if (!response.body) throw new Error(`下载验证失败: ${url} 没有响应内容`)
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of response.body) {
    hash.update(chunk)
    bytes += chunk.byteLength
  }
  return { bytes, sha256: hash.digest('hex') }
}

export async function publishRuntimeResourceRelease(build, {
  token = process.env.GITCODE_TOKEN,
  owner = process.env.GITCODE_OWNER ?? DEFAULT_OWNER,
  repo = process.env.GITCODE_REPO ?? DEFAULT_REPO,
} = {}) {
  if (!token) throw new Error('上传需要 GITCODE_TOKEN')
  const api = `https://api.gitcode.com/api/v5/repos/${owner}/${repo}`
  let release = await ensureRelease(api, token)
  const artifacts = [
    ...build.packs.map((pack) => ({ path: pack.outputPath, bytes: pack.archiveBytes, sha256: pack.sha256 })),
    {
      path: build.manifestPath,
      bytes: statSync(build.manifestPath).size,
      sha256: sha256File(build.manifestPath),
    },
  ]

  for (const artifact of artifacts) {
    const name = basename(artifact.path)
    if (!releaseAssets(release).some((asset) => asset.name === name)) {
      await uploadAsset(api, token, artifact.path)
      release = await getRelease(api, token)
    }
  }

  const verified = []
  for (const artifact of artifacts) {
    const name = basename(artifact.path)
    const asset = releaseAssets(release).find((candidate) => candidate.name === name)
    if (!asset) throw new Error(`GitCode Release 缺少附件: ${name}`)
    const url = `https://gitcode.com/${owner}/${repo}/releases/download/${RESOURCE_RELEASE_TAG}/${encodeURIComponent(name)}`
    const remote = await hashDownload(url)
    if (remote.bytes !== artifact.bytes || remote.sha256 !== artifact.sha256) {
      throw new Error(`${name} 远端校验失败`)
    }
    verified.push({ name, url, ...remote })
  }
  return { releaseUrl: `https://gitcode.com/${owner}/${repo}/releases/tag/${RESOURCE_RELEASE_TAG}`, verified }
}

export function inspectZip(path) {
  return new AdmZip(path).getEntries().filter((entry) => !entry.isDirectory).map((entry) => entry.entryName)
}
