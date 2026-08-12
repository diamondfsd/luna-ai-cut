import * as nodeFs from 'node:fs'
import * as fs from 'node:fs/promises'
import git from 'isomorphic-git'

import type { AiEditingSourceResetResult } from '../src/shared/types'
import { resolveSourceWritablePath } from './aiEditingSourceGitMutation.ts'
import { setupAiEditingSourceRepository } from './aiEditingSourceGitSetup.ts'

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

export async function resetEditingSourceToInitial(
  repositoryPath: string,
): Promise<AiEditingSourceResetResult> {
  const history = await git.log({ fs: nodeFs, dir: repositoryPath })
  const initial = history.at(-1)
  if (!initial) throw new Error('剪辑源码仓库没有可用版本')

  const initialPaths = await git.listFiles({ fs: nodeFs, dir: repositoryPath, ref: initial.oid })
  const initialFiles = await Promise.all(initialPaths.map(async (sourcePath) => [
    sourcePath,
    await readCommitFile(repositoryPath, initial.oid, sourcePath),
  ] as const))

  await fs.rm(repositoryPath, { recursive: true, force: true })
  await fs.mkdir(repositoryPath, { recursive: true })
  const rebuilt = await setupAiEditingSourceRepository({
    repositoryPath,
    files: initialFiles,
    resolveWritablePath: (sourcePath, createdDirectories) =>
      resolveSourceWritablePath(repositoryPath, sourcePath, createdDirectories),
  })
  return {
    changed: true,
    initialCommitId: rebuilt.head,
    commitId: rebuilt.head,
  }
}
