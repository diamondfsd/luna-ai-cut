import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { basename, dirname, join, resolve } from 'node:path'
import process from 'node:process'
import {
  BUILD_DEPENDENCY_DOWNLOAD_BASE,
  BUILD_DEPENDENCY_OWNER,
  BUILD_DEPENDENCY_RELEASE_TAG,
  BUILD_DEPENDENCY_REPO,
} from './build-dependency-sources.mjs'

function loadLocalConfig() {
  let directory = resolve(process.cwd())
  for (let depth = 0; depth < 4; depth += 1) {
    const configPath = join(directory, 'scripts', 'deploy-release.conf')
    if (existsSync(configPath)) {
      for (const line of readFileSync(configPath, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*(?:export\s+)?(GITCODE_TOKEN|GITCODE_OWNER|GITCODE_REPO)=(.*)$/)
        if (!match || process.env[match[1]]) continue
        let value = match[2].trim()
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        process.env[match[1]] = value
      }
      return
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
}

loadLocalConfig()

const token = process.env.GITCODE_TOKEN
if (!token) throw new Error('上传需要 GITCODE_TOKEN 或 scripts/deploy-release.conf')

const owner = process.env.GITCODE_OWNER ?? BUILD_DEPENDENCY_OWNER
const repo = process.env.GITCODE_REPO ?? BUILD_DEPENDENCY_REPO
const api = `https://api.gitcode.com/api/v5/repos/${owner}/${repo}`

function request(url, { method = 'GET', headers = {}, body, filePath } = {}, redirects = 5) {
  return new Promise((resolveRequest, rejectRequest) => {
    const parsed = new URL(url)
    const transport = parsed.protocol === 'http:' ? http : https
    const requestOptions = { method, headers }
    const requestInstance = transport.request(parsed, requestOptions, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects > 0 && (method === 'GET' || method === 'HEAD')) {
        response.resume()
        resolveRequest(request(new URL(response.headers.location, url).href, { method, headers }, redirects - 1))
        return
      }

      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolveRequest({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }))
      response.on('error', rejectRequest)
    })
    requestInstance.setTimeout(30_000, () => requestInstance.destroy(new Error(`请求超时: ${url}`)))
    requestInstance.on('error', rejectRequest)

    if (filePath) {
      const stream = createReadStream(filePath)
      stream.on('error', rejectRequest)
      stream.pipe(requestInstance)
    } else {
      requestInstance.end(body)
    }
  })
}

function assertOk(response, label) {
  if (response.status < 200 || response.status >= 300) {
    const detail = response.body.toString('utf8').slice(0, 500)
    throw new Error(`${label}失败: HTTP ${response.status}${detail ? ` ${detail}` : ''}`)
  }
}

async function getRelease() {
  const response = await request(`${api}/releases/tags/${encodeURIComponent(BUILD_DEPENDENCY_RELEASE_TAG)}`, {
    headers: { 'PRIVATE-TOKEN': token },
  })
  if (response.status === 404) return null
  assertOk(response, '查询 GitCode Release')
  return JSON.parse(response.body.toString('utf8'))
}

async function ensureRelease() {
  const existing = await getRelease()
  if (existing) return existing

  const response = await request(`${api}/releases`, {
    method: 'POST',
    headers: {
      'PRIVATE-TOKEN': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tag_name: BUILD_DEPENDENCY_RELEASE_TAG,
      name: `Luna AI Cut Build Dependencies v${BUILD_DEPENDENCY_RELEASE_TAG.slice('build-dependencies-v'.length)}`,
      body: 'Luna AI Cut 构建所需的固定平台依赖。GitHub Actions 使用上游地址，本地构建使用本 Release 的附件。',
    }),
  })
  if (response.status !== 409) assertOk(response, '创建 GitCode Release')
  return getRelease()
}

function releaseAssets(release) {
  return Array.isArray(release?.assets) ? release.assets : []
}

