#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, createReadStream, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { path7za } from '7zip-bin'

const VERSION = '1.0.0'
const RELEASE_TAG = `birefnet-mps-resources-v${VERSION}`
const MODEL_REVISION = '7838f1c3472f827cd8ce13ab5ccc2ce48077360f'
const root = join(import.meta.dirname, '..')
const sidecarSource = join(root, 'release', 'experiments', 'birefnet-mps-sidecar')
const modelSource = join(homedir(), '.cache', 'huggingface', 'hub', 'models--ZhengPeng7--BiRefNet_lite', 'snapshots', MODEL_REVISION)
const outputDir = join(root, 'release', 'runtime-resources', RELEASE_TAG)
const stagingDir = mkdtempSync(join(tmpdir(), 'luna-birefnet-mps-'))

function listFiles(directory) {
  const files = []
  const visit = (current) => {
    for (const name of readdirSync(current).sort((a, b) => a.localeCompare(b, 'en'))) {
      const filePath = join(current, name)
      const stats = statSync(filePath)
      if (stats.isDirectory()) visit(filePath)
      else if (stats.isFile()) files.push({ path: filePath, bytes: stats.size })
    }
  }
  visit(directory)
  return files
}

function copyTreeDereferenced(source, destination, excluded = new Set()) {
  if (excluded.has(source)) return
  const sourceStats = lstatSync(source)
  if (sourceStats.isSymbolicLink()) {
    let resolved
    try {
      resolved = realpathSync(source)
    } catch {
      console.log(`[birefnet-resources] 跳过断开的符号链接: ${relative(sidecarSource, source)}`)
      return
    }
    copyTreeDereferenced(resolved, destination, excluded)
    return
  }
  if (sourceStats.isDirectory()) {
    mkdirSync(destination, { recursive: true, mode: sourceStats.mode })
    for (const name of readdirSync(source)) copyTreeDereferenced(join(source, name), join(destination, name), excluded)
    return
  }
  if (!sourceStats.isFile()) return
  copyFileSync(source, destination)
  chmodSync(destination, sourceStats.mode)
}

async function sha256File(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

function createArchive(sourceRoot, outputPath) {
  rmSync(outputPath, { force: true })
  const result = spawnSync(path7za, [
    'a', '-t7z', '-mx=9', '-m0=lzma2', '-md=128m', '-mfb=273', '-ms=on', '-mmt=on',
    '-mtm=off', '-mta=off', '-mtc=off',
    outputPath, basename(sourceRoot),
  ], { cwd: join(sourceRoot, '..'), stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`7z 压缩失败: ${basename(outputPath)}`)
}

async function describePack(id, kind, sourceRoot, fileName, archiveRoot, executablePaths = []) {
  const outputPath = join(outputDir, fileName)
  createArchive(sourceRoot, outputPath)
  const files = listFiles(sourceRoot)
  return {
    id,
    kind,
    version: VERSION,
    fileName,
    archiveBytes: statSync(outputPath).size,
    unpackedBytes: files.reduce((total, file) => total + file.bytes, 0),
    sha256: await sha256File(outputPath),
    archiveRoot,
    expectedFileCount: files.length,
    executablePaths,
    outputPath,
  }
}

try {
  if (!existsSync(sidecarSource)) throw new Error(`Sidecar 不存在: ${sidecarSource}`)
  if (!existsSync(modelSource)) throw new Error(`BiRefNet 离线模型不存在: ${modelSource}`)
  mkdirSync(outputDir, { recursive: true })

  const runtimeRoot = join(stagingDir, 'birefnet-mps-runtime')
  copyTreeDereferenced(sidecarSource, runtimeRoot, new Set([join(sidecarSource, 'model.safetensors')]))
  copyFileSync(join(root, 'scripts', 'birefnet-mps-bundled-worker.py'), join(runtimeRoot, 'birefnet-mps-worker.py'))

  const modelRoot = join(stagingDir, 'birefnet-mps-model')
  mkdirSync(modelRoot)
  for (const name of ['config.json', 'birefnet.py', 'BiRefNet_config.py', 'model.safetensors']) {
    copyFileSync(join(modelSource, name), join(modelRoot, name))
  }

  const runtime = await describePack(
    'birefnet-mps-runtime-macos-arm64',
    'sidecar',
    runtimeRoot,
    `luna-birefnet-mps-runtime-macos-arm64-v${VERSION}.7z`,
    basename(runtimeRoot),
    [
      'birefnet-mps-runtime/birefnet-mps-worker',
      'birefnet-mps-runtime/python/Python.framework/Versions/3.12/bin/python3.12',
    ],
  )
  const model = await describePack(
    'birefnet-mps-model-lite',
    'model',
    modelRoot,
    `luna-birefnet-mps-model-lite-v${VERSION}.7z`,
    basename(modelRoot),
  )
  const downloadBase = `https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases/download/${RELEASE_TAG}`
  const manifest = {
    schemaVersion: 1,
    releaseTag: RELEASE_TAG,
    version: VERSION,
    modelRevision: MODEL_REVISION,
    packs: [runtime, model].map(({ outputPath, ...pack }) => ({
      ...pack,
      url: `${downloadBase}/${encodeURIComponent(pack.fileName)}`,
    })),
  }
  const manifestPath = join(outputDir, `${RELEASE_TAG}.json`)
  const { writeFileSync } = await import('node:fs')
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(JSON.stringify({ outputDir, manifestPath, packs: manifest.packs }, null, 2))
} finally {
  rmSync(stagingDir, { recursive: true, force: true })
}
