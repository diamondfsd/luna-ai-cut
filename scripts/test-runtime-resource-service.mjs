import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import AdmZip from 'adm-zip'
import { path7za } from '7zip-bin'
import ts from 'typescript'

const projectRoot = path.resolve(import.meta.dirname, '..')
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'luna-runtime-resource-service-'))
const compiledRoot = path.join(temporaryRoot, 'compiled')

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function makeFixture(id, entries) {
  const zip = new AdmZip()
  for (const [entryPath, content] of entries) zip.addFile(entryPath, Buffer.from(content))
  const archive = zip.toBuffer()
  return {
    archive,
    definition: {
      id,
      kind: 'lut',
      version: '1.0.0',
      fileName: `${id}.zip`,
      url: `https://fixture.invalid/${id}.zip`,
      archiveBytes: archive.byteLength,
      unpackedBytes: entries.reduce((total, [, content]) => total + Buffer.byteLength(content), 0),
      sha256: sha256(archive),
      archiveRoot: 'luts',
      expectedFileCount: entries.length,
      archiveFormat: 'zip',
      allowedExtensions: ['.cube', '.json'],
    },
  }
}

function fixtureFetcher(bytes, onFetch = () => undefined) {
  return async () => {
    onFetch()
    return new Response(bytes)
  }
}

async function assertNoPublishedOrStaging(cacheRoot, id) {
  const packRoot = path.join(cacheRoot, id)
  if (!existsSync(packRoot)) return
  const names = await readdir(packRoot)
  assert.equal(names.includes('1.0.0'), false, '失败或取消时不能发布正式版本目录')
  assert.equal(names.some((name) => name.endsWith('.staging')), false, '失败或取消后不能遗留 staging 目录')
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail('等待资源服务完成清理超时')
}

