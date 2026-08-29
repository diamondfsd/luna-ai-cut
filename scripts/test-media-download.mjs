#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
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

  for (const code of ['EHOSTUNREACH', 'ENETUNREACH', 'ECONNREFUSED']) {
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

  console.log('media download tests passed')
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
