import * as nodeFs from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import git from 'isomorphic-git'

export const AI_EDITING_GIT_AUTHOR = {
  name: 'Luna Editing Agent',
  email: 'editing-agent@luna.local',
} as const

async function configureRepository(repositoryPath: string): Promise<void> {
  await git.setConfig({
    fs: nodeFs,
    dir: repositoryPath,
    path: 'user.name',
    value: AI_EDITING_GIT_AUTHOR.name,
  })
  await git.setConfig({
    fs: nodeFs,
    dir: repositoryPath,
    path: 'user.email',
    value: AI_EDITING_GIT_AUTHOR.email,
  })
}

async function resolveHead(repositoryPath: string): Promise<string | null> {
  try {
    return await git.resolveRef({ fs: nodeFs, dir: repositoryPath, ref: 'HEAD' })
  } catch {
    return null
  }
}

export async function setupAiEditingSourceRepository(input: {
  repositoryPath: string
  files: ReadonlyArray<readonly [string, string]>
  resolveWritablePath: (sourcePath: string, createdDirectories: Set<string>) => Promise<string>
}): Promise<{ created: boolean; head: string }> {
  const gitDirectory = path.join(input.repositoryPath, '.git')
  let repositoryExists = true
  try {
    const stat = await fs.lstat(gitDirectory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('剪辑源码仓库无效')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    repositoryExists = false
    if ((await fs.readdir(input.repositoryPath)).length > 0) {
      throw new Error('剪辑源码目录未初始化且不为空')
    }
  }

  if (repositoryExists) {
    await configureRepository(input.repositoryPath)
    const head = await resolveHead(input.repositoryPath)
    if (!head) throw new Error('剪辑源码仓库没有可用版本')
    return { created: false, head }
  }

  const createdFiles: string[] = []
  const createdDirectories = new Set<string>()
  try {
    await git.init({ fs: nodeFs, dir: input.repositoryPath, defaultBranch: 'main' })
    await configureRepository(input.repositoryPath)
    for (const [sourcePath, content] of input.files) {
      const destination = await input.resolveWritablePath(sourcePath, createdDirectories)
      await fs.writeFile(destination, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      createdFiles.push(destination)
      await git.add({ fs: nodeFs, dir: input.repositoryPath, filepath: sourcePath })
    }
    const head = await git.commit({
      fs: nodeFs,
      dir: input.repositoryPath,
      message: 'Initialize editing source',
      author: AI_EDITING_GIT_AUTHOR,
    })
    return { created: true, head }
  } catch (error) {
    let rollbackFailed = false
    for (const file of createdFiles) {
      await fs.rm(file, { force: true }).catch(() => {
        rollbackFailed = true
      })
    }
    for (const directory of [...createdDirectories].sort(
      (left, right) => right.length - left.length,
    )) {
      await fs.rmdir(directory).catch(() => {
        rollbackFailed = true
      })
    }
    await fs.rm(gitDirectory, { recursive: true, force: true }).catch(() => {
      rollbackFailed = true
    })
    if (rollbackFailed) {
      throw new Error('剪辑源码仓库初始化失败且无法完整恢复', { cause: error })
    }
    throw error
  }
}