try {
  const sourcePath = path.join(projectRoot, 'electron/runtimeResourceService.ts')
  const program = ts.createProgram([sourcePath], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    rootDir: projectRoot,
    outDir: compiledRoot,
    skipLibCheck: true,
    esModuleInterop: true,
  })
  assert.deepEqual(ts.getPreEmitDiagnostics(program), [])
  assert.equal(program.emit().emitSkipped, false)
  await symlink(
    path.join(projectRoot, 'node_modules'),
    path.join(compiledRoot, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  const service = await import(pathToFileURL(path.join(compiledRoot, 'electron/runtimeResourceService.js')))
  const { loadRuntimeResource, getRuntimeResourceCachePath } = service

  const normal = makeFixture('normal-pack', [
    ['luts/first.cube', 'TITLE "first"\n'],
    ['luts/catalog.json', '{"items":["first"]}\n'],
  ])
  const normalRoot = path.join(temporaryRoot, 'normal-cache')
  let normalFetches = 0
  const installedPath = await loadRuntimeResource(normalRoot, normal.definition, {
    fetcher: fixtureFetcher(normal.archive, () => { normalFetches += 1 }),
  })
  assert.equal(normalFetches, 1)
  assert.equal(installedPath, path.join(normalRoot, normal.definition.id, normal.definition.version, 'luts'))
  assert.equal((await readFile(path.join(installedPath, 'first.cube'), 'utf8')), 'TITLE "first"\n')
  assert.equal(await getRuntimeResourceCachePath(normalRoot, normal.definition), installedPath)
  const normalPackEntries = await readdir(path.join(normalRoot, normal.definition.id))
  assert.deepEqual(normalPackEntries, [normal.definition.version], '正式资源目录不能包含 staging')

  const hotPath = await loadRuntimeResource(normalRoot, normal.definition, {
    fetcher: async () => { throw new Error('热缓存不应访问网络') },
  })
  assert.equal(hotPath, installedPath)

  const sevenZipSource = path.join(temporaryRoot, 'seven-source', 'runtime')
  await mkdir(sevenZipSource, { recursive: true })
  await writeFile(path.join(sevenZipSource, 'worker'), '#!/bin/sh\necho ready\n')
  await chmod(path.join(sevenZipSource, 'worker'), 0o755)
  await writeFile(path.join(sevenZipSource, 'config.json'), '{"ready":true}\n')
  await writeFile(path.join(sevenZipSource, 'empty.txt'), '')
  const sevenZipArchivePath = path.join(temporaryRoot, 'runtime.7z')
  execFileSync(path7za, ['a', '-t7z', '-mx=1', sevenZipArchivePath, 'runtime'], {
    cwd: path.join(sevenZipSource, '..'),
    stdio: 'ignore',
  })
  const sevenZipArchive = await readFile(sevenZipArchivePath)
  const sevenZipDefinition = {
    id: 'sevenzip-pack',
    kind: 'model',
    version: '1.0.0',
    fileName: 'runtime.7z',
    url: 'https://fixture.invalid/runtime.7z',
    archiveBytes: sevenZipArchive.byteLength,
    unpackedBytes: Buffer.byteLength('#!/bin/sh\necho ready\n') + Buffer.byteLength('{"ready":true}\n'),
    sha256: sha256(sevenZipArchive),
    archiveRoot: 'runtime',
    expectedFileCount: 3,
    archiveFormat: '7z',
    allowedExtensions: null,
    executablePaths: ['runtime/worker'],
  }
  const sevenZipCache = path.join(temporaryRoot, 'sevenzip-cache')
  const sevenZipInstalled = await loadRuntimeResource(sevenZipCache, sevenZipDefinition, {
    sevenZipPath: path7za,
    fetcher: fixtureFetcher(sevenZipArchive),
  })
  assert.equal(await readFile(path.join(sevenZipInstalled, 'config.json'), 'utf8'), '{"ready":true}\n')
  assert.notEqual((await stat(path.join(sevenZipInstalled, 'worker'))).mode & 0o111, 0, '7z 安装后必须恢复 worker 可执行权限')

  const concurrent = makeFixture('concurrent-pack', [
    ['luts/shared.cube', 'shared-resource'],
  ])
  const concurrentRoot = path.join(temporaryRoot, 'concurrent-cache')
  let concurrentFetches = 0
  let releaseFetch
  const fetchGate = new Promise((resolve) => { releaseFetch = resolve })
  const progressA = []
  const progressB = []
  const sharedFetcher = async () => {
    concurrentFetches += 1
    await fetchGate
    return new Response(concurrent.archive)
  }
  const sharedA = loadRuntimeResource(concurrentRoot, concurrent.definition, {
    fetcher: sharedFetcher,
    onProgress: (progress) => progressA.push(progress),
  })
  const sharedB = loadRuntimeResource(concurrentRoot, concurrent.definition, {
    fetcher: sharedFetcher,
    onProgress: (progress) => progressB.push(progress),
  })
  releaseFetch()
  const [sharedPathA, sharedPathB] = await Promise.all([sharedA, sharedB])
  assert.equal(concurrentFetches, 1, '同一资源的并发请求必须共享底层任务')
  assert.equal(sharedPathA, sharedPathB)
  assert.ok(progressA.length > 0 && progressB.length > 0, '所有并发使用者都应收到进度')

  const canceled = makeFixture('canceled-pack', [
    ['luts/one.cube', 'one'],
    ['luts/two.cube', 'two'],
  ])
  const canceledRoot = path.join(temporaryRoot, 'canceled-cache')
  const cancelController = new AbortController()
  const canceledLoad = loadRuntimeResource(canceledRoot, canceled.definition, {
    signal: cancelController.signal,
    fetcher: fixtureFetcher(canceled.archive),
    onProgress: (progress) => {
      if (progress.phase === 'install' && progress.completedBytes > 0) cancelController.abort()
    },
  })
  await assert.rejects(canceledLoad, (error) => error?.name === 'AbortError')
  await waitFor(async () => {
    const packRoot = path.join(canceledRoot, canceled.definition.id)
    return !existsSync(packRoot) || !(await readdir(packRoot)).some((name) => name.endsWith('.staging'))
  })
  await assertNoPublishedOrStaging(canceledRoot, canceled.definition.id)
  assert.equal(await getRuntimeResourceCachePath(canceledRoot, canceled.definition), null)

  const badSha = makeFixture('bad-sha-pack', [['luts/bad.cube', 'bad-sha']])
  const badShaRoot = path.join(temporaryRoot, 'bad-sha-cache')
  await assert.rejects(
    loadRuntimeResource(badShaRoot, { ...badSha.definition, sha256: '0'.repeat(64) }, {
      fetcher: fixtureFetcher(badSha.archive),
    }),
    /校验失败/,
  )
  await assertNoPublishedOrStaging(badShaRoot, badSha.definition.id)

  for (const [name, entries, expectedError] of [
    ['zip-slip-pack', [['../escape.cube', 'escape']], /根目录不匹配|不安全路径/],
    ['wrong-root-pack', [['fonts/not-a-lut.cube', 'wrong-root']], /根目录不匹配/],
  ]) {
    const unsafe = makeFixture(name, entries)
    const unsafeRoot = path.join(temporaryRoot, `${name}-cache`)
    await assert.rejects(
      loadRuntimeResource(unsafeRoot, unsafe.definition, { fetcher: fixtureFetcher(unsafe.archive) }),
      expectedError,
    )
    assert.equal(existsSync(path.join(unsafeRoot, 'escape.cube')), false, 'Zip Slip 不能写出缓存根目录')
    await assertNoPublishedOrStaging(unsafeRoot, unsafe.definition.id)
  }

  const repaired = makeFixture('repair-pack', [
    ['luts/repair.cube', 'original'],
    ['luts/repair.json', '{"ok":true}'],
  ])
  const repairedRoot = path.join(temporaryRoot, 'repair-cache')
  let repairFetches = 0
  const repairFetcher = fixtureFetcher(repaired.archive, () => { repairFetches += 1 })
  const repairedPath = await loadRuntimeResource(repairedRoot, repaired.definition, { fetcher: repairFetcher })
  await unlink(path.join(repairedPath, 'repair.json'))
  assert.equal(await getRuntimeResourceCachePath(repairedRoot, repaired.definition), repairedPath, '完成标识存在时不检查资源内容')
  await loadRuntimeResource(repairedRoot, repaired.definition, { fetcher: repairFetcher })
  await writeFile(path.join(repairedPath, 'repair.cube'), 'changed-size')
  assert.equal(await getRuntimeResourceCachePath(repairedRoot, repaired.definition), repairedPath, '完成标识存在时不检查文件大小')
  await loadRuntimeResource(repairedRoot, repaired.definition, { fetcher: repairFetcher })
  assert.equal((await readFile(path.join(repairedPath, 'repair.cube'), 'utf8')), 'changed-size')
  assert.equal(repairFetches, 1, '完成标识存在时不得重复下载')
  await unlink(path.join(repairedRoot, repaired.definition.id, repaired.definition.version, '.luna-resource.json'))
  assert.equal(await getRuntimeResourceCachePath(repairedRoot, repaired.definition), null, '缺少完成标识时缓存必须失效')
  await loadRuntimeResource(repairedRoot, repaired.definition, { fetcher: repairFetcher })
  assert.equal((await readFile(path.join(repairedPath, 'repair.cube'), 'utf8')), 'original')
  assert.equal(repairFetches, 2, '缺少完成标识时应重新安装')
  assert.deepEqual(await readdir(path.join(repairedRoot, repaired.definition.id)), [repaired.definition.version])

  console.log('runtime resource service tests passed')
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
