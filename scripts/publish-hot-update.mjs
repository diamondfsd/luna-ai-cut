#!/usr/bin/env node
/**
 * Builds platform hot-update archives and optionally uploads them to GitCode.
 * Native modules are included only when --include-native is supplied.
 * Use --channel test for the isolated test-package release namespace.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import AdmZip from 'adm-zip'

const args = new Set(process.argv.slice(2))
const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag)
  return index === -1 ? null : process.argv[index + 1] ?? null
}

const version = valueAfter('--version')
const nativeDir = valueAfter('--native-dir') ?? '.hot-native'
const includeNative = args.has('--include-native')
const upload = args.has('--upload')
const channel = valueAfter('--channel') ?? 'stable'
const packageVersion = JSON.parse(readFileSync('package.json', 'utf8')).version
const versionPattern = new RegExp(`^${packageVersion.replaceAll('.', '\\.')}-hot\\.\\d+$`)
const supportedPlatforms = ['darwin-arm64', 'darwin-x64', 'win32-x64', 'universal']
const requestedPlatform = valueAfter('--platform')

function loadLocalConfig() {
  const configPath = join('scripts', 'deploy-release.conf')
  if (!existsSync(configPath)) return
  for (const line of readFileSync(configPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?(GITCODE_TOKEN|GITCODE_OWNER|GITCODE_REPO)=(.*)$/)
    if (!match || process.env[match[1]]) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[match[1]] = value
  }
}

if (upload) loadLocalConfig()

if (!version || !versionPattern.test(version)) {
  throw new Error(`--version 必须是 ${packageVersion}-hot.N`)
}
if (channel !== 'stable' && channel !== 'test') {
  throw new Error('--channel 必须是 stable 或 test')
}
if (requestedPlatform && !supportedPlatforms.includes(requestedPlatform)) {
  throw new Error(`--platform 必须是 ${supportedPlatforms.join('、')}`)
}
if (includeNative && requestedPlatform === 'universal') {
  throw new Error('原生热更新不能使用 universal，请指定具体平台或省略 --platform 生成三平台包')
}
if (!existsSync('dist/index.html') || !existsSync('dist-electron/luna-appMain.js')) {
  throw new Error('缺少 dist 构建产物，请先执行 pnpm build:app')
}

const releaseDir = join(channel === 'test' ? 'release-test' : 'release', packageVersion, 'hot-update')
const platforms = includeNative
  ? (requestedPlatform ? [requestedPlatform] : ['darwin-arm64', 'darwin-x64', 'win32-x64'])
  : [requestedPlatform ?? 'universal']
if (!supportedPlatforms.includes(platforms[0])) {
  throw new Error(`当前平台 ${platforms[0]} 不支持热更新，请显式使用 --platform universal`)
}
mkdirSync(releaseDir, { recursive: true })

function addAppFiles(zip) {
  zip.addLocalFolder('dist-electron', 'dist-electron', (file) => file !== 'dist-electron/main.js')
  zip.addLocalFolder('dist', 'dist', (file) => {
    const normalized = file.replaceAll('\\', '/')
    return !normalized.startsWith('dist/fonts/') && !normalized.startsWith('dist/luts/')
  })
  if (existsSync('electron')) {
    for (const file of readdirSync('electron').filter((name) => name.endsWith('.swift'))) {
      zip.addLocalFile(join('electron', file), 'swift')
    }
  }
  for (const file of readdirSync('.').filter((name) => name.startsWith('RELEASE_NOTES_v') && name.endsWith('.md'))) {
    zip.addLocalFile(file)
  }
  if (existsSync('old-release-log')) {
    for (const file of readdirSync('old-release-log').filter((name) => name.startsWith('RELEASE_NOTES_v') && name.endsWith('.md'))) {
      zip.addLocalFile(join('old-release-log', file), 'old-release-log')
    }
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

const packages = {}
for (const platform of platforms) {
  const zip = new AdmZip()
  addAppFiles(zip)
  if (includeNative) {
    const nativePath = join(nativeDir, platform, 'luna-render-core.node')
    if (!existsSync(nativePath)) throw new Error(`缺少 ${platform} 原生模块: ${nativePath}`)
    zip.addLocalFile(nativePath, 'pending-native')
    if (platform === 'win32-x64') {
      for (const file of [
        'dxcompiler.dll',
        'dxil.dll',
        'DXC-LICENSE-MIT.txt',
        'DXC-LICENSE-LLVM.txt',
        'DXC-LICENSE-MS.txt',
      ]) {
        const runtimePath = join(nativeDir, platform, file)
        if (!existsSync(runtimePath)) throw new Error(`缺少 ${platform} DXC 运行文件: ${runtimePath}`)
        zip.addLocalFile(runtimePath, 'pending-native')
      }
    }
  }
  const zipName = platform === 'universal'
    ? `renderer-${version}.zip`
    : `renderer-${version}-${platform}.zip`
  const zipPath = join(releaseDir, zipName)
  zip.writeZip(zipPath)
  packages[platform] = {
    zipName,
    sha256: sha256(zipPath),
    sizeBytes: statSync(zipPath).size,
    includesNative: includeNative,
  }
  console.log(`[hot-update] 已生成 ${zipPath}`)
}

const manifestPath = join(releaseDir, `renderer-${version}.json`)
const notesPath = `RELEASE_NOTES_v${version}.md`
writeFileSync(manifestPath, JSON.stringify({ version, minAppVersion: packageVersion, packages }, null, 2))

if (!upload) process.exit(0)

const token = process.env.GITCODE_TOKEN
if (!token) throw new Error('上传需要 GITCODE_TOKEN 或 scripts/deploy-release.conf')
const owner = process.env.GITCODE_OWNER ?? 'diamondfsd'
const repo = process.env.GITCODE_REPO ?? 'luna-ai-cut-package-release'
const isBeta = /^\d+\.\d+\.\d+-beta\.\d+$/i.test(packageVersion)
if (!isBeta && !/^\d+\.\d+\.\d+$/.test(packageVersion)) {
  throw new Error(`package.json 版本不受支持: ${packageVersion}（仅支持稳定版或 beta 版）`)
}
const baseTag = isBeta ? `beta/v${packageVersion}` : `v${packageVersion}`
const tag = channel === 'test' ? `test/${baseTag}` : baseTag
const api = `https://api.gitcode.com/api/v5/repos/${owner}/${repo}`
const headers = { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' }

const createRelease = await fetch(`${api}/releases`, {
  method: 'POST', headers,
  body: JSON.stringify({ tag_name: tag, name: tag, body: `Luna AI Cut ${tag} 热更新` }),
})
if (!createRelease.ok && createRelease.status !== 409) {
  throw new Error(`创建 GitCode Release 失败: HTTP ${createRelease.status}`)
}

async function uploadAsset(path) {
  const response = await fetch(`${api}/releases/${encodeURIComponent(tag)}/upload_url?file_name=${encodeURIComponent(basename(path))}`, {
    headers: { 'PRIVATE-TOKEN': token },
  })
  if (!response.ok) throw new Error(`获取 ${basename(path)} 上传地址失败: HTTP ${response.status}`)
  const { url, headers: uploadHeaders = {} } = await response.json()
  const result = await fetch(url, { method: 'PUT', headers: uploadHeaders, body: readFileSync(path) })
  if (!result.ok) throw new Error(`上传 ${basename(path)} 失败: HTTP ${result.status}`)
  console.log(`[hot-update] 已上传 ${basename(path)}`)
}

for (const entry of Object.values(packages)) await uploadAsset(join(releaseDir, entry.zipName))
await uploadAsset(manifestPath)
if (existsSync(notesPath)) await uploadAsset(notesPath)
