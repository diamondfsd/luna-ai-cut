import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDeepSeekHarnessRoot } from './deepseek-harness-root.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harnessRoot = resolveDeepSeekHarnessRoot(root)
if (!harnessRoot) {
  console.log('[harness-deps] standalone DeepSeek Harness checkout was not found; skipped')
  process.exit(0)
}
const harnessPackagePath = join(harnessRoot, 'package.json')
const harnessNodeModules = join(harnessRoot, 'node_modules')
const harnessHostTypeSentinel = join(harnessRoot, 'vendor/cosmokit/lib/types/index.d.ts')

if (!existsSync(harnessPackagePath)) {
  console.log('[harness-deps] vendored DeepSeek Harness was not found; skipped')
  process.exit(0)
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function requiredPackages() {
  const packageJson = readJson(harnessPackagePath)
  const typescript = readJson(join(harnessNodeModules, 'typescript', 'package.json'))
  const tsdown = readJson(join(harnessNodeModules, 'tsdown', 'package.json'))
  const typescriptMajor = Number.parseInt(String(typescript.version).split('.')[0] ?? '', 10)
  const expectedTypeScript = packageJson.devDependencies?.typescript

  if (!existsSync(join(harnessNodeModules, '.bin', 'tsc'))) return 'node_modules/.bin/tsc'
  if (!existsSync(join(harnessNodeModules, '.bin', 'tsdown'))) return 'node_modules/.bin/tsdown'
  if (!Number.isFinite(typescriptMajor) || typescriptMajor < 6) {
    return `typescript@${String(typescript.version)} (需要 ${String(expectedTypeScript ?? 'TypeScript 6')})`
  }
  if (!tsdown.version) return 'tsdown'
  return null
}

function packageManagerCommand(packageJson) {
  const declaration = packageJson.packageManager
  const match = typeof declaration === 'string' ? declaration.match(/^([^@]+)@(.+)$/) : null
  if (!match) throw new Error(`Harness packageManager 配置无效：${String(declaration)}`)
  const command = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
  return { command, args: [`${match[1]}@${match[2]}`, 'install', '--frozen-lockfile'] }
}

function tscCommand() {
  return join(harnessNodeModules, '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc')
}

function installedPackagePath(name) {
  const store = join(harnessNodeModules, '.pnpm')
  const prefix = `${name.replaceAll('/', '+')}@`
  const entry = readdirSync(store).find((candidate) => candidate.startsWith(prefix))
  return entry ? join(store, entry, 'node_modules', name) : null
}

function ensurePeerDependencyAnchor(name) {
  const target = join(harnessNodeModules, name)
  if (existsSync(target)) return false

  const source = installedPackagePath(name)
  if (!source || !existsSync(source)) return false
  const resolved = realpathSync(source)
  mkdirSync(dirname(target), { recursive: true })
  symlinkSync(relative(dirname(target), resolved), target)
  return true
}

function ensureReactPeerDependencyAnchors() {
  const anchors = ['react', 'react-dom', '@types/react', '@types/react-dom']
  const created = anchors
    .filter((name) => ensurePeerDependencyAnchor(name))
  if (created.length > 0) {
    console.log(`[harness-deps] anchored peer dependencies locally: ${created.join(', ')}`)
  }
}

function repairIncompleteHostBuild() {
  if (existsSync(harnessHostTypeSentinel)) return

  console.log('[harness-deps] Host build outputs are incomplete; rebuilding TypeScript project references')
  const result = spawnSync(tscCommand(), ['-b', 'tsconfig.host.json', '--force'], {
    cwd: harnessRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
  if (!existsSync(harnessHostTypeSentinel)) {
    throw new Error(`Harness Host build did not produce ${harnessHostTypeSentinel}`)
  }
}

const missing = (() => {
  if (!existsSync(harnessPackagePath)) return 'Harness package.json'
  if (!existsSync(join(harnessRoot, 'pnpm-lock.yaml'))) return 'Harness pnpm-lock.yaml'
  if (!existsSync(harnessNodeModules)) return 'Harness node_modules'
  try {
    return requiredPackages()
  } catch {
    return 'Harness workspace dependencies'
  }
})()

if (!missing) {
  console.log('[harness-deps] Harness workspace dependencies are ready')
  ensureReactPeerDependencyAnchors()
  repairIncompleteHostBuild()
  process.exit(0)
}

const packageJson = readJson(harnessPackagePath)
const install = packageManagerCommand(packageJson)
console.log(`[harness-deps] missing or stale dependency: ${missing}`)
console.log(`[harness-deps] installing with ${install.args[0]} in ${harnessRoot}`)
const result = spawnSync(install.command, install.args, {
  cwd: harnessRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

const remaining = requiredPackages()
if (remaining) throw new Error(`Harness workspace dependencies remain incomplete：${remaining}`)
console.log('[harness-deps] Harness workspace dependencies installed')
ensureReactPeerDependencyAnchors()
repairIncompleteHostBuild()
