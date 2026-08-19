import { cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { builtinModules } from 'node:module'
import process from 'node:process'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harnessRoot = join(root, 'packages/freecut-editor/src/features/ai-editing')
const layoutRoot = join(harnessRoot, 'packages/client/ui-layout')
const settingsGeneralRoot = join(harnessRoot, 'packages/client/ui-settings-general')
const output = join(root, 'dist/deepseek-harness')
const plugin = join(root, 'scripts/deepseek-harness-freecut-plugin.mjs')
const scriptRuntime = join(root, 'scripts/deepseek-harness-script-runtime.mjs')
const builtInSkills = join(root, 'packages/freecut-editor/src/features/ai-editing/skills/built-in')
const nodeModules = join(output, 'node_modules')
const deepseekPackages = join(nodeModules, '@deepseek-ai')
const bundleStage = join(output, '.deepseek-bundle-stage')
const generatedBundleFiles = []

if (!existsSync(join(harnessRoot, 'package.json'))) {
  console.log('[harness-build] FreeCut source has no embedded Harness; skipped')
  process.exit(0)
}

const nativePackagePrefixes = [
  '@img/',
  '@koromix/',
  '@vscode/ripgrep',
  'node-addon-require-builtin',
]
const nativePackageNames = new Set(['koffi', 'node-pty', 'sharp'])

function packageNameOf(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/')
  return specifier.split('/')[0]
}

function isExternalHarnessDependency(specifier) {
  if (specifier.startsWith('node:')) return true
  const packageName = packageNameOf(specifier)
  if (packageName.startsWith('@deepseek-ai/')) return true
  if (nativePackageNames.has(packageName)) return true
  return nativePackagePrefixes.some((prefix) => packageName.startsWith(prefix))
}

function normalizePackagePath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '')
}

async function walkFiles(directory) {
  const results = []
  if (!existsSync(directory)) return results
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) results.push(...await walkFiles(entryPath))
    else if (entry.isFile()) results.push(entryPath)
  }
  return results
}

async function directorySize(directory) {
  let total = 0
  for (const file of await walkFiles(directory)) total += (await stat(file)).size
  return total
}

function externalImportsFrom(source) {
  const imports = new Set()
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\n)[ \t]*\/\/[^\r\n]*/g, '$1')
  const patterns = [
    /(?:^|\n)[ \t]*(?:import|export)\b[^\n;]*?\bfrom\s+["']([^"']+)["']/g,
    /(?:^|\n)[ \t]*import\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\b(?:require|__require)\s*\(\s*["']([^"']+)["']\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      const specifier = match[1]
      if (specifier && !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('#')) {
        imports.add(specifier)
      }
    }
  }
  return imports
}

async function packageMetadata(packageDirectory) {
  const packageJson = join(packageDirectory, 'package.json')
  if (!existsSync(packageJson)) return null
  return JSON.parse(await readFile(packageJson, 'utf8'))
}

function runtimeMain(metadata, packageDirectory) {
  if (typeof metadata.main !== 'string') return null
  const main = normalizePackagePath(metadata.main)
  if (!main.endsWith('.js')) return null
  const mainPath = join(packageDirectory, main)
  return existsSync(mainPath) ? { path: mainPath, relativePath: main } : null
}

