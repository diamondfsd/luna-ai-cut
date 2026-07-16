import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const projectRoot = path.resolve(import.meta.dirname, '..')
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'luna-resumable-download-'))
const compiledRoot = path.join(temporaryRoot, 'compiled')

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

try {
  const sourcePath = path.join(projectRoot, 'electron/resumableDownloadService.ts')
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
  const { downloadVerifiedFile } = await import(pathToFileURL(path.join(compiledRoot, 'electron/resumableDownloadService.js')))

  const destinationDir = path.join(temporaryRoot, 'files')
  const bytes = Buffer.from('luna-resumable-runtime-resource')
  const definition = {
    fileName: 'resource.zip',
    url: 'https://fixture.invalid/resource.zip',
    sizeBytes: bytes.byteLength,
    sha256: sha256(bytes),
  }
  const finalPath = path.join(destinationDir, definition.fileName)
  const abort = new AbortController()
  let pendingReadStarted
  const firstAttempt = downloadVerifiedFile(destinationDir, definition, {
    signal: abort.signal,
    fetcher: async (_url, init) => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: {
        getReader: () => {
          let reads = 0
          return {
            read: () => {
              reads += 1
              if (reads === 1) return Promise.resolve({ done: false, value: bytes.subarray(0, 6) })
              pendingReadStarted?.()
              return new Promise((_resolve, reject) => {
                init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
              })
            },
          }
        },
      },
    }),
  })
  await new Promise((resolve) => { pendingReadStarted = resolve })
  abort.abort()
  await assert.rejects(firstAttempt, (error) => error?.name === 'AbortError')
  assert.equal(existsSync(finalPath), false, '中断时不能发布正式文件')
  const partialName = (await readdir(destinationDir)).find((name) => name.endsWith('.download'))
  assert.ok(partialName, '中断后应保留稳定临时文件用于续传')
  assert.equal((await readFile(path.join(destinationDir, partialName))).byteLength, 6)

  const progress = []
  const resumedPath = await downloadVerifiedFile(destinationDir, definition, {
    onProgress: (value) => progress.push(value),
    fetcher: async (_url, init) => {
      assert.equal(new Headers(init.headers).get('range'), 'bytes=6-')
      return new Response(bytes.subarray(6), {
        status: 206,
        headers: { 'content-range': `bytes 6-${bytes.byteLength - 1}/${bytes.byteLength}` },
      })
    },
  })
  assert.equal(resumedPath, finalPath)
  assert.deepEqual(await readFile(finalPath), bytes)
  assert.equal(progress[0].resumedBytes, 6)
  assert.equal((await readdir(destinationDir)).some((name) => name.endsWith('.download')), false)

  let cacheFetches = 0
  await downloadVerifiedFile(destinationDir, definition, {
    fetcher: async () => { cacheFetches += 1; throw new Error('不应联网') },
  })
  assert.equal(cacheFetches, 0, '完整缓存命中不得联网')

  await rm(finalPath)
  const ignoredRangePartial = path.join(destinationDir, `${definition.fileName}.${definition.sha256.slice(0, 16)}.download`)
  await writeFile(ignoredRangePartial, bytes.subarray(0, 5))
  await downloadVerifiedFile(destinationDir, definition, {
    fetcher: async (_url, init) => {
      assert.equal(new Headers(init.headers).get('range'), 'bytes=5-')
      return new Response(bytes, { status: 200 })
    },
  })
  assert.deepEqual(await readFile(finalPath), bytes, '服务端忽略 Range 时必须覆盖临时文件并从头下载')

  await writeFile(finalPath, 'broken')
  let sawUnpublishedFinal = false
  await downloadVerifiedFile(destinationDir, definition, {
    fetcher: async () => new Response(bytes),
    onProgress: ({ completedBytes }) => {
      if (completedBytes > 0 && completedBytes < bytes.byteLength) sawUnpublishedFinal = !existsSync(finalPath)
    },
  })
  assert.deepEqual(await readFile(finalPath), bytes, '损坏成品应完整重下并原子替换')
  assert.equal(sawUnpublishedFinal, false, '单块响应没有中间进度，但正式文件必须只在校验后出现')

  await assert.rejects(
    downloadVerifiedFile(destinationDir, { ...definition, fileName: '../escape.zip' }),
    /文件名不安全/,
  )
  console.log('resumable download tests passed')
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
