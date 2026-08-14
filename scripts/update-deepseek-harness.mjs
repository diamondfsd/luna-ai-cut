import { chmod, copyFile, cp, lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..')
const configPath = join(repoRoot, 'deepseek-harness.upstream.json')
const harnessRelative = 'packages/freecut-editor/src/features/ai-editing'
const harnessRoot = join(repoRoot, harnessRelative)
const gitCommand = 'git'
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const commitPattern = /^[0-9a-f]{40}$/
const ignoredDirectories = new Set([
  '.git',
  '.cache',
  '.pnpm-store',
  '.playwright-mcp',
  '.sessions',
  '.storages',
  '.worktrees',
  'coverage',
  'dist',
  'dist-exe',
  'lib',
  'node_modules',
  'tmp',
  'worktrees',
])

class SyncError extends Error {}

function git(args, cwd) {
  try {
    return execFileSync(gitCommand, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).replace(/\s+$/u, '')
  } catch (error) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : ''
    const detail = stderr.length > 0 ? `: ${stderr}` : ''
    throw new SyncError(`git ${args.join(' ')} failed${detail}`)
  }
}

function gitProcess(args, cwd, options = {}) {
  const result = spawnSync(gitCommand, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
  if (result.error) throw new SyncError(`git ${args.join(' ')} failed: ${result.error.message}`)
  return result
}

function runPnpm(args, cwd, label) {
  const result = spawnSync(pnpmCommand, args, { cwd, stdio: 'inherit' })
  if (result.error) throw new SyncError(`${label} failed: ${result.error.message}`)
  if (result.status !== 0) throw new SyncError(`${label} failed with exit code ${String(result.status)}`)
}

function runNodeScript(script, args, cwd, label) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, stdio: 'inherit' })
  if (result.error) throw new SyncError(`${label} failed: ${result.error.message}`)
  if (result.status !== 0) throw new SyncError(`${label} failed with exit code ${String(result.status)}`)
}

function readGitFiles(cwd) {
  const output = git(['ls-files', '-z'], cwd)
  return output.split('\0').filter(Boolean)
}

function readCommitFiles(cwd, commit) {
  return git(['ls-tree', '-r', '-z', '--name-only', commit], cwd).split('\0').filter(Boolean)
}

function assertConfig(value) {
  if (typeof value !== 'object' || value === null) throw new SyncError('deepseek-harness.upstream.json must contain an object')
  if (typeof value.repository !== 'string' || value.repository.length === 0) throw new SyncError('upstream repository is required')
  if (typeof value.ref !== 'string' || !/^[A-Za-z0-9._/-]+$/u.test(value.ref) || value.ref.startsWith('-')) {
    throw new SyncError('upstream ref must be a non-empty Git ref name')
  }
  if (typeof value.syncedCommit !== 'string' || !commitPattern.test(value.syncedCommit)) {
    throw new SyncError('syncedCommit must be a 40-character lowercase commit id')
  }
  if (value.path !== harnessRelative) throw new SyncError(`upstream path must remain ${harnessRelative}`)
  return value
}

async function readConfig() {
  let parsed
  try {
    parsed = JSON.parse(await readFile(configPath, 'utf8'))
  } catch (error) {
    throw new SyncError(`cannot read ${configPath}: ${error.message}`)
  }
  return assertConfig(parsed)
}

function assertHarnessClean() {
  const status = git(['status', '--porcelain=v1', '--untracked-files=all', '--', harnessRelative], repoRoot)
  if (status.length > 0) {
    throw new SyncError(
      `Harness 工作区有未提交改动，已停止：\n${status}\n请先提交或明确处理这些改动后再同步。`,
    )
  }
}

function resolveRemoteRef(ref) {
  if (ref.startsWith('refs/')) return ref
  return `refs/heads/${ref}`
}

function resolveRemoteCommit(config) {
  const remoteRef = resolveRemoteRef(config.ref)
  const result = gitProcess(['ls-remote', '--exit-code', config.repository, remoteRef], repoRoot, { timeout: 30_000 })
  if (result.error) throw new SyncError(`无法查询上游提交：${result.error.message}`)
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim()
    throw new SyncError(`无法查询上游提交${stderr.length > 0 ? `: ${stderr}` : ''}`)
  }
  const output = (result.stdout || '').trim()
  const commit = output.split(/\s+/u)[0]
  if (!commitPattern.test(commit ?? '')) throw new SyncError(`远端 ${remoteRef} 没有返回有效提交`)
  return { commit, remoteRef }
}

async function forEachConcurrent(items, worker, limit = 32) {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      await worker(items[index])
    }
  })
  await Promise.all(workers)
}

async function copyEntry(source, target) {
  const info = await lstat(source)
  await mkdir(dirname(target), { recursive: true })
  if (info.isSymbolicLink()) {
    await rm(target, { force: true })
    await symlink(await readlink(source), target)
    return
  }
  await copyFile(source, target)
  await chmod(target, info.mode & 0o777)
}

