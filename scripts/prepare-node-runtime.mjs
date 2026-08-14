import { chmod, cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { path7za } from '7zip-bin'

const NODE_VERSION = process.env.LUNA_NODE_RUNTIME_VERSION || 'v22.22.2'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(root, 'resources', 'node-runtime')

function valueAfterFlag(args, name, fallback) {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

function normalizeArch(value) {
  if (value === 'x64' || value === 'arm64') return value
  throw new Error(`不支持的 Node.js 目标架构：${value}`)
}

function targetDefaults() {
  const target = process.platform
  if (target !== 'darwin' && target !== 'win32' && target !== 'linux') {
    throw new Error(`不支持的 Node.js 目标平台：${target}`)
  }
  return { target, arch: process.arch === 'arm64' ? 'arm64' : 'x64' }
}

const args = process.argv.slice(2)
const defaults = targetDefaults()
const target = valueAfterFlag(args, '--target', defaults.target)
const arch = normalizeArch(valueAfterFlag(args, '--arch', defaults.arch))

if (target !== 'darwin' && target !== 'win32' && target !== 'linux') {
  throw new Error(`不支持的 Node.js 目标平台：${target}`)
}
if (target === 'win32' && arch !== 'x64') {
  throw new Error('当前 Windows 安装包只支持 x64 Node.js runtime。')
}

const nodeName = `node-${NODE_VERSION}-${target === 'win32' ? 'win' : target}-${arch}`
const archiveName = target === 'win32' ? `${nodeName}.zip` : `${nodeName}.tar.gz`
const archiveUrl = `https://nodejs.org/dist/${NODE_VERSION}/${archiveName}`

function run7za(argumentsList) {
  const result = spawnSync(path7za, argumentsList, { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`解压 Node.js runtime 失败（${String(result.status ?? '未知错误')}）。`)
}

async function download(filePath) {
  const response = await fetch(archiveUrl, { signal: AbortSignal.timeout(300_000) })
  if (!response.ok || !response.body) {
    throw new Error(`下载 Node.js runtime 失败：${response.status} ${response.statusText}`)
  }
  await writeFile(filePath, Buffer.from(await response.arrayBuffer()), { flag: 'wx' })
}

async function findDirectory(directory, prefix) {
  const entries = await readdir(directory, { withFileTypes: true })
  const found = entries.find((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
  if (!found) throw new Error(`Node.js runtime 解压目录缺失：${prefix}`)
  return join(directory, found.name)
}

async function main() {
  const temporary = await mkdtemp(join(tmpdir(), 'luna-node-runtime-'))
  const archivePath = join(temporary, archiveName)
  const extracted = join(temporary, 'extracted')
  await mkdir(extracted, { recursive: true })

  try {
    console.log(`[node-runtime] downloading ${archiveUrl}`)
    await download(archivePath)
    run7za(['x', archivePath, `-o${extracted}`, '-y'])

    if (archiveName.endsWith('.tar.gz')) {
      const tarFile = (await readdir(extracted, { withFileTypes: true }))
        .find((entry) => entry.isFile() && entry.name.endsWith('.tar'))
      if (!tarFile) throw new Error('Node.js runtime tar 文件缺失。')
      run7za(['x', join(extracted, tarFile.name), `-o${extracted}`, '-y'])
    }

    const sourceRoot = await findDirectory(extracted, nodeName)
    await rm(output, { recursive: true, force: true })
    await mkdir(output, { recursive: true })

    const executableSource = target === 'win32'
      ? join(sourceRoot, 'node.exe')
      : join(sourceRoot, 'bin', 'node')
    const executableTarget = target === 'win32'
      ? join(output, 'node.exe')
      : join(output, 'bin', 'node')
    await mkdir(dirname(executableTarget), { recursive: true })
    await cp(executableSource, executableTarget)
    if (target !== 'win32') await chmod(executableTarget, 0o755)

    const licenseSource = join(sourceRoot, 'LICENSE')
    if (existsSync(licenseSource)) await cp(licenseSource, join(output, 'LICENSE'))
    await writeFile(join(output, 'version.json'), `${JSON.stringify({ version: NODE_VERSION, target, arch, archiveUrl }, null, 2)}\n`)
    console.log(`[node-runtime] prepared ${executableTarget}`)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

await main()
