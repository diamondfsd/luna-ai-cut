#!/usr/bin/env node
/**
 * Compile the macOS Swift helpers during the build.
 *
 * The installed application must never invoke the Swift compiler. These
 * executables are linked against Apple's system frameworks and can run on a
 * clean macOS installation without Xcode or Command Line Tools.
 */
import { chmodSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const sourceDir = join(root, 'electron', 'platform', 'macos')
const outputDir = join(root, 'resources', 'macos-native')
const helperSources = [
  ['bluetoothCoreScanner.swift', 'bluetoothCoreScanner'],
  ['wifiCoreWlan.swift', 'wifiCoreWlan'],
  ['livetool.swift', 'livetool'],
]

function valueAfter(flag) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}

function inferArch() {
  const target = (process.env.CROSS_TARGET ?? '').toLowerCase()
  if (target.includes('x86_64')) return 'x64'
  if (target.includes('aarch64') || target.includes('arm64')) return 'arm64'
  return process.arch === 'x64' ? 'x64' : 'arm64'
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} 执行失败（退出码 ${result.status ?? '未知'}）`)
  return result
}

if (process.platform !== 'darwin') {
  console.log(`[build-macos-helpers] 跳过：当前平台为 ${process.platform}`)
  process.exit(0)
}

const arch = valueAfter('--arch') ?? process.env.MACOS_HELPER_ARCH ?? inferArch()
if (arch !== 'arm64' && arch !== 'x64') {
  throw new Error(`不支持的 macOS helper 架构：${arch}（可选 arm64 或 x64）`)
}

const deploymentTarget = process.env.MACOSX_DEPLOYMENT_TARGET ?? '12.0'
if (!/^\d+\.\d+$/.test(deploymentTarget)) {
  throw new Error(`MACOSX_DEPLOYMENT_TARGET 无效：${deploymentTarget}`)
}

const sdkResult = spawnSync('xcrun', ['--show-sdk-path'], { cwd: root, encoding: 'utf8' })
if (sdkResult.error || sdkResult.status !== 0) {
  throw new Error('编译 macOS helper 需要可用的 Xcode 或 Command Line Tools')
}
const sdkPath = sdkResult.stdout.trim()
if (!sdkPath) throw new Error('无法定位 macOS SDK')

const swiftcResult = spawnSync('xcrun', ['--find', 'swiftc'], { cwd: root, encoding: 'utf8' })
if (swiftcResult.error || swiftcResult.status !== 0) {
  throw new Error('找不到 swiftc。请在构建机上安装 Xcode 或 Command Line Tools')
}
const swiftcPath = swiftcResult.stdout.trim()
if (!swiftcPath) throw new Error('无法定位 swiftc')

mkdirSync(outputDir, { recursive: true })
const target = `${arch === 'x64' ? 'x86_64' : 'arm64'}-apple-macosx${deploymentTarget}`

for (const [sourceName, outputName] of helperSources) {
  const sourcePath = join(sourceDir, sourceName)
  const outputPath = join(outputDir, outputName)
  if (!existsSync(sourcePath)) throw new Error(`缺少 macOS helper 源文件：${sourcePath}`)

  rmSync(outputPath, { force: true })
  console.log(`[build-macos-helpers] 编译 ${sourceName} -> ${outputName} (${arch})`)
  run(swiftcPath, [
    '-O',
    '-sdk', sdkPath,
    '-target', target,
    sourcePath,
    '-o', outputPath,
  ])
  chmodSync(outputPath, 0o755)

  const archResult = spawnSync('lipo', ['-archs', outputPath], { encoding: 'utf8' })
  if (archResult.status !== 0 || archResult.stdout.trim() !== (arch === 'x64' ? 'x86_64' : 'arm64')) {
    throw new Error(`macOS helper 架构校验失败：${outputPath}（实际为 ${archResult.stdout?.trim() || '未知'}）`)
  }
}

console.log(`[build-macos-helpers] 完成：${outputDir}`)
