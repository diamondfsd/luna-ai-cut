#!/usr/bin/env node
/**
 * Builds platform hot-update archives and optionally uploads them to GitCode.
 * Native modules are included only when --include-native is supplied.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
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
const packageVersion = JSON.parse(readFileSync('package.json', 'utf8')).version
const versionPattern = new RegExp(`^${packageVersion.replaceAll('.', '\\.')}-hot\\.\\d+$`)

if (!version || !versionPattern.test(version)) {
  throw new Error(`--version 必须是 ${packageVersion}-hot.N`)
}
if (!existsSync('dist/index.html') || !existsSync('dist-electron/luna-appMain.js')) {
  throw new Error('缺少 dist 构建产物，请先执行 pnpm build:app')
}

const releaseDir = join('release', packageVersion, 'hot-update')
const platforms = ['darwin-arm64', 'darwin-x64', 'win32-x64']
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
  }
  const zipName = `renderer-${version}-${platform}.zip`
  const zipPath = join(releaseDir, zipName)
  zip.writeZip(zipPath)
  packages[platform] = { zipName, sha256: sha256(zipPath), includesNative: includeNative }
  console.log(`[hot-update] 已生成 ${zipPath}`)
}

const manifestPath = join(releaseDir, `renderer-${version}.json`)
writeFileSync(manifestPath, JSON.stringify({ version, minAppVersion: packageVersion, packages }, null, 2))

if (!upload) process.exit(0)

const token = process.env.GITCODE_TOKEN
if (!token) throw new Error('上传需要 GITCODE_TOKEN')
const owner = process.env.GITCODE_OWNER ?? 'diamondfsd'
const repo = process.env.GITCODE_REPO ?? 'luna-ai-cut-package-release'
const tag = `v${packageVersion}`
const api = `https://api.gitcode.com/api/v5/repos/${owner}/${repo}`
const headers = { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' }

await fetch(`${api}/releases`, {
  method: 'POST', headers,
  body: JSON.stringify({ tag_name: tag, name: tag, body: `Luna AI Cut ${tag} 热更新` }),
})

async function uploadAsset(path) {
  const response = await fetch(`${api}/releases/${tag}/upload_url?file_name=${encodeURIComponent(basename(path))}`, {
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
