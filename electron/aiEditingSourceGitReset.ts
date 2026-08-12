import * as nodeFs from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import git from 'isomorphic-git'
import type { AiEditingSourceChange, AiEditingSourceResetResult } from '../src/shared/types'
import { ensurePlainDirectory, validateSourcePath } from './aiEditingSourceGitPaths.ts'
import { applySourceChangesTransaction } from './aiEditingSourceGitMutation.ts'
import { AI_EDITING_GIT_AUTHOR } from './aiEditingSourceGitSetup.ts'

async function listWorktreeFiles(repositoryPath: string): Promise<string[]> {
  const files: string[] = []
  const pending = ['']
  while (pending.length > 0) {
    const sourceDirectory = pending.shift()!
    const directory = path.join(repositoryPath, ...sourceDirectory.split('/').filter(Boolean))
    await ensurePlainDirectory(directory, false)
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (!sourceDirectory && entry.name === '.git') continue
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
        throw new Error('剪辑源码目录包含不支持的文件')
      }
      const sourcePath = sourceDirectory ? `${sourceDirectory}/${entry.name}` : entry.name
      if (entry.isDirectory()) pending.push(sourcePath)
      else files.push(validateSourcePath(sourcePath))
    }
  }
  return files.sort()
}

async function readCommitFile(
  repositoryPath: string,
  commitId: string,
  sourcePath: string,
): Promise<string> {
  const { blob } = await git.readBlob({
    fs: nodeFs,
    dir: repositoryPath,
    oid: commitId,
    filepath: sourcePath,
  })
  return Buffer.from(blob).toString('utf8')
}

async function stageAll(repositoryPath: string): Promise<void> {
  const rows = await git.statusMatrix({ fs: nodeFs, dir: repositoryPath })
  for (const [sourcePath, head, workdir, stage] of rows) {
    if (head === stage && workdir === stage) continue
    if (workdir === 0) await git.remove({ fs: nodeFs, dir: repositoryPath, filepath: sourcePath })
    else await git.add({ fs: nodeFs, dir: repositoryPath, filepath: sourcePath })
  }
}

export async function resetEditingSourceToInitial(
  repositoryPath: string,
): Promise<AiEditingSourceResetResult> {
  const history = await git.log({ fs: nodeFs, dir: repositoryPath })
  const initial = history.at(-1)
  const head = history[0]
  if (!initial || !head) throw new Error('剪辑源码仓库没有可用版本')

  const initialPaths = await git.listFiles({ fs: nodeFs, dir: repositoryPath, ref: initial.oid })
  const initialFiles = new Map(
    await Promise.all(initialPaths.map(async (sourcePath) => [
      sourcePath,
      await readCommitFile(repositoryPath, initial.oid, sourcePath),
    ] as const)),
  )
  const changes: AiEditingSourceChange[] = []
  for (const [sourcePath, content] of initialFiles) {
    let current: string | null = null
    try {
      current = await fs.readFile(path.join(repositoryPath, ...sourcePath.split('/')), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (current !== content) changes.push({ path: sourcePath, content })
  }
  for (const sourcePath of await listWorktreeFiles(repositoryPath)) {
    if (!initialFiles.has(sourcePath)) changes.push({ path: sourcePath, content: null })
  }
  if (changes.length === 0) {
    return { changed: false, initialCommitId: initial.oid, commitId: head.oid }
  }

  await applySourceChangesTransaction(repositoryPath, changes)
  await stageAll(repositoryPath)
  const commitId = await git.commit({
    fs: nodeFs,
    dir: repositoryPath,
    message: 'Restore initial editing source',
    author: AI_EDITING_GIT_AUTHOR,
    disallowEmpty: true,
  })
  return { changed: true, initialCommitId: initial.oid, commitId }
}
