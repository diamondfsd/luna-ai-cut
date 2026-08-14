import { cp, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import process from 'node:process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harnessRoot = join(root, 'packages/freecut-editor/src/features/ai-editing')
const output = join(root, 'dist/deepseek-harness')
const plugin = join(root, 'scripts/deepseek-harness-freecut-plugin.mjs')

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
console.log(`DeepSeek Harness Web runtime prepared at ${output}`)
