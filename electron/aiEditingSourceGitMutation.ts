import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AiEditingSourceChange } from '../src/shared/types'
import {
  ensurePlainDirectory,
  MAX_CHANGE_BATCH_BYTES,
  sourceContentBytes,
  validateSourcePath,
} from './aiEditingSourceGitPaths.ts'

async function inspectTarget(repositoryPath: string, sourcePath: string): Promise<string> {
  const segments = sourcePath.split('/')
  let current = repositoryPath
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment)
    try {
      const stat = await fs.lstat(current)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('剪辑源码目录无效')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break
      throw error
    }
  }
  return path.join(repositoryPath, ...segments)
}

export async function resolveSourceWritablePath(
  repositoryPath: string,
  sourcePath: string,
  createdDirectories?: Set<string>,
): Promise<string> {
  const segments = sourcePath.split('/')
  let parent = repositoryPath
  for (const segment of segments.slice(0, -1)) {
    parent = path.join(parent, segment)
    try {
      await fs.lstat(parent)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') createdDirectories?.add(parent)
      else throw error
    }
    await ensurePlainDirectory(parent, true)
  }
  const target = path.join(parent, segments.at(-1)!)
  try {
    const stat = await fs.lstat(target)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('剪辑源码路径类型无效')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return target
}

function normalizeChanges(changes: AiEditingSourceChange[]) {
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > 500) {
    throw new Error('源码改动批次无效')
  }
  let batchBytes = 0
  const normalized = changes.map((change) => {
    if (!change || typeof change !== 'object' ||
      (change.content !== null && typeof change.content !== 'string')) {
      throw new Error('源码改动无效')
    }
    if (change.content !== null) batchBytes += sourceContentBytes(change.content)
    if (change.expectedContent !== undefined && change.expectedContent !== null &&
      typeof change.expectedContent !== 'string') {
      throw new Error('源码原文约束无效')
    }
    return {
      path: validateSourcePath(change.path),
      content: change.content,
      ...('expectedContent' in change ? { expectedContent: change.expectedContent } : {}),
    }
  })
  if (batchBytes > MAX_CHANGE_BATCH_BYTES) throw new Error('源码改动批次超出大小限制')
  if (new Set(normalized.map((change) => change.path)).size !== normalized.length) {
    throw new Error('源码改动路径重复')
  }
  return normalized
}

export async function applySourceChangesTransaction(
  repositoryPath: string,
  changes: AiEditingSourceChange[],
): Promise<void> {
  const normalized = normalizeChanges(changes)
  const transactionDirectory = path.join(repositoryPath, '.git', 'luna-editing-transactions')
  await ensurePlainDirectory(transactionDirectory, true)
  const transactionRoot = path.join(transactionDirectory, randomUUID())
  const snapshots: Array<{ target: string; backup: string; existed: boolean }> = []
  const createdDirectories = new Set<string>()
  let appliedCount = 0
  let preserveTransaction = false
  try {
    await fs.mkdir(transactionRoot)
    for (const [index, change] of normalized.entries()) {
      const target = await inspectTarget(repositoryPath, change.path)
      let existed = false
      try {
        const stat = await fs.lstat(target)
        if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('剪辑源码路径类型无效')
        existed = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      if (change.expectedContent === null && existed) {
        throw new Error(`SOURCE_CHANGED: 文件已经存在：${change.path}`)
      }
      if (typeof change.expectedContent === 'string') {
        if (!existed) throw new Error(`SOURCE_CHANGED: 文件已经不存在：${change.path}`)
        if (await fs.readFile(target, 'utf8') !== change.expectedContent) {
          throw new Error(`SOURCE_CHANGED: 文件原文已经变化：${change.path}`)
        }
      }
      if (change.content === null && !existed) throw new Error('要删除的剪辑源码不存在')
      const backup = path.join(transactionRoot, `${index}.backup`)
      if (existed) await fs.copyFile(target, backup)
      if (change.content !== null) {
        await fs.writeFile(path.join(transactionRoot, `${index}.next`), change.content, {
          encoding: 'utf8',
          mode: 0o600,
        })
      }
      snapshots.push({ target, backup, existed })
    }

    for (const [index, change] of normalized.entries()) {
      const snapshot = snapshots[index]!
      if (change.content === null) await fs.rm(snapshot.target)
      else {
        const destination = await resolveSourceWritablePath(
          repositoryPath,
          change.path,
          createdDirectories,
        )
        await fs.rename(path.join(transactionRoot, `${index}.next`), destination)
      }
      appliedCount += 1
    }
  } catch (error) {
    let rollbackFailed = false
    for (const snapshot of snapshots.slice(0, appliedCount).reverse()) {
      try {
        if (snapshot.existed) {
          await fs.mkdir(path.dirname(snapshot.target), { recursive: true })
          await fs.copyFile(snapshot.backup, snapshot.target)
        } else await fs.rm(snapshot.target, { force: true })
      } catch {
        rollbackFailed = true
      }
    }
    for (const directory of [...createdDirectories].sort((left, right) => right.length - left.length)) {
      await fs.rmdir(directory).catch(() => undefined)
    }
    if (rollbackFailed) {
      preserveTransaction = true
      throw new Error('源码改动失败且无法完整恢复', { cause: error })
    }
    throw error
  } finally {
    if (!preserveTransaction) {
      await fs.rm(transactionRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