async function bundlePackageMain(build, packageDirectory, metadata) {
  const main = runtimeMain(metadata, packageDirectory)
  if (!main) return false
  const source = await readFile(main.path, 'utf8')
  if (/\.(?:css|scss|less)(?:["'])/.test(source)) return 'skipped-css'

  const stageDirectory = join(bundleStage, metadata.name, 'lib')
  await rm(stageDirectory, { recursive: true, force: true })
  await build({
    config: false,
    cwd: packageDirectory,
    entry: main.path,
    outDir: stageDirectory,
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: true,
    hash: false,
    logLevel: 'silent',
    deps: {
      alwaysBundle: (specifier) => !isExternalHarnessDependency(specifier),
    },
  })

  const runtimeDirectory = join(packageDirectory, 'lib')
  for (const generatedFile of await walkFiles(stageDirectory)) {
    const destination = join(runtimeDirectory, relative(stageDirectory, generatedFile))
    await mkdir(dirname(destination), { recursive: true })
    // pnpm deploy may hard-link runtime files back to the workspace package.
    // Remove each destination before copying so generated output cannot mutate
    // a source file through the link.
    await rm(destination, { force: true })
    await cp(generatedFile, destination, { dereference: true })
    generatedBundleFiles.push(destination)
  }
  return 'bundled'
}

async function directPackageDirectories(directory) {
  const results = []
  if (!existsSync(directory)) return results
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const entryPath = join(directory, entry.name)
    if (entry.name.startsWith('@')) {
      for (const scopedEntry of await readdir(entryPath, { withFileTypes: true })) {
        if (scopedEntry.isDirectory()) results.push({
          name: `${entry.name}/${scopedEntry.name}`,
          path: join(entryPath, scopedEntry.name),
        })
      }
    } else {
      results.push({ name: entry.name, path: entryPath })
    }
  }
  return results
}

async function bundleDeepSeekPackages(build) {
  const packages = await directPackageDirectories(deepseekPackages)
  let bundled = 0
  let skippedCss = 0
  for (const packageInfo of packages) {
    const metadata = await packageMetadata(packageInfo.path)
    if (!metadata) continue
    const result = await bundlePackageMain(build, packageInfo.path, metadata)
    if (result === 'bundled') bundled += 1
    else if (result === 'skipped-css') skippedCss += 1
  }
  console.log(`DeepSeek Harness packages bundled: ${bundled}/${packages.length} (browser CSS entries skipped: ${skippedCss})`)
}

async function bundleHarnessCli(build) {
  const cliLib = join(output, 'lib')
  const cliEntry = join(cliLib, 'bin.js')
  const stageDirectory = join(bundleStage, 'cli', 'lib')
  await rm(stageDirectory, { recursive: true, force: true })
  await build({
    config: false,
    cwd: output,
    entry: cliEntry,
    outDir: stageDirectory,
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: true,
    hash: false,
    logLevel: 'silent',
    deps: {
      alwaysBundle: (specifier) => !isExternalHarnessDependency(specifier),
    },
  })
  await rm(cliLib, { recursive: true, force: true })
  await cp(stageDirectory, cliLib, { recursive: true, dereference: true })
  generatedBundleFiles.push(...await walkFiles(cliLib))
}

function isAllowedBundleImport(specifier) {
  if (isExternalHarnessDependency(specifier)) return true
  const packageName = packageNameOf(specifier)
  return builtinModules.includes(specifier) || builtinModules.includes(packageName)
}

async function reportBundleImports() {
  const violations = []
  for (const file of generatedBundleFiles) {
    if (!/\.(?:js|mjs|cjs)$/.test(file)) continue
    const source = await readFile(file, 'utf8')
    for (const specifier of externalImportsFrom(source)) {
      if (!isAllowedBundleImport(specifier)) violations.push(`${relative(output, file)} -> ${specifier}`)
    }
  }
  if (violations.length > 0) {
    console.log(`DeepSeek Harness bundle keeps external imports (${violations.length}):\n${violations.join('\n')}`)
  }
}

async function packageDependencyClosure(packageNames, packageDirectories) {
  const keep = new Set(packageNames)
  const pending = [...keep]
  while (pending.length > 0) {
    const packageName = pending.pop()
    if (packageName.startsWith('@deepseek-ai/')) continue
    const packageInfo = packageDirectories.find((candidate) => candidate.name === packageName)
    if (!packageInfo) continue
    const metadata = await packageMetadata(packageInfo.path)
    if (!metadata) continue
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const dependency of Object.keys(metadata[field] ?? {})) {
        if (keep.has(dependency)) continue
        keep.add(dependency)
        pending.push(dependency)
      }
    }
  }
  return keep
}

async function pruneBundledDependencies() {
  const packageDirectories = await directPackageDirectories(nodeModules)
  const keep = new Set(packageDirectories
    .filter(({ name }) => name.startsWith('@deepseek-ai/'))
    .map(({ name }) => name))
  for (const packageInfo of packageDirectories) {
    const files = await walkFiles(packageInfo.path)
    if (files.some((file) => file.endsWith('.node') || file.endsWith('/bin/rg') || file.endsWith('/bin/rg.exe'))) {
      keep.add(packageInfo.name)
    }
  }

  const runtimeFiles = [
    ...await walkFiles(join(output, 'lib')),
    ...await walkFiles(deepseekPackages),
  ].filter((file) => /\.(?:js|mjs|cjs)$/.test(file))
  for (const file of runtimeFiles) {
    const source = await readFile(file, 'utf8')
    for (const specifier of externalImportsFrom(source)) {
      const packageName = packageNameOf(specifier)
      if (!packageName.startsWith('@deepseek-ai/') && !builtinModules.includes(packageName)) {
        keep.add(packageName)
      }
    }
  }

  const keepWithDependencies = await packageDependencyClosure(keep, packageDirectories)
  const before = await directorySize(nodeModules)
  let removed = 0
  for (const packageInfo of packageDirectories) {
    if (keepWithDependencies.has(packageInfo.name)) continue
    await rm(packageInfo.path, { recursive: true, force: true })
    removed += 1
  }
  await rm(join(nodeModules, '.bin'), { recursive: true, force: true })
  await rm(join(nodeModules, '.pnpm'), { recursive: true, force: true })
  await rm(join(nodeModules, '.modules.yaml'), { force: true })
  const after = await directorySize(nodeModules)
  console.log(`DeepSeek Harness dependencies pruned: ${removed}, ${(before / 1024 / 1024).toFixed(1)} MiB -> ${(after / 1024 / 1024).toFixed(1)} MiB`)
}

