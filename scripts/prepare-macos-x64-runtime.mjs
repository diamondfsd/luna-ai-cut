#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { buildDependencyUrl } from './build-dependency-sources.mjs'

export const ONNX_RUNTIME_VERSION = '1.23.2'
export const ONNX_RUNTIME_ARCHIVE = `onnxruntime-osx-x86_64-${ONNX_RUNTIME_VERSION}.tgz`
export const ONNX_RUNTIME_SHA256 = 'd10359e16347b57d9959f7e80a225a5b4a66ed7d7e007274a15cae86836485a6'

const upstreamUrl = `https://github.com/microsoft/onnxruntime/releases/download/v${ONNX_RUNTIME_VERSION}/${ONNX_RUNTIME_ARCHIVE}`

function loadGitCodeToken(rootDir) {
  let directory = resolve(rootDir)
  for (let depth = 0; depth < 5; depth += 1) {
    const configPath = join(directory, 'scripts', 'deploy-release.conf')
    if (existsSync(configPath)) {
      for (const line of readFileSync(configPath, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*(?:export\s+)?GITCODE_TOKEN=(.*)$/)
        if (!match) continue
        let value = match[1].trim()
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        return value
      }
      return null
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return null
}

function requestHeaders(url, rootDir) {
  try {
    const hostname = new URL(url).hostname
    if (hostname === 'gitcode.com' || hostname.endsWith('.gitcode.com')) {
      const token = process.env.GITCODE_TOKEN || loadGitCodeToken(rootDir)
      if (token) return { 'PRIVATE-TOKEN': token }
    }
  } catch {
    // Let fetch report malformed URLs without exposing credentials.
  }
  return undefined
}

function isX64Binary(filePath) {
  const result = spawnSync('lipo', ['-archs', filePath], { encoding: 'utf8' })
  return result.status === 0 && result.stdout.trim().split(/\s+/).includes('x86_64')
}

function lstatExists(filePath) {
  try {
    lstatSync(filePath)
    return true
  } catch {
    return false
  }
}

function runtimeFileIn(directory) {
  if (!existsSync(directory)) return null
  const preferred = `libonnxruntime.${ONNX_RUNTIME_VERSION}.dylib`
  const files = readdirSync(directory)
    .filter((fileName) => /^libonnxruntime(?:\.\d[^/]*)?\.dylib$/i.test(fileName))
    .sort((left, right) => Number(right === preferred) - Number(left === preferred))
  for (const fileName of files) {
    const filePath = join(directory, fileName)
    if (isX64Binary(filePath)) return filePath
  }
  return null
}

function ensureLinkerAlias(directory, runtimePath) {
  const aliasPath = join(directory, 'libonnxruntime.dylib')
  if (existsSync(aliasPath) && isX64Binary(aliasPath)) return
  if (existsSync(aliasPath) || lstatExists(aliasPath)) unlinkSync(aliasPath)
  copyFileSync(runtimePath, aliasPath)
}

function inspectRuntimeDirectory(directory) {
  const runtimePath = runtimeFileIn(directory)
  if (!runtimePath) return null
  ensureLinkerAlias(directory, runtimePath)
  return directory
}

function cacheDirectory(rootDir) {
  return process.env.LUNA_ONNX_RUNTIME_CACHE_DIR
    ? resolve(process.env.LUNA_ONNX_RUNTIME_CACHE_DIR)
    : join(rootDir, '.onnxruntime-cache', ONNX_RUNTIME_VERSION, 'x86_64')
}

function verifyArchive(archivePath) {
  const actual = createHash('sha256').update(readFileSync(archivePath)).digest('hex')
  if (actual !== ONNX_RUNTIME_SHA256) {
    throw new Error(`ONNX Runtime 压缩包 SHA256 不匹配：${actual}，期望 ${ONNX_RUNTIME_SHA256}`)
  }
}

async function downloadArchive(archivePath, rootDir) {
  const url = buildDependencyUrl(ONNX_RUNTIME_ARCHIVE, upstreamUrl)
  const response = await fetch(url, { headers: requestHeaders(url, rootDir), redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`无法下载 macOS x64 ONNX Runtime（HTTP ${response.status}）。请确认构建依赖 Release 已包含 ${ONNX_RUNTIME_ARCHIVE}`)
  }

  console.log(`[onnx-runtime] 下载 macOS x64 runtime: ${url}`)
  const partialPath = `${archivePath}.part-${process.pid}`
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partialPath))
  renameSync(partialPath, archivePath)
}

function extractArchive(archivePath, destination) {
  mkdirSync(destination, { recursive: true })
  const result = spawnSync('tar', ['-xzf', archivePath, '-C', destination], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`解压 macOS x64 ONNX Runtime 失败：${archivePath}`)
}

export async function ensureMacX64OnnxRuntime({ rootDir, nativeDir = join(rootDir, 'luna-render-core') }) {
  if (process.platform !== 'darwin') return null

  if (process.env.ORT_LIB_LOCATION) {
    const configured = inspectRuntimeDirectory(resolve(process.env.ORT_LIB_LOCATION))
    if (!configured) throw new Error(`ORT_LIB_LOCATION 中没有可用的 macOS x64 ONNX Runtime：${process.env.ORT_LIB_LOCATION}`)
    console.log(`[onnx-runtime] 使用已配置的 macOS x64 runtime: ${configured}`)
    return configured
  }

  const bundled = inspectRuntimeDirectory(nativeDir)
  if (bundled) {
    console.log(`[onnx-runtime] 复用本地 macOS x64 runtime: ${bundled}`)
    return bundled
  }

  const cacheRoot = cacheDirectory(rootDir)
  const archivePath = join(cacheRoot, ONNX_RUNTIME_ARCHIVE)
  const extractedRuntime = join(cacheRoot, `onnxruntime-osx-x86_64-${ONNX_RUNTIME_VERSION}`, 'lib')
  if (!existsSync(archivePath)) {
    mkdirSync(cacheRoot, { recursive: true })
    await downloadArchive(archivePath, rootDir)
  }
  verifyArchive(archivePath)

  const cached = inspectRuntimeDirectory(extractedRuntime)
  if (cached) {
    console.log(`[onnx-runtime] 复用缓存 macOS x64 runtime: ${cached}`)
    return cached
  }

  extractArchive(archivePath, cacheRoot)
  const extracted = inspectRuntimeDirectory(extractedRuntime)
  if (!extracted) throw new Error(`macOS x64 ONNX Runtime 解压后缺少可用运行库：${extractedRuntime}`)
  console.log(`[onnx-runtime] 已准备 macOS x64 runtime: ${extracted}`)
  return extracted
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  const rootDir = resolve(join(dirname(currentFile), '..'))
  const runtimeDir = await ensureMacX64OnnxRuntime({ rootDir })
  if (runtimeDir) console.log(runtimeDir)
}
