import { execFileSync } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { APPLE_DEVICE_SUPPORT_INSTALLER } from '../src/shared/appleDeviceSupport.ts'
import { gitCodeReleaseDownloadUrl } from './model-resource-release.mjs'

const root = path.resolve(import.meta.dirname, '..')
const configPath = path.join(root, 'scripts', 'deploy-release.conf')
const config = execFileSync('/bin/bash', ['-c',
  'source "$1"; printf "%s\\n" "$GITCODE_TOKEN" "$GITCODE_OWNER" "$GITCODE_REPO"',
  'apple-driver-release', configPath,
], { encoding: 'utf8' }).trimEnd().split('\n')
const [token, configuredOwner, configuredRepo] = config
if (!token) throw new Error('GitCode 发布凭证缺失')
const owner = configuredOwner || 'diamondfsd'
const repo = configuredRepo || 'luna-ai-cut-package-release'
const definition = APPLE_DEVICE_SUPPORT_INSTALLER
const filePath = process.argv[2]
if (!filePath) throw new Error('请提供已下载的 AppleMobileDeviceSupport64.msi 路径')
const bytes = await readFile(filePath)
const sha256 = createHash('sha256').update(bytes).digest('hex')
if ((await stat(filePath)).size !== definition.sizeBytes || sha256 !== definition.sha256) {
  throw new Error('安装包大小或 SHA256 与固定清单不一致')
}

const api = `https://api.gitcode.com/api/v5/repos/${owner}/${repo}`
const headers = { 'PRIVATE-TOKEN': token }
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(180_000) })
  if (!response.ok) throw new Error(`GitCode 请求失败：HTTP ${response.status}`)
  return response
}
async function getRelease() {
  return (await request(`${api}/releases/tags/${definition.releaseTag}`, { headers })).json()
}

const existing = await fetch(`${api}/releases/tags/${definition.releaseTag}`, { headers, signal: AbortSignal.timeout(30_000) })
if (existing.status === 404) {
  await request(`${api}/releases`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_name: definition.releaseTag, name: 'Luna AI Cut Windows Drivers v1.0.0',
      body: 'Windows iPhone 连接所需 Apple Mobile Device Support 19.4.0.10 x64。固定大小及 SHA256 校验，用户主动安装。' }),
  })
} else if (!existing.ok) {
  throw new Error(`查询 GitCode Release 失败：HTTP ${existing.status}`)
}

const manifest = {
  name: 'Apple Mobile Device Support', publisher: 'Apple Inc.', license: 'Proprietary',
  version: definition.version, architecture: definition.architecture,
  fileName: definition.fileName, sizeBytes: definition.sizeBytes, sha256,
  upstreamUrl: definition.mirrors[0],
  manifestSource: 'https://github.com/microsoft/winget-pkgs/tree/master/manifests/a/Apple/AppleMobileDeviceSupport/19.4.0.10',
}
const uploads = [
  { fileName: definition.fileName, bytes },
  { fileName: `apple-mobile-device-support-${definition.version}.json`, bytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) },
]
let release = await getRelease()
for (const upload of uploads) {
  if (!release.assets?.some(asset => asset.name === upload.fileName)) {
    const payload = await (await request(
      `${api}/releases/${definition.releaseTag}/upload_url?file_name=${encodeURIComponent(upload.fileName)}`, { headers },
    )).json()
    if (!payload.url) throw new Error('GitCode 未返回上传地址')
    await request(payload.url, { method: 'PUT', headers: payload.headers ?? {}, body: upload.bytes })
    release = await getRelease()
  }
  const url = gitCodeReleaseDownloadUrl({ owner, repo, releaseTag: definition.releaseTag, fileName: upload.fileName })
  const response = await request(url)
  const hash = createHash('sha256')
  let receivedBytes = 0
  for await (const chunk of response.body) {
    receivedBytes += chunk.byteLength
    hash.update(chunk)
  }
  if (receivedBytes !== upload.bytes.byteLength || hash.digest('hex') !== createHash('sha256').update(upload.bytes).digest('hex')) {
    throw new Error(`GitCode 回读校验失败：${upload.fileName}`)
  }
  console.log(`已发布并验证：${url}`)
}
