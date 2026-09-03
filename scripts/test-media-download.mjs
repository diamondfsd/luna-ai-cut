#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const projectRoot = path.resolve(import.meta.dirname, '..')
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'luna-media-download-'))
const compiledRoot = path.join(temporaryRoot, 'compiled')

try {
  const sourcePath = path.join(projectRoot, 'electron/media/fileDownloadService.ts')
  const program = ts.createProgram([sourcePath], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    rootDir: projectRoot,
    outDir: compiledRoot,
    skipLibCheck: true,
  })
  assert.deepEqual(ts.getPreEmitDiagnostics(program), [])
  assert.equal(program.emit().emitSkipped, false)
  const service = await import(pathToFileURL(path.join(compiledRoot, 'electron/media/fileDownloadService.js')))

  for (const code of ['EHOSTUNREACH', 'ENETUNREACH', 'ECONNREFUSED', 'EBUSY']) {
    const error = Object.assign(new Error(code), { code })
    assert.equal(service.isTransientDownloadError(error), true, `${code} 应触发媒体下载重试`)
  }

  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-length': '0' })
    response.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const destination = path.join(temporaryRoot, 'empty.mp4')
    await assert.rejects(
      service.downloadToFile({ name: 'empty.mp4', bytes: null, sourceUrl: `http://127.0.0.1:${address.port}/empty` }, destination),
      /下载内容为空/,
    )
    assert.equal((await readdir(temporaryRoot)).includes('empty.mp4'), false, '空响应不能发布为正式媒体文件')
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }

  const serverBytes = Buffer.from('valid-media')
  const validServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-length': String(serverBytes.length) })
    response.end(serverBytes)
  })
  await new Promise((resolve) => validServer.listen(0, '127.0.0.1', resolve))
  try {
    const address = validServer.address()
    assert.ok(address && typeof address === 'object')
    const destination = path.join(temporaryRoot, 'valid.mp4')
    await service.downloadToFile({ name: 'valid.mp4', bytes: 0, sourceUrl: `http://127.0.0.1:${address.port}/valid` }, destination)
    assert.deepEqual(await readFile(destination), serverBytes, '媒体声明大小为 0 时仍应以实际响应内容为准')
  } finally {
    await new Promise((resolve, reject) => validServer.close((error) => error ? reject(error) : resolve()))
  }

  const wiredSourceBytes = Buffer.alloc(4 * 1024 * 1024, 0x5a)
  const wiredSourcePath = path.join(temporaryRoot, 'wired-source.mp4')
  const wiredDestination = path.join(temporaryRoot, 'wired-destination.mp4')
  await writeFile(wiredSourcePath, wiredSourceBytes)
  const wiredAbort = new AbortController()
  const wiredProgress = []
  let wiredProgressObserved = false
  await assert.rejects(
    service.downloadToFileWithRetry(
      { name: 'wired-destination.mp4', bytes: wiredSourceBytes.byteLength, sourceUrl: pathToFileURL(wiredSourcePath).href },
      wiredDestination,
      (progress) => {
        wiredProgress.push(progress)
        if (!wiredProgressObserved && progress.downloaded > 0) {
          wiredProgressObserved = true
          wiredAbort.abort()
        }
      },
      wiredAbort.signal,
    ),
    (error) => service.isAbortError(error),
  )
  assert.equal(wiredProgress[0]?.downloaded, 0, '有线复制开始前应立即上报初始进度')
  assert.equal(wiredProgressObserved, true, '取消前应至少收到一次有线复制进度')
  assert.equal(wiredProgress.some((progress) => progress.speedBps > 0), true, '有线复制进度应包含速度')
  assert.equal((await readdir(temporaryRoot)).includes('wired-destination.mp4'), false, '取消时不能发布正式文件')
  assert.equal((await readdir(temporaryRoot)).includes('wired-destination.mp4.tmp'), false, '取消时应清理临时文件')
  await service.downloadToFileWithRetry(
    { name: 'wired-destination.mp4', bytes: wiredSourceBytes.byteLength, sourceUrl: pathToFileURL(wiredSourcePath).href },
    wiredDestination,
  )
  assert.deepEqual(await readFile(wiredDestination), wiredSourceBytes, '取消后再次下载应能重新开始传输')

  const concurrentBytes = Buffer.from('single-flight-media')
  let concurrentRequests = 0
  const concurrentServer = createServer((_request, response) => {
    concurrentRequests += 1
    response.writeHead(200, { 'content-length': String(concurrentBytes.length) })
    let offset = 0
    const sendChunk = () => {
      if (response.destroyed) return
      if (offset >= concurrentBytes.length) {
        response.end()
        return
      }
      response.write(concurrentBytes.subarray(offset, offset + 1))
      offset += 1
      setTimeout(sendChunk, 10)
    }
    sendChunk()
  })
  await new Promise((resolve) => concurrentServer.listen(0, '127.0.0.1', resolve))
  try {
    const address = concurrentServer.address()
    assert.ok(address && typeof address === 'object')
    const concurrentDestination = path.join(temporaryRoot, 'concurrent.mp4')
    const concurrentItem = { name: 'concurrent.mp4', bytes: concurrentBytes.length, sourceUrl: `http://127.0.0.1:${address.port}/concurrent` }
    await Promise.all([
      service.downloadToFileWithRetry(concurrentItem, concurrentDestination),
      service.downloadToFileWithRetry(concurrentItem, concurrentDestination),
    ])
    assert.equal(concurrentRequests, 1, '同一目标路径的并发下载只能发起一个传输')
    assert.deepEqual(await readFile(concurrentDestination), concurrentBytes)
  } finally {
    await new Promise((resolve, reject) => concurrentServer.close((error) => error ? reject(error) : resolve()))
  }

  console.log('media download tests passed')
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
