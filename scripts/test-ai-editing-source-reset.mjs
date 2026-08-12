import assert from 'node:assert/strict'
import * as nodeFs from 'node:fs'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import git from 'isomorphic-git'

import { resetEditingSourceToInitial } from '../electron/aiEditingSourceGitReset.ts'
import { AI_EDITING_GIT_AUTHOR } from '../electron/aiEditingSourceGitSetup.ts'

const repositoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'luna-source-reset-'))
try {
  await git.init({ fs: nodeFs, dir: repositoryPath, defaultBranch: 'main' })
  await fs.writeFile(path.join(repositoryPath, 'manifest.json'), '{"version":1}\n')
  await git.add({ fs: nodeFs, dir: repositoryPath, filepath: 'manifest.json' })
  await git.commit({
    fs: nodeFs,
    dir: repositoryPath,
    message: 'Initialize editing source',
    author: AI_EDITING_GIT_AUTHOR,
  })

  await fs.writeFile(path.join(repositoryPath, 'manifest.json'), '{"version":2}\n')
  await git.add({ fs: nodeFs, dir: repositoryPath, filepath: 'manifest.json' })
  await git.commit({
    fs: nodeFs,
    dir: repositoryPath,
    message: 'Change editing source',
    author: AI_EDITING_GIT_AUTHOR,
  })

  const restored = await resetEditingSourceToInitial(repositoryPath)
  assert.equal(restored.changed, true)
  assert.equal(restored.commitId, restored.initialCommitId)
  assert.equal(await fs.readFile(path.join(repositoryPath, 'manifest.json'), 'utf8'), '{"version":1}\n')
  assert.equal((await git.log({ fs: nodeFs, dir: repositoryPath })).length, 1)

  const repeated = await resetEditingSourceToInitial(repositoryPath)
  assert.equal(repeated.changed, true)
  assert.equal(repeated.commitId, repeated.initialCommitId)
  assert.equal((await git.log({ fs: nodeFs, dir: repositoryPath })).length, 1)
} finally {
  await fs.rm(repositoryPath, { recursive: true, force: true })
}

console.log('AI editing source reset tests passed')
