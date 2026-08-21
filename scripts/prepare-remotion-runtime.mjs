import { access, chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const binariesOutput = path.join(root, 'resources', 'remotion-binaries')
const browserOutput = path.join(root, 'resources', 'remotion-browser')
const rootRequire = createRequire(import.meta.url)
const REMOTION_VERSION = '4.0.484'

function targetName() {
  const args = process.argv.slice(2)
  const platformIndex = args.indexOf('--target')
  const archIndex = args.indexOf('--arch')
  return {
    platform: platformIndex >= 0 ? args[platformIndex + 1] : process.platform,
    arch: archIndex >= 0 ? args[archIndex + 1] : process.arch,
  }
}

function compositorPackage({ platform, arch }) {
  if (platform === 'darwin') return arch === 'arm64' ? '@remotion/compositor-darwin-arm64' : '@remotion/compositor-darwin-x64'
  if (platform === 'win32') return '@remotion/compositor-win32-x64-msvc'
  if (platform === 'linux') return arch === 'arm64' ? '@remotion/compositor-linux-arm64-gnu' : '@remotion/compositor-linux-x64-gnu'
  throw new Error(`不支持的 Remotion 目标：${platform}-${arch}`)
}

function browserPlatform({ platform, arch }) {
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-arm64' : 'mac-x64'
  if (platform === 'win32') return 'win64'
  if (platform === 'linux') return arch === 'arm64' ? 'linux-arm64' : 'linux64'
  throw new Error(`不支持的 Remotion 浏览器目标：${platform}-${arch}`)
}

function rendererRequire() {
  return createRequire(rootRequire.resolve('@remotion/renderer'))
}

async function exists(filePath) {
  return access(filePath).then(() => true).catch(() => false)
}

async function copyRuntimeBinaries(target) {
  const packageName = compositorPackage(target)
  const packageRoot = path.dirname(rendererRequire().resolve(`${packageName}/package.json`))
  await rm(binariesOutput, { recursive: true, force: true })
  await mkdir(binariesOutput, { recursive: true })
  await cp(packageRoot, binariesOutput, { recursive: true })
  const executableNames = target.platform === 'win32'
    ? ['remotion.exe', 'ffmpeg.exe', 'ffprobe.exe']
    : ['remotion', 'ffmpeg', 'ffprobe']
  for (const name of executableNames) {
    const executable = path.join(binariesOutput, name)
    if (!await exists(executable)) throw new Error(`Remotion runtime 缺少 ${name}`)
    if (target.platform !== 'win32') await chmod(executable, 0o755)
  }
  return packageRoot
}

async function ensureBrowser() {
  if (await browserExecutableExists(browserOutput, target)) return
  if (process.env.LUNA_REMOTION_BROWSER_SOURCE) return
  const renderer = await import('@remotion/renderer')
  await renderer.ensureBrowser({
    chromeMode: 'headless-shell',
    logLevel: 'error',
    onBrowserDownload: () => ({ onProgress: () => undefined, version: null }),
  })
}

function browserExecutablePath(rootPath, target) {
  const platform = browserPlatform(target)
  const folder = path.join(rootPath, platform, `chrome-headless-shell-${platform}`)
  return path.join(folder, target.platform === 'win32'
    ? 'chrome-headless-shell.exe'
    : target.platform === 'linux' && target.arch === 'arm64' ? 'headless_shell' : 'chrome-headless-shell')
}

async function browserExecutableExists(rootPath, target) {
  return exists(browserExecutablePath(rootPath, target))
}

async function copyBrowser(target) {
  if (await browserExecutableExists(browserOutput, target)) return
  const sourceRoot = process.env.LUNA_REMOTION_BROWSER_SOURCE
    ? path.resolve(process.env.LUNA_REMOTION_BROWSER_SOURCE)
    : path.join(root, 'node_modules', '.remotion', 'chrome-headless-shell')
  const platform = browserPlatform(target)
  const sourcePlatformRoot = path.join(sourceRoot, platform)
  if (!await exists(sourcePlatformRoot)) {
    throw new Error(`找不到 ${platform} 的 Headless Chrome。可设置 LUNA_REMOTION_BROWSER_SOURCE 指向已准备的 chrome-headless-shell 目录。`)
  }
  await rm(browserOutput, { recursive: true, force: true })
  await mkdir(browserOutput, { recursive: true })
  await cp(sourceRoot, browserOutput, { recursive: true })
  const executable = browserExecutablePath(browserOutput, target)
  if (!await exists(executable)) throw new Error(`Headless Chrome 可执行文件缺失：${executable}`)
  if (target.platform !== 'win32') await chmod(executable, 0o755)
}

const target = targetName()
if (target.platform !== process.platform || target.arch !== process.arch) {
  throw new Error(`Remotion runtime 当前只支持在原生目标环境准备（当前 ${process.platform}-${process.arch}，目标 ${target.platform}-${target.arch}）。`)
}
await copyRuntimeBinaries(target)
await ensureBrowser()
await copyBrowser(target)
await writeFile(path.join(binariesOutput, 'manifest.json'), `${JSON.stringify({ remotionVersion: REMOTION_VERSION, target }, null, 2)}\n`)
await writeFile(path.join(browserOutput, 'manifest.json'), `${JSON.stringify({ remotionVersion: REMOTION_VERSION, target, chromeMode: 'headless-shell' }, null, 2)}\n`)
console.log(`[remotion-runtime] prepared ${target.platform}-${target.arch}`)
