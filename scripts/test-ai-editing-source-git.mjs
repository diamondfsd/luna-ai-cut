import assert from 'node:assert/strict'
import * as nodeFs from 'node:fs'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import git from 'isomorphic-git'

import {
  createAiEditingSourceGitApi,
  createAiEditingSourceGitService,
} from '../electron/aiEditingSourceGitService.ts'
import { sourceContentRevision } from '../electron/aiEditingSourceGitMutation.ts'

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'luna-editing-source-git-'))
const projectId = 'Dag9toSB'
const repositoryPath = path.join(
  testRoot,
  'freecut-workspace',
  'projects',
  projectId,
  'editing-source',
)

try {
  for (const invalidId of [
    '',
    '.',
    '..',
    '../escape',
    'nested/project',
    'nested\\project',
    'CON',
  ]) {
    assert.throws(() => createAiEditingSourceGitService(testRoot, invalidId), /项目标识无效/)
  }

  const sourceGitApi = createAiEditingSourceGitApi(testRoot)
  await sourceGitApi.ensure('BridgeProject', { 'luna-project.json': '{}\n' })
  assert.equal(await sourceGitApi.read('BridgeProject', 'luna-project.json'), '{}\n')
  await assert.rejects(sourceGitApi.read('../escape', 'luna-project.json'), /项目标识无效/)
  await assert.rejects(sourceGitApi.write('BridgeProject', '../outside.json', '{}'), /源码路径无效/)

  const concurrentService = createAiEditingSourceGitService(testRoot, 'ConcurrentProject')
  const concurrentInitializations = await Promise.all([
    concurrentService.ensureRepository({ 'manifest.json': '{"version":1}\n' }),
    concurrentService.ensureRepository({ 'manifest.json': 'must-not-overwrite' }),
  ])
  assert.deepEqual(
    concurrentInitializations.map(({ created }) => created),
    [true, false],
  )
  assert.equal(concurrentInitializations[0]?.head, concurrentInitializations[1]?.head)
  const concurrentCommit = Promise.all([
    concurrentService.write('manifest.json', '{"version":2}\n'),
    concurrentService.commit('Serialize write before commit'),
  ])
  const [, concurrentCommitId] = await concurrentCommit
  assert.equal((await concurrentService.status()).clean, true)
  assert.equal((await concurrentService.log())[0]?.oid, concurrentCommitId)

  const failedInitService = createAiEditingSourceGitService(testRoot, 'FailedInitProject')
  await assert.rejects(
    failedInitService.ensureRepository({
      collision: 'temporary parent',
      'collision/child.json': '{}\n',
    }),
    /剪辑源码目录无效/,
  )
  await assert.rejects(fs.access(path.join(failedInitService.repositoryPath, '.git')))
  await assert.rejects(fs.access(path.join(failedInitService.repositoryPath, 'collision')))
  assert.equal(
    (await failedInitService.ensureRepository({ 'manifest.json': '{}\n' })).created,
    true,
  )

  const nonEmptyService = createAiEditingSourceGitService(testRoot, 'NonEmptyProject')
  await fs.mkdir(nonEmptyService.repositoryPath, { recursive: true })
  await fs.writeFile(path.join(nonEmptyService.repositoryPath, 'orphan.json'), 'preserve me')
  await assert.rejects(
    nonEmptyService.ensureRepository({ 'manifest.json': '{}\n' }),
    /未初始化且不为空/,
  )
  assert.equal(
    await fs.readFile(path.join(nonEmptyService.repositoryPath, 'orphan.json'), 'utf8'),
    'preserve me',
  )

  const service = createAiEditingSourceGitService(testRoot, projectId)
  const initialized = await service.ensureRepository({
    'luna-project.json': '{"version":1}\n',
    'segments/001-opening.segment.json': '{"title":"opening"}\n',
  })
  assert.equal(initialized.created, true)
  assert.match(initialized.head ?? '', /^[a-f0-9]{40}$/)
  assert.match(
    await fs.readFile(path.join(repositoryPath, '.git', 'HEAD'), 'utf8'),
    /refs\/heads\/main/,
  )
  const gitConfig = await fs.readFile(path.join(repositoryPath, '.git', 'config'), 'utf8')
  assert.match(gitConfig, /Luna Editing Agent/)
  assert.match(gitConfig, /editing-agent@luna\.local/)
  assert.deepEqual(await service.status(), { branch: 'main', clean: true, entries: [] })
  assert.equal(await service.read('luna-project.json'), '{"version":1}\n')

  await service.create('segments/trailing-newline.json', '{"text":"keep-newline"}\n')
  await service.remove(
    'segments/trailing-newline.json',
    sourceContentRevision('{"text":"keep-newline"}\n'),
  )
  await assert.rejects(service.read('segments/trailing-newline.json'), /ENOENT/)

  const beforeAtomicRevisionFailure = await service.read('luna-project.json')
  await assert.rejects(
    service.applyChanges([
      {
        path: 'luna-project.json',
        content: '{"version":99}\n',
        expectedRevision: '0'.repeat(64),
      },
      { path: 'segments/must-not-exist.json', content: '{}\n', expectedContent: null },
    ]),
    /SOURCE_REVISION_MISMATCH/,
  )
  assert.equal(await service.read('luna-project.json'), beforeAtomicRevisionFailure)
  await assert.rejects(service.read('segments/must-not-exist.json'), /ENOENT/)
  assert.deepEqual(
    (await service.list()).map((entry) => entry.name),
    ['luna-project.json', 'segments'],
  )
  await assert.rejects(service.commit('Empty commit'), /没有需要提交/)

  await fs.writeFile(path.join(repositoryPath, 'luna-project.json'), '{"staged":true}\n')
  await git.add({
    fs: nodeFs,
    dir: repositoryPath,
    filepath: 'luna-project.json',
  })
  await fs.writeFile(path.join(repositoryPath, 'luna-project.json'), '{"version":1}\n')
  assert.deepEqual(await service.status(), {
    branch: 'main',
    clean: false,
    entries: [{ path: 'luna-project.json', change: 'modified' }],
  })
  await git.add({
    fs: nodeFs,
    dir: repositoryPath,
    filepath: 'luna-project.json',
  })
  assert.equal((await service.status()).clean, true)

  await service.applyChanges([
    { path: 'luna-project.json', content: '{"version":2}\n' },
    { path: 'notes/review.txt', content: 'opening checked\n' },
    { path: 'segments/001-opening.segment.json', content: null },
  ])
  assert.deepEqual(await service.status(), {
    branch: 'main',
    clean: false,
    entries: [
      { path: 'luna-project.json', change: 'modified' },
      { path: 'notes/review.txt', change: 'added' },
      { path: 'segments/001-opening.segment.json', change: 'deleted' },
    ],
  })
  assert.deepEqual(await service.diff(), [
    {
      path: 'luna-project.json',
      change: 'modified',
      before: '{"version":1}\n',
      after: '{"version":2}\n',
    },
    {
      path: 'notes/review.txt',
      change: 'added',
      before: null,
      after: 'opening checked\n',
    },
    {
      path: 'segments/001-opening.segment.json',
      change: 'deleted',
      before: '{"title":"opening"}\n',
      after: null,
    },
  ])

  const revisionCommit = await service.commit('Revise source modules')
  assert.match(revisionCommit, /^[a-f0-9]{40}$/)
  assert.equal((await service.log())[0]?.message, 'Revise source modules\n')
  assert.equal((await service.log())[0]?.author.name, 'Luna Editing Agent')
  assert.equal((await service.status()).clean, true)

  await assert.rejects(
    service.applyChanges([
      { path: 'collision', content: 'temporary parent' },
      { path: 'collision/child.json', content: '{}\n' },
    ]),
    /剪辑源码目录无效/,
  )
  await assert.rejects(fs.access(path.join(repositoryPath, 'collision')))
  assert.equal((await service.status()).clean, true)

  await service.createBranch('agent/variant')
  assert.deepEqual(await service.branches(), { current: 'main', names: ['agent/variant', 'main'] })
  await service.checkout('agent/variant')
  await service.write('luna-project.json', '{"version":3,"variant":true}\n')
  await assert.rejects(service.checkout('main'), /请先提交或撤销/)
  await service.commit('Create agent variant')
  await service.checkout('main')
  assert.equal(await service.read('luna-project.json'), '{"version":2}\n')
  assert.deepEqual(await service.branches(), { current: 'main', names: ['agent/variant', 'main'] })

  const outsidePath = path.join(testRoot, 'outside.json')
  for (const unsafePath of [
    '../outside.json',
    '/tmp/outside.json',
    '.git/config',
    'segments\\outside.json',
    'CON',
    'segments/aux.json',
    'segments/LPT1.txt',
  ]) {
    await assert.rejects(service.write(unsafePath, 'unsafe'), /源码路径无效/)
    await assert.rejects(service.read(unsafePath), /源码路径无效/)
    await assert.rejects(service.remove(unsafePath), /源码路径无效/)
  }
  await assert.rejects(fs.access(outsidePath))
  await assert.rejects(service.createBranch('../unsafe'), /分支名称无效/)
  await assert.rejects(service.createBranch('agent/COM1'), /分支名称无效/)
  await assert.rejects(service.checkout('missing'), /分支不存在/)

  if (process.platform !== 'win32') {
    await fs.mkdir(path.join(testRoot, 'outside'), { recursive: true })
    await fs.symlink(path.join(testRoot, 'outside'), path.join(repositoryPath, 'linked-outside'))
    await assert.rejects(service.write('linked-outside/file.json', '{}'), /剪辑源码目录无效/)
    await assert.rejects(service.list(), /不支持的文件/)
  }

  const ensuredAgain = await service.ensureRepository({
    'luna-project.json': 'must-not-overwrite',
  })
  assert.equal(ensuredAgain.created, false)
  assert.equal(await service.read('luna-project.json'), '{"version":2}\n')

  if (process.platform !== 'win32') {
    const transactionDirectory = path.join(repositoryPath, '.git', 'luna-editing-transactions')
    const outsideTransactions = path.join(testRoot, 'outside-transactions')
    await fs.rm(transactionDirectory, { recursive: true, force: true })
    await fs.mkdir(outsideTransactions)
    await fs.symlink(outsideTransactions, transactionDirectory)
    await assert.rejects(service.write('manifest.json', '{}\n'), /剪辑源码目录无效/)
    await assert.rejects(fs.access(path.join(outsideTransactions, 'manifest.json')))
  }
} finally {
  await fs.rm(testRoot, { recursive: true, force: true })
}

console.log('AI editing source Git service tests passed')
