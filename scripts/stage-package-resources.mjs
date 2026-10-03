#!/usr/bin/env node

import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { stageIosUsbResources, verifyIosUsbResources } from './ios-usb-resources.mjs'
import { stageAndroidAdbResources, verifyAndroidAdbResources } from './android-adb-resources.mjs'

import { stageMacosIosUsbResources, verifyMacosIosUsbResources } from './macos-ios-usb-resources.mjs'

import { stageHarmonyHdcResources } from './harmony-hdc-resources.mjs'

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

if (target === 'darwin') verifyMacosIosUsbResources(join(root, 'resources', 'ios-usb', targetName), arch)
if (target === 'win32') verifyIosUsbResources(sourceDirectories.iosUsb)
if (target === 'win32') verifyAndroidAdbResources()
rmSync(stageRoot, { recursive: true, force: true })
copySelectedDirectory(sourceDirectories.ffmpeg, join(stageRoot, 'ffmpeg'), isFfmpegFile)
copySelectedDirectory(sourceDirectories.dolby, join(stageRoot, 'dolby-vision'), isDolbyFile)
copySelectedDirectory(sourceDirectories.native, join(stageRoot, 'luna-render-core'), isNativeFile)
if (target === 'win32') {
  stageIosUsbResources(join(stageRoot, 'ios-usb'), sourceDirectories.iosUsb)
  stageAndroidAdbResources(join(stageRoot, 'android-adb'))
}

if (target === 'darwin') stageMacosIosUsbResources(join(stageRoot, 'ios-usb'), arch)

stageHarmonyHdcResources(join(stageRoot, 'harmony-hdc'), target, arch)

console.log(`[stage-package-resources] ${targetName} -> ${stageRoot}`)
