#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { Transform } from 'node:stream'

const RELEASE_TAG = 'birefnet-mps-resources-v1.0.0'
const root = join(import.meta.dirname, '..')
const outputDir = join(root, 'release', 'runtime-resources', RELEASE_TAG)
const manifestPath = join(outputDir, `${RELEASE_TAG}.json`)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const token = process.env.GITCODE_TOKEN
const owner = process.env.GITCODE_OWNER ?? 'diamondfsd'
const repo = process.env.GITCODE_REPO ?? 'luna-ai-cut-package-release'
const apiBase = `https://api.gitcode.com/api/v5/repos/${owner}/${repo}`
const downloadBase = `https://gitcode.com/${owner}/${repo}/releases/download/${RELEASE_TAG}`

if (!token) throw new Error('上传需要 GITCODE_TOKEN')

async function apiRequest(url, options, label, allowed = []) {
  const response = await fetch(url, options)
  if (!response.ok && !allowed.includes(response.status)) {
    const detail = (await response.text()).slice(0, 500)
    throw new Error(`${label}失败: HTTP ${response.status}${detail ? ` ${detail}` : ''}`)
  }
  return response
}

async function getRelease() {
  const response = await apiRequest(`${apiBase}/releases/tags/${RELEASE_TAG}`, {
    headers: { 'PRIVATE-TOKEN': token },
  }, '查询 GitCode Release', [404])
  return response.status === 404 ? null : await response.json()
}

async function ensureRelease() {
  const existing = await getRelease()
  if (existing) return existing
  await apiRequest(`${apiBase}/releases`, {
    method: 'POST',
    headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: RELEASE_TAG,
      name: 'Luna AI Cut BiRefNet MPS Resources v1.0.0',
      body: 'BiRefNet MPS 按需下载资源，包含独立 macOS ARM64 Python/PyTorch Runtime 与离线模型。',
    }),
  }, '创建 GitCode Release')
  return await getRelease()
}

function releaseAssets(release) {
  return Array.isArray(release?.assets) ? release.assets : []
}

async function upload(path) {
  const fileName = basename(path)
  const size = statSync(path).size
  const response = await apiRequest(
    `${apiBase}/releases/${RELEASE_TAG}/upload_url?file_name=${encodeURIComponent(fileName)}`,
    { headers: { 'PRIVATE-TOKEN': token } },
    `获取 ${fileName} 上传地址`,
  )
  const payload = await response.json()
  if (!payload.url) throw new Error(`获取 ${fileName} 上传地址失败: 响应缺少 url`)
  let uploaded = 0
  let reported = -1
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      uploaded += chunk.byteLength
      const percent = Math.floor(uploaded / size * 10) * 10
      if (percent !== reported) {
        reported = percent
        console.log(`[gitcode] 上传 ${fileName}: ${Math.min(100, percent)}%`)
      }
      callback(null, chunk)
    },
  })
  const uploadResponse = await fetch(payload.url, {
    method: 'PUT',
    headers: { ...(payload.headers ?? {}), 'Content-Length': String(size) },
    body: createReadStream(path).pipe(progress),
    duplex: 'half',
  })
  if (!uploadResponse.ok) throw new Error(`上传 ${fileName} 失败: HTTP ${uploadResponse.status}`)
}

async function hashRemote(url) {
  const response = await apiRequest(url, {}, `验证 ${url}`)
  if (!response.body) throw new Error(`验证失败: ${url} 没有响应内容`)
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of response.body) {
    hash.update(chunk)
    bytes += chunk.byteLength
  }
  return { bytes, sha256: hash.digest('hex') }
}

const artifacts = [
  ...manifest.packs.map((pack) => ({
    path: join(outputDir, pack.fileName),
    fileName: pack.fileName,
    bytes: pack.archiveBytes,
    sha256: pack.sha256,
  })),
  {
    path: manifestPath,
    fileName: basename(manifestPath),
    bytes: statSync(manifestPath).size,
    sha256: createHash('sha256').update(readFileSync(manifestPath)).digest('hex'),
  },
]

let release = await ensureRelease()
for (const artifact of artifacts) {
  if (!releaseAssets(release).some((asset) => asset.name === artifact.fileName)) {
    await upload(artifact.path)
    release = await getRelease()
  }
}

for (const artifact of artifacts) {
  const url = `${downloadBase}/${encodeURIComponent(artifact.fileName)}`
  const remote = await hashRemote(url)
  if (remote.bytes !== artifact.bytes || remote.sha256 !== artifact.sha256) {
    throw new Error(`${artifact.fileName} 远端校验失败`)
  }
  console.log(`[gitcode] 已验证 ${artifact.fileName}: ${remote.bytes} bytes ${remote.sha256}`)
}

console.log(`[gitcode] https://gitcode.com/${owner}/${repo}/releases/tag/${RELEASE_TAG}`)