async function uploadAsset(artifact) {
  const response = await request(
    `${api}/releases/${encodeURIComponent(BUILD_DEPENDENCY_RELEASE_TAG)}/upload_url?file_name=${encodeURIComponent(artifact.fileName)}`,
    { headers: { 'PRIVATE-TOKEN': token } },
  )
  assertOk(response, `获取 ${artifact.fileName} 上传地址`)
  const payload = JSON.parse(response.body.toString('utf8'))
  if (!payload.url) throw new Error(`获取 ${artifact.fileName} 上传地址失败: 响应缺少 url`)

  const headers = {
    ...(payload.headers ?? {}),
    'Content-Length': String(statSync(artifact.path).size),
  }
  const uploadResponse = await request(payload.url, {
    method: 'PUT',
    headers,
    filePath: artifact.path,
  })
  assertOk(uploadResponse, `上传 ${artifact.fileName}`)
  console.log(`[publish-build-dependencies] 已上传 ${artifact.fileName}`)
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function verifyReleaseAsset(release, artifact) {
  const asset = releaseAssets(release).find((candidate) => candidate.name === artifact.fileName && candidate.type === 'attach')
  if (!asset) throw new Error(`GitCode Release 缺少附件: ${artifact.fileName}`)
  console.log(`[publish-build-dependencies] 已确认 ${artifact.fileName} (${statSync(artifact.path).size} bytes)`)
}

const root = process.cwd()
const artifacts = [
  {
    fileName: 'ffmpeg-win32-x64.gz',
    path: join(root, '.ffmpeg-cache', 'ffmpeg-win32-x64.gz'),
    sha256: '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77',
  },
  {
    fileName: 'ffmpeg-8.1.2-essentials_build.zip',
    path: join(root, '.ffmpeg-cache', 'ffmpeg-8.1.2-essentials_build.zip'),
    sha256: '091e659d96a2782b0babe0eb37bfb320ce1afe5d8079b3ae36fcc9bc30066f2d',
  },
  {
    fileName: 'ffmpeg-8.1.2-full_build-shared.7z',
    path: join(root, '.ffmpeg-cache', 'ffmpeg-8.1.2-full_build-shared.7z'),
    sha256: 'cba748035c21ce1431d0823c7a3a711f38616f89f87a265dceddf9b7f6749d2d',
  },
  {
    fileName: 'ffprobe-darwin-arm64.gz',
    path: join(root, '.ffmpeg-cache', 'ffprobe-darwin-arm64.gz'),
    sha256: 'd986a8ec7b030899fe66a8a288ed809a3543338705a3ce178cfb85869c5d80be',
  },
  {
    fileName: 'dovi_tool-2.3.3-universal-macOS.zip',
    path: join(root, '.dolby-tools-cache', 'dovi-tool-darwin-arm64.zip'),
    sha256: 'b113c83fed2d8d7ed9e43f0428d02fa0d0030e20965fc24a3cd4d48597d88685',
  },
  {
    fileName: 'Bento4-SDK-1-6-0-641.universal-apple-macosx.zip',
    path: join(root, '.dolby-tools-cache', 'bento4-darwin-arm64.zip'),
    sha256: '0570cf0dd59f362904d6f1cb472cbf4cdd37928fb0fe28e4c7f98c460e8e0ced',
  },
  {
    fileName: 'dovi_tool-2.3.3-x86_64-pc-windows-msvc.zip',
    path: join(root, '.dolby-tools-cache', 'dovi-tool-win32-x64.zip'),
    sha256: '37ae198f2a535c910befad39fc09c21cded76bf3ef2d5459d542e58c2c158311',
  },
  {
    fileName: 'Bento4-SDK-1-6-0-641.x86_64-microsoft-win32.zip',
    path: join(root, '.dolby-tools-cache', 'bento4-win32-x64.zip'),
    sha256: '6916a390f75878872594be74554b8b54ab220bb29812424441a8e1ecc9a6ac5e',
  },
  {
    fileName: 'microsoft.direct3d.dxc.1.9.2602.24.nupkg',
    path: join(root, '.dxc-cache', 'microsoft.direct3d.dxc.1.9.2602.24.nupkg'),
    sha256: '4e4cef12283f7875a3602b9f5dc04f153c77cfa216559f58881305f59f8f7e2f',
  },
]

const onlyIndex = process.argv.indexOf('--only')
const onlyFileName = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : null
const selectedArtifacts = onlyFileName
  ? artifacts.filter((artifact) => artifact.fileName === onlyFileName)
  : artifacts
if (selectedArtifacts.length === 0) {
  throw new Error(`未找到待上传附件: ${onlyFileName}`)
}

for (const artifact of selectedArtifacts) {
  if (!existsSync(artifact.path)) throw new Error(`缺少待上传文件: ${artifact.path}`)
  const actual = sha256File(artifact.path)
  if (actual !== artifact.sha256) throw new Error(`${basename(artifact.path)} 本地 SHA256 不匹配`)
}

let release = await ensureRelease()
for (const artifact of selectedArtifacts) {
  if (!releaseAssets(release).some((asset) => asset.name === artifact.fileName)) {
    await uploadAsset(artifact)
    release = await getRelease()
  } else {
    console.log(`[publish-build-dependencies] 已存在 ${artifact.fileName}`)
  }
}

release = await getRelease()
for (const artifact of selectedArtifacts) verifyReleaseAsset(release, artifact)
console.log(`[publish-build-dependencies] Download base: ${BUILD_DEPENDENCY_DOWNLOAD_BASE}`)
