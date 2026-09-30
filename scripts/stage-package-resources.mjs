#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const targetIndex = process.argv.indexOf('--target')
const target = targetIndex >= 0 ? process.argv[targetIndex + 1] : process.platform
const archIndex = process.argv.indexOf('--arch')
const arch = archIndex >= 0 ? process.argv[archIndex + 1] : process.arch

const targetName = `${target}-${arch}`
const sourceDirectories = {
  ffmpeg: join(root, 'resources', 'ffmpeg'),
  dolby: join(root, 'resources', 'dolby-vision'),
  iosUsb: join(root, 'resources', 'ios-usb', 'win-x64'),
  native: join(root, 'luna-render-core'),
}
const stageRoot = join(root, '.package-resources', targetName)
const nativeWorkerNames = [
  'sam-segmentation-worker',
  'semantic-segmentation-worker',
  'specialized-segmentation-worker',
  'luna-inpaint-worker',
  'luna-punctuation-worker',
  'luna-asr-worker',
  'neural-preset-worker',
]

if (!['darwin-arm64', 'darwin-x64', 'win32-x64'].includes(targetName)) {
  throw new Error(`不支持的打包目标：${targetName}`)
}

function isFfmpegFile(fileName) {
  if (target === 'win32') {
    return fileName === 'ffmpeg.exe'
      || fileName === 'ffprobe.exe'
      || fileName === 'FFmpeg-LICENSE.txt'
      || /\.dll$/i.test(fileName)
  }
  return fileName === 'ffmpeg' || fileName === 'ffprobe'
}

function isDolbyFile(fileName) {
  return target === 'win32'
    ? fileName === 'dovi_tool.exe' || fileName === 'mp4mux.exe'
    : fileName === 'dovi_tool' || fileName === 'mp4mux'
}

function isNativeFile(fileName) {
  if (target === 'win32') {
    if (/^(?:avcodec|avdevice|avfilter|avformat|avutil|postproc|swresample|swscale)-\d+\.dll$/i.test(fileName)) return false
    return fileName === 'luna-render-core.node'
      || fileName.endsWith('.exe')
      || fileName === 'dxcompiler.dll'
      || fileName === 'dxil.dll'
      || /^DXC-LICENSE-.*\.txt$/i.test(fileName)
  }
  return fileName === 'luna-render-core.node' || fileName === 'luna-smb2-worker' || fileName === 'luna-smb2-worker.exe'
    || nativeWorkerNames.includes(fileName)
    || /\.(dylib|so(?:\..*)?)$/i.test(fileName)
}

function copySelectedDirectory(sourceDir, destinationDir, predicate) {
  if (!existsSync(sourceDir)) throw new Error(`构建资源目录不存在：${sourceDir}`)
  mkdirSync(destinationDir, { recursive: true })
  for (const fileName of readdirSync(sourceDir)) {
    const sourcePath = join(sourceDir, fileName)
    if (!statSync(sourcePath).isFile() || !predicate(fileName)) continue
    const destinationPath = join(destinationDir, fileName)
    copyFileSync(sourcePath, destinationPath)
    const mode = statSync(sourcePath).mode & 0o777
    if (mode & 0o111) chmodSync(destinationPath, mode)
  }
}

function copyIosUsbDirectory(sourceDir, destinationDir, relativeDirectory = '') {
  if (!existsSync(sourceDir)) throw new Error(`iOS USB 运行资源目录不存在：${sourceDir}`)
  mkdirSync(destinationDir, { recursive: true })
  for (const fileName of readdirSync(sourceDir)) {
    const sourcePath = join(sourceDir, fileName)
    const relativePath = relativeDirectory ? `${relativeDirectory}/${fileName}` : fileName
    const info = statSync(sourcePath)
    if (info.isDirectory()) {
      copyIosUsbDirectory(sourcePath, join(destinationDir, fileName), relativePath)
      continue
    }
    const isRuntimeBinary = relativeDirectory === ''
      && (fileName === 'iproxy.exe'
        || ['libimobiledevice-glue-1.0.dll', 'libplist-2.0.dll', 'libusbmuxd-2.0.dll'].includes(fileName))
    const isLicense = relativePath.startsWith('licenses/')
      && /^(?:COPYING|LICENSE|NOTICE)(?:\.|$)/i.test(fileName)
    if (!info.isFile() || (!isRuntimeBinary && !isLicense)) continue
    const destinationPath = join(destinationDir, fileName)
    copyFileSync(sourcePath, destinationPath)
    const mode = info.mode & 0o777
    if (mode & 0o111) chmodSync(destinationPath, mode)
  }
}

function verifyIosUsbChecksums(fileNames) {
  const resourceRoot = join(root, 'resources', 'ios-usb')
  const checksumFile = join(resourceRoot, 'SHA256SUMS.txt')
  if (!existsSync(checksumFile)) throw new Error(`iOS USB SHA256 清单不存在：${checksumFile}`)
  const checksums = new Map(
    readFileSync(checksumFile, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^([a-f0-9]{64})\s+(.+)$/i)
        if (!match) throw new Error(`iOS USB SHA256 清单格式错误：${line}`)
        return [match[2], match[1].toLowerCase()]
      }),
  )
  for (const fileName of fileNames) {
    const relativePath = `win-x64/${fileName}`
    const expected = checksums.get(relativePath)
    if (!expected) throw new Error(`iOS USB SHA256 清单缺少：${relativePath}`)
    const actual = createHash('sha256').update(readFileSync(join(resourceRoot, relativePath))).digest('hex')
    if (actual !== expected) throw new Error(`iOS USB 文件 SHA256 不匹配：${relativePath}`)
  }
}

rmSync(stageRoot, { recursive: true, force: true })
copySelectedDirectory(sourceDirectories.ffmpeg, join(stageRoot, 'ffmpeg'), isFfmpegFile)
copySelectedDirectory(sourceDirectories.dolby, join(stageRoot, 'dolby-vision'), isDolbyFile)
copySelectedDirectory(sourceDirectories.native, join(stageRoot, 'luna-render-core'), isNativeFile)
if (target === 'win32') {
  const requiredIosUsbFiles = [
    'iproxy.exe',
    'libimobiledevice-glue-1.0.dll',
    'libplist-2.0.dll',
    'libusbmuxd-2.0.dll',
  ]
  for (const fileName of requiredIosUsbFiles) {
    if (!existsSync(join(sourceDirectories.iosUsb, fileName))) {
      throw new Error(`缺少 iOS USB 运行文件：${join(sourceDirectories.iosUsb, fileName)}`)
    }
  }
  verifyIosUsbChecksums(requiredIosUsbFiles)
  copyIosUsbDirectory(sourceDirectories.iosUsb, join(stageRoot, 'ios-usb'))
}

console.log(`[stage-package-resources] ${targetName} -> ${stageRoot}`)
