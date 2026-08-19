#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { resolveDeepSeekHarnessRoot } from './deepseek-harness-root.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const force = process.argv.includes('--force')
const platformKey = `${process.platform}-${process.arch}`
const distRoot = join(root, 'dist')

const nativeStamp = join(distRoot, '.luna-dev-native.json')
const harnessStamp = join(distRoot, '.luna-dev-harness.json')
const harnessRoot = resolveDeepSeekHarnessRoot(root)

const ignoredSourceDirectories = new Set([
  '.git',
  '.turbo',
  '.yarn',
  'coverage',
  'dist',
  'lib',
  'node_modules',
  'target',
])

async function latestSourceMtime(paths) {
  let latest = 0
  const pending = [...paths]

  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) continue
    const info = await stat(current).catch(() => null)
    if (!info) continue
    if (!info.isDirectory()) {
      latest = Math.max(latest, info.mtimeMs)
      continue
    }

    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && ignoredSourceDirectories.has(entry.name)) continue
      pending.push(join(current, entry.name))
    }
  }

  return latest
}

async function latestOutputMtime(paths) {
  let latest = 0
  for (const current of paths) {
    const info = await stat(current).catch(() => null)
    if (info) latest = Math.max(latest, info.mtimeMs)
  }
  return latest
}

async function readStamp(path) {
  return readFile(path, 'utf8')
    .then((value) => JSON.parse(value))
    .catch(() => null)
}

async function writeStamp(path, kind) {
  await mkdir(distRoot, { recursive: true })
  await writeFile(path, `${JSON.stringify({ kind, platform: platformKey }, null, 2)}\n`)
}

function runNodeScript(script, args = []) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [join(root, script), ...args], {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
    })
    child.once('error', rejectRun)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveRun()
        return
      }
      rejectRun(new Error(`${script} exited with ${code ?? signal ?? 'unknown'}`))
    })
  })
}

function runPnpm(args, label) {
  return new Promise((resolveRun, rejectRun) => {
    const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    const child = spawn(command, args, {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    })
    child.once('error', rejectRun)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveRun()
        return
      }
      rejectRun(new Error(`${label} exited with ${code ?? signal ?? 'unknown'}`))
    })
  })
}

function nativeArtifacts() {
  const extension = process.platform === 'win32' ? '.exe' : ''
  return [
    'sam-segmentation-worker',
    'semantic-segmentation-worker',
    'specialized-segmentation-worker',
    'luna-inpaint-worker',
    'luna-punctuation-worker',
    'luna-asr-worker',
  ].map((name) => join(root, 'luna-render-core', `${name}${extension}`))
}

async function nativeNeedsBuild() {
  const artifacts = nativeArtifacts()
  if (force || artifacts.some((path) => !existsSync(path))) return true

  const stamp = await readStamp(nativeStamp)
  const sourceMtime = await latestSourceMtime([
    join(root, 'luna-render-core/src'),
    join(root, 'luna-render-core/Cargo.toml'),
    join(root, 'luna-render-core/Cargo.lock'),
    join(root, 'vendor/funasr-paraformer'),
  ])
  const artifactMtime = await Promise.all(artifacts.map(async (path) => (await stat(path)).mtimeMs))
  const outputsAreNewer = Math.min(...artifactMtime) >= sourceMtime
  if (stamp?.kind === 'native' && stamp.platform !== platformKey) return true
  return !outputsAreNewer
}

async function prepareNative() {
  if (!(await nativeNeedsBuild())) {
    console.log('[dev] native workers are up to date; skipped build-native')
    await writeStamp(nativeStamp, 'native')
    return
  }

  await runNodeScript('scripts/build-native.mjs')
  await writeStamp(nativeStamp, 'native')
}

async function prepareDolbyTools() {
  const extension = process.platform === 'win32' ? '.exe' : ''
  const tools = [
    join(root, 'resources/dolby-vision', `dovi_tool${extension}`),
    join(root, 'resources/dolby-vision', `mp4mux${extension}`),
  ]
  if (!force && tools.every((path) => existsSync(path))) {
    console.log('[dev] Dolby tools are present; skipped copy-dolby-tools')
    return
  }

  await runNodeScript('scripts/copy-dolby-tools.mjs')
}

function harnessInputs() {
  if (!harnessRoot) return []
  return [
    harnessRoot,
    join(root, 'scripts/ensure-deepseek-harness-deps.mjs'),
    join(root, 'scripts/deepseek-harness-root.mjs'),
  ]
}

async function harnessNeedsBuild() {
  const requiredOutput = [
    join(harnessRoot, 'apps/cli/lib/bin.js'),
    join(harnessRoot, 'apps/web/dist/index.html'),
  ]
  if (force || requiredOutput.some((path) => !existsSync(path))) return true

  const stamp = await readStamp(harnessStamp)
  if (stamp?.kind === 'harness' && stamp.platform !== platformKey) return true

  const sourceMtime = await latestSourceMtime(harnessInputs())
  const outputMtime = await latestOutputMtime(requiredOutput)
  return outputMtime < sourceMtime
}

async function prepareHarness() {
  if (!harnessRoot) {
    console.log('[dev] standalone DeepSeek Harness checkout was not found; skipped')
    return
  }

  await runNodeScript('scripts/ensure-deepseek-harness-deps.mjs')
  if (!(await harnessNeedsBuild())) {
    console.log('[dev] DeepSeek Harness is up to date; skipped build')
    await writeStamp(harnessStamp, 'harness')
    return
  }

  await runPnpm(['--dir', harnessRoot, 'run', 'build'], 'DeepSeek Harness build')
  await writeStamp(harnessStamp, 'harness')
}

async function preparePythonRuntime() {
  await runNodeScript('scripts/prepare-python-runtime.mjs')
}

await Promise.all([
  prepareNative(),
  prepareDolbyTools(),
  prepareHarness(),
  preparePythonRuntime(),
])

console.log('[dev] development prerequisites are ready')