async function copyTrackedSnapshot(sourceRoot, targetRoot, files) {
  await forEachConcurrent(files, (file) => copyEntry(join(sourceRoot, file), join(targetRoot, file)))
}

async function removeTrackedFiles(root, files) {
  await forEachConcurrent(files, (file) => rm(join(root, file), { force: true }))
}

function shouldCopyWorkingTreeEntry(source) {
  const path = relative(harnessRoot, source)
  if (path.length === 0) return true
  const parts = path.split(sep)
  if (parts.some((part) => ignoredDirectories.has(part))) return false
  const name = parts.at(-1) ?? ''
  return !name.endsWith('.tsbuildinfo') && name !== '.DS_Store' && name !== 'pnpm-debug.log'
}

async function importCurrentSnapshot(tempRoot) {
  // The nested Harness .gitignore hides documentation and other source files
  // from the parent repository. Copy the working tree with only generated
  // dependency/build directories excluded, then force-add the resulting tree
  // so a three-way merge also carries those local files.
  await cp(harnessRoot, tempRoot, {
    recursive: true,
    dereference: false,
    filter: shouldCopyWorkingTreeEntry,
  })
  git(['add', '-A', '--force'], tempRoot)
  git(['commit', '--quiet', '--allow-empty', '-m', 'FreeCut local snapshot'], tempRoot)
  return git(['rev-parse', 'HEAD'], tempRoot)
}

function mergeUpstream(tempRoot, baseCommit, latestCommit) {
  if (baseCommit === latestCommit) return false
  const ancestor = gitProcess(['merge-base', '--is-ancestor', baseCommit, latestCommit], tempRoot)
  if (ancestor.status !== 0) {
    throw new SyncError(
      `配置中的同步提交 ${baseCommit} 不是远端 ${latestCommit} 的祖先；请人工确认上游历史后更新基线。`,
    )
  }
  const result = gitProcess(['merge', '--no-commit', '--no-ff', '--no-edit', latestCommit], tempRoot)
  if (result.status !== 0) {
    const conflicts = git(['diff', '--name-only', '--diff-filter=U'], tempRoot)
    gitProcess(['merge', '--abort'], tempRoot)
    throw new SyncError(
      `上游更新无法自动合并，已停止。冲突文件：\n${conflicts || '(未能列出冲突文件)'}`,
    )
  }
  return true
}

function runRescope(tempRoot, mode) {
  const script = join(tempRoot, 'scripts/rescope-vendor.ts')
  if (!existsSync(script)) throw new SyncError(`临时 Harness 缺少 ${relative(tempRoot, script)}`)
  const tsxEntry = join(harnessRoot, 'node_modules/tsx/dist/cli.mjs')
  if (!existsSync(tsxEntry)) throw new SyncError('Harness 缺少 tsx 运行时，请先在 Harness 目录执行 pnpm install。')
  runNodeScript(tsxEntry, [script, mode === 'check' ? '--check' : '--apply'], repoRoot, `rescope-vendor ${mode}`)
}

function commitPreparedSnapshot(tempRoot) {
  git(['add', '-A'], tempRoot)
  git(['commit', '--quiet', '--allow-empty', '-m', 'Apply FreeCut Harness adaptations'], tempRoot)
  return git(['rev-parse', 'HEAD'], tempRoot)
}

function changedFiles(tempRoot, before, after) {
  return git(['diff', '--name-status', '--no-renames', `${before}..${after}`], tempRoot)
    .split('\n')
    .filter(Boolean)
}

function printChangeSummary(tempRoot, before, after) {
  const changes = changedFiles(tempRoot, before, after)
  if (changes.length === 0) {
    console.log('DeepSeek Harness: 没有需要写回的文件。')
    return changes
  }
  console.log(`DeepSeek Harness: 将写回 ${String(changes.length)} 个文件：`)
  for (const change of changes.slice(0, 200)) console.log(`  ${change}`)
  if (changes.length > 200) console.log(`  ... 其余 ${String(changes.length - 200)} 个文件省略`)
  return changes
}

async function writeSnapshot(tempRoot, previousFiles) {
  const nextFiles = readGitFiles(tempRoot)
  const nextSet = new Set(nextFiles)
  await removeTrackedFiles(harnessRoot, previousFiles.filter((file) => !nextSet.has(file)))
  await copyTrackedSnapshot(tempRoot, harnessRoot, nextFiles)
}

async function restoreSnapshot(tempRoot, localCommit) {
  git(['reset', '--hard', '--quiet', localCommit], tempRoot)
  await writeSnapshot(tempRoot, readCommitFiles(tempRoot, localCommit))
}