// The deployed Web runtime consumes workspace bundles from lib/.
// Rebuild host and client output first so source changes cannot be hidden by
// stale ignored output in a fresh worktree.
const harnessHostBuild = spawnSync('pnpm', [
  '--dir', harnessRoot,
  'run', 'build:lib:host',
], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (harnessHostBuild.status !== 0) process.exit(harnessHostBuild.status ?? 1)

const bin = (name) => join(harnessRoot, 'node_modules/.bin', process.platform === 'win32' ? `${name}.cmd` : name)
for (const clientRoot of [layoutRoot, settingsGeneralRoot]) {
  const clientTypes = spawnSync(bin('tsc'), ['-b', 'tsconfig.json'], {
    cwd: clientRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (clientTypes.status !== 0) process.exit(clientTypes.status ?? 1)
  const clientBuild = spawnSync(bin('tsdown'), ['--env.DSH_BUILD_FACE', 'client'], {
    cwd: clientRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (clientBuild.status !== 0) process.exit(clientBuild.status ?? 1)
}

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
const rootLefthookConfig = join(root, 'lefthook.yml')
const hadRootLefthookConfig = existsSync(rootLefthookConfig)
const result = spawnSync('pnpm', [
  '--dir', harnessRoot,
  '--filter', '@deepseek-ai/dsh',
  'deploy', '--prod', '--legacy', '--config.node-linker=hoisted', output,
], {
  cwd: root,
  stdio: 'inherit',
})
if (!hadRootLefthookConfig) await rm(rootLefthookConfig, { force: true })
if (result.status !== 0) process.exit(result.status ?? 1)

// The upstream deploy omits workspace packages that are referenced through
// runtime-only config or peer edges. Copy their published runtime files
// explicitly; copying a whole workspace package would recurse through pnpm
// links and make the packaged tree invalid.
async function findPackageJsons(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const results = []
  for (const entry of entries) {
    if (entry.name === 'node_modules') continue
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) results.push(...await findPackageJsons(entryPath))
    else if (entry.isFile() && entry.name === 'package.json') results.push(entryPath)
  }
  return results
}

for (const packageRoot of ['vendor', 'packages']) {
  for (const packageJsonPath of await findPackageJsons(join(harnessRoot, packageRoot))) {
    const packageDirectory = dirname(packageJsonPath)
    const metadata = JSON.parse(await readFile(packageJsonPath, 'utf8'))
    if (typeof metadata.name !== 'string' || !metadata.name.startsWith('@deepseek-ai/')) continue
    const runtimeDirectories = ['lib', 'dist', 'assets']
      .filter((directory) => existsSync(join(packageDirectory, directory)))
    if (runtimeDirectories.length === 0) continue
    const target = join(output, 'node_modules', metadata.name)
    const targetPackageJson = join(target, 'package.json')
    // pnpm deploy may hard-link an already published package into the output.
    // Leave those files untouched: replacing a hard link would also mutate the
    // source checkout on filesystems that preserve the link.
    if (existsSync(targetPackageJson)) continue
    await mkdir(target, { recursive: true })
    await cp(packageJsonPath, targetPackageJson)
    for (const directory of runtimeDirectories) {
      await cp(join(packageDirectory, directory), join(target, directory), { recursive: true, dereference: true })
    }
  }
}

await cp(plugin, join(output, 'luna-freecut-plugin.mjs'))
await cp(scriptRuntime, join(output, 'deepseek-harness-script-runtime.mjs'))
await cp(join(root, 'scripts/deepseek-harness-built-in-skills.mjs'), join(output, 'deepseek-harness-built-in-skills.mjs'))
await cp(builtInSkills, join(output, 'skills/built-in'), { recursive: true, dereference: true })
const { build: buildWithTsdown } = await import(pathToFileURL(join(
  harnessRoot,
  'node_modules/tsdown/dist/index.mjs',
)).href)
await bundleDeepSeekPackages(buildWithTsdown)
await bundleHarnessCli(buildWithTsdown)
await reportBundleImports()
await pruneBundledDependencies()
await rm(bundleStage, { recursive: true, force: true })
console.log(`DeepSeek Harness Web runtime prepared at ${output}`)