async function writeSyncedCommit(config, commit) {
  const next = { ...config, syncedCommit: commit }
  await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`)
}

function usage() {
  console.log(`用法：pnpm update:deepseek-harness [--check|--dry-run]

默认模式会拉取上游、执行三方合并、重新应用 FreeCut 适配、安装 Harness 依赖并运行 build:app。
--check    只检查工作区和上游合并可行性，不写入文件。
--dry-run  预演完整同步并显示文件变化，不写入当前工作区。
`)
}

async function main() {
  const rawArgs = process.argv.slice(2)
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs
  if (args.includes('--help') || args.includes('-h')) {
    usage()
    return
  }
  const modes = args.filter((arg) => arg === '--check' || arg === '--dry-run')
  if (args.some((arg) => !modes.includes(arg))) throw new SyncError(`未知参数：${args.find((arg) => !modes.includes(arg))}`)
  if (modes.length > 1) throw new SyncError('--check 和 --dry-run 不能同时使用')

  const mode = modes[0] === '--check' ? 'check' : modes[0] === '--dry-run' ? 'dry-run' : 'apply'
  const config = await readConfig()
  assertHarnessClean()
  const { commit: latestCommit, remoteRef } = resolveRemoteCommit(config)
  console.log(`DeepSeek Harness upstream: ${config.repository} ${remoteRef}`)
  console.log(`DeepSeek Harness synced:  ${config.syncedCommit}`)
  console.log(`DeepSeek Harness remote:   ${latestCommit}`)

  const tempRoot = await mkdtemp(join(tmpdir(), 'luna-deepseek-harness-'))
  let localCommit
  try {
    git(['init', '--quiet'], tempRoot)
    git(['config', 'user.name', 'Luna Harness Sync'], tempRoot)
    git(['config', 'user.email', 'luna-harness-sync@localhost'], tempRoot)
    if (latestCommit !== config.syncedCommit) {
      git(['remote', 'add', 'upstream', config.repository], tempRoot)
      const fetchArgs = [
        'fetch',
        '--no-tags',
        '--filter=blob:none',
        'upstream',
        config.syncedCommit,
        `${remoteRef}:refs/remotes/upstream/latest`,
      ]
      const fetched = gitProcess(fetchArgs, tempRoot, { timeout: 120_000 })
      if (fetched.status !== 0) {
        const fallback = gitProcess(
          ['fetch', '--no-tags', 'upstream', config.syncedCommit, `${remoteRef}:refs/remotes/upstream/latest`],
          tempRoot,
          { timeout: 120_000 },
        )
        if (fallback.status !== 0) {
          const stderr = (fallback.stderr || fetched.stderr || '').trim()
          throw new SyncError(`无法获取上游提交${stderr.length > 0 ? `: ${stderr}` : ''}`)
        }
      }
      git(['checkout', '--quiet', '--detach', config.syncedCommit], tempRoot)
    }
    localCommit = await importCurrentSnapshot(tempRoot)
    const merged = mergeUpstream(tempRoot, config.syncedCommit, latestCommit)

    if (mode === 'check' && !merged) {
      runRescope(tempRoot, 'apply')
      const preparedCommit = commitPreparedSnapshot(tempRoot)
      const changes = printChangeSummary(tempRoot, localCommit, preparedCommit)
      if (changes.length === 0) console.log('DeepSeek Harness: 当前同步提交和 FreeCut 适配均已验证，无需更新。')
      else console.log('DeepSeek Harness: 当前上游已是最新，但临时适配仍有待写回的文件。')
      return
    }

    runRescope(tempRoot, mode === 'check' ? 'apply' : mode)
    if (mode !== 'check') {
      runPnpm(['--dir', tempRoot, 'install', '--lockfile-only', '--ignore-scripts'], repoRoot, 'Harness lockfile update')
    }
    const preparedCommit = commitPreparedSnapshot(tempRoot)
    const changes = printChangeSummary(tempRoot, localCommit, preparedCommit)

    if (mode === 'check') {
      console.log(`DeepSeek Harness: 检查完成，存在可应用的上游更新（${String(changes.length)} 个文件）。`)
      return
    }
    if (mode === 'dry-run') {
      console.log(`DeepSeek Harness: dry-run 完成，当前工作区未修改。目标提交为 ${latestCommit}。`)
      return
    }
    if (!merged) {
      console.log('DeepSeek Harness: 已是最新版本，当前工作区未修改。')
      return
    }

    assertHarnessClean()
    const previousConfig = await readFile(configPath, 'utf8')
    const previousFiles = readCommitFiles(tempRoot, localCommit)
    try {
      await writeSnapshot(tempRoot, previousFiles)
      runPnpm(['--dir', harnessRoot, 'install', '--ignore-scripts', '--frozen-lockfile'], repoRoot, 'Harness dependency install')
      runPnpm(['run', 'build:app'], repoRoot, 'FreeCut build:app')
      await writeSyncedCommit(config, latestCommit)
      console.log(`DeepSeek Harness: 已同步到 ${latestCommit}。请检查并提交工作区改动。`)
    } catch (error) {
      console.error(`DeepSeek Harness: 同步后验证失败，正在恢复原快照：${error.message}`)
      await restoreSnapshot(tempRoot, localCommit)
      await writeFile(configPath, previousConfig)
      throw error
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

main().catch((error) => {
  console.error(`DeepSeek Harness: ${error.message}`)
  process.exitCode = 1
})
