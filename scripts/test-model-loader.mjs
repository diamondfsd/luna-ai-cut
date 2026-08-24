import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const projectRoot = path.resolve(import.meta.dirname, '..')
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'luna-model-loader-tests-'))
const compiledRoot = path.join(temporaryRoot, 'compiled')

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function responseFor(bytes, { status = 200, contentLength = bytes.byteLength } = {}) {
  return new Response(bytes, {
    status,
    headers: contentLength === null ? {} : { 'content-length': String(contentLength) },
  })
}

async function compileModule() {
  const program = ts.createProgram([
    path.join(projectRoot, 'electron/infrastructure/modelFileService.ts'),
    path.join(projectRoot, 'electron/media/resumableDownloadService.ts'),
    path.join(projectRoot, 'electron/infrastructure/modelCacheStatus.ts'),
    path.join(projectRoot, 'electron/infrastructure/sharedLoadRegistry.ts'),
  ], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    rootDir: projectRoot,
    outDir: compiledRoot,
    skipLibCheck: true,
    noEmitOnError: false,
  })
  const diagnostics = ts.getPreEmitDiagnostics(program)
  assert.deepEqual(diagnostics, [], diagnostics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n')).join('\n'))
  assert.equal(program.emit().emitSkipped, false, 'model file service must compile')
}

try {
  await compileModule()
  const { loadVerifiedModelFile, writeAll } = await import(pathToFileURL(path.join(compiledRoot, 'electron/infrastructure/modelFileService.js')))
  const { SharedLoadRegistry } = await import(pathToFileURL(path.join(compiledRoot, 'electron/infrastructure/sharedLoadRegistry.js')))
  const { hasCachedModelFiles } = await import(pathToFileURL(path.join(compiledRoot, 'electron/infrastructure/modelCacheStatus.js')))
  const modelDir = path.join(temporaryRoot, 'model')
  const bytes = Buffer.from('luna-model-fixture-v1')
  const definition = {
    fileName: 'model.onnx',
    url: 'https://fixture.invalid/model.onnx',
    sha256: hash(bytes),
    sizeBytes: bytes.byteLength,
  }
  const statusDir = path.join(temporaryRoot, 'status')
  assert.equal(await hasCachedModelFiles(statusDir, [{ fileName: 'model.onnx', sizeBytes: bytes.byteLength }]), false)
  await mkdir(statusDir, { recursive: true })
  await writeFile(path.join(statusDir, 'model.onnx'), bytes.subarray(0, bytes.byteLength - 1))
  assert.equal(await hasCachedModelFiles(statusDir, [{ fileName: 'model.onnx', sizeBytes: bytes.byteLength }]), false)
  await writeFile(path.join(statusDir, 'model.onnx'), bytes)
  assert.equal(await hasCachedModelFiles(statusDir, [{ fileName: 'model.onnx', sizeBytes: bytes.byteLength }]), true)

  const shortWriteOutput = Buffer.alloc(bytes.byteLength)
  await writeAll({
    async write(buffer, offset, length) {
      const bytesWritten = Math.min(3, length)
      Buffer.from(buffer.buffer, buffer.byteOffset + offset, bytesWritten).copy(shortWriteOutput, offset)
      return { bytesWritten }
    },
  }, bytes)
  assert.deepEqual(shortWriteOutput, bytes, 'partial writes must be retried until every byte is stored')

  let fetchCount = 0
  const progress = []
  const modelPath = await loadVerifiedModelFile(modelDir, definition, {
    fetcher: async () => {
      fetchCount += 1
      return responseFor(bytes)
    },
    onProgress: (value) => progress.push(value),
  })
  assert.deepEqual(await readFile(modelPath), bytes, 'downloaded model bytes must be exact')
  assert.equal(fetchCount, 1)
  assert.deepEqual(progress.at(0), { completedBytes: 0, totalBytes: bytes.byteLength })
  assert.deepEqual(progress.at(-1), { completedBytes: bytes.byteLength, totalBytes: bytes.byteLength })

  await loadVerifiedModelFile(modelDir, definition, {
    fetcher: async () => {
      fetchCount += 1
      throw new Error('cache hit must not fetch')
    },
  })
  assert.equal(fetchCount, 1, 'valid cache must not access the network')

  await writeFile(modelPath, 'corrupt')
  await loadVerifiedModelFile(modelDir, definition, {
    fetcher: async () => {
      fetchCount += 1
      return responseFor(bytes, { contentLength: null })
    },
  })
  assert.equal(fetchCount, 2, 'corrupt cache must be replaced')
  assert.deepEqual(await readFile(modelPath), bytes)

  await rm(modelPath)
  await mkdir(modelPath)
  await loadVerifiedModelFile(modelDir, definition, {
    fetcher: async () => {
      fetchCount += 1
      return responseFor(bytes)
    },
  })
  assert.equal(fetchCount, 3, 'an invalid final path must be replaced')
  assert.deepEqual(await readFile(modelPath), bytes)

  await rm(modelPath)
  await assert.rejects(
    loadVerifiedModelFile(modelDir, { ...definition, sha256: '0'.repeat(64) }, {
      fetcher: async () => responseFor(bytes),
    }),
    /模型文件校验失败/,
  )
  assert.equal(existsSync(modelPath), false, 'failed checksum must not publish a model')
  assert.equal((await readdir(modelDir)).some((name) => name.endsWith('.download')), false, 'failed download must clean temporary files')

  await assert.rejects(
    loadVerifiedModelFile(modelDir, definition, {
      fetcher: async () => responseFor(bytes, { status: 503 }),
    }),
    /模型下载失败 \(503\)/,
  )

  await assert.rejects(
    loadVerifiedModelFile(modelDir, definition, {
      fetcher: async () => { throw new TypeError('fetch failed') },
    }),
    /模型下载失败，请检查网络后重试/,
  )

  const abortController = new AbortController()
  await assert.rejects(
    loadVerifiedModelFile(modelDir, definition, {
      signal: abortController.signal,
      fetcher: async () => responseFor(bytes),
      onProgress: ({ completedBytes }) => {
        if (completedBytes > 0) abortController.abort()
      },
    }),
    (error) => error?.name === 'AbortError',
  )
  assert.equal(existsSync(modelPath), false, 'canceled download must not publish a model')
  assert.equal((await readdir(modelDir)).some((name) => name.endsWith('.download')), true, 'canceled download must preserve resumable temporary data')

  await loadVerifiedModelFile(modelDir, definition, { fetcher: async () => responseFor(bytes) })
  assert.deepEqual(await readFile(modelPath), bytes, 'retry after cancellation must succeed')

  await rm(modelPath)
  let releaseSecondChunk
  const streamingResponse = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 4))
      releaseSecondChunk = () => {
        controller.enqueue(bytes.subarray(4))
        controller.close()
      }
    },
  }), { headers: { 'content-length': String(bytes.byteLength) } })
  const streamingAbort = new AbortController()
  const streamingLoad = loadVerifiedModelFile(modelDir, definition, {
    signal: streamingAbort.signal,
    fetcher: async () => streamingResponse,
    onProgress: ({ completedBytes }) => {
      if (completedBytes === 4) streamingAbort.abort()
    },
  })
  await assert.rejects(streamingLoad, (error) => error?.name === 'AbortError')
  releaseSecondChunk()
  assert.equal(existsSync(modelPath), false, 'mid-stream cancellation must not publish a model')

  let hangingReadStarted
  const hangingReadBarrier = new Promise((resolve) => { hangingReadStarted = resolve })
  const hangingAbort = new AbortController()
  let receivedFetchSignal = false
  let readCount = 0
  const hangingLoad = loadVerifiedModelFile(modelDir, definition, {
    signal: hangingAbort.signal,
    fetcher: async (_url, init) => {
      receivedFetchSignal = init?.signal === hangingAbort.signal
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': String(bytes.byteLength) }),
        body: {
          getReader: () => ({
            read: () => {
              readCount += 1
              if (readCount === 1) return Promise.resolve({ done: false, value: bytes.subarray(0, 4) })
              hangingReadStarted()
              return new Promise((_resolve, reject) => {
                init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
              })
            },
          }),
        },
      }
    },
  })
  await hangingReadBarrier
  hangingAbort.abort()
  await assert.rejects(hangingLoad, (error) => error?.name === 'AbortError')
  assert.equal(receivedFetchSignal, true, 'the caller signal must be passed to fetch')
  assert.equal(existsSync(modelPath), false, 'canceling a pending reader must not publish a model')

  const mismatchedLengthProgress = []
  await loadVerifiedModelFile(modelDir, definition, {
    fetcher: async () => responseFor(bytes, { contentLength: bytes.byteLength - 1 }),
    onProgress: (value) => mismatchedLengthProgress.push(value),
  })
  assert.equal(
    mismatchedLengthProgress.every(({ completedBytes, totalBytes }) => completedBytes <= totalBytes),
    true,
    'server metadata must not produce progress beyond the trusted model size',
  )

  await rm(modelPath)
  await assert.rejects(
    loadVerifiedModelFile(modelDir, definition, {
      fetcher: async () => responseFor(bytes.subarray(0, bytes.byteLength - 1)),
    }),
    /模型文件大小异常/,
  )
  assert.equal(existsSync(modelPath), false, 'a truncated response must not publish a model')

  const oversizedProgress = []
  await assert.rejects(
    loadVerifiedModelFile(modelDir, definition, {
      fetcher: async () => responseFor(Buffer.concat([bytes, Buffer.from([0])])),
      onProgress: (value) => oversizedProgress.push(value),
    }),
    /模型文件大小异常/,
  )
  assert.equal(oversizedProgress.every(({ completedBytes, totalBytes }) => completedBytes <= totalBytes), true)
  assert.equal(existsSync(modelPath), false, 'an oversized response must not publish a model')

  let retry503Count = 0
  await assert.rejects(
    loadVerifiedModelFile(modelDir, definition, {
      fetcher: async () => {
        retry503Count += 1
        return responseFor(bytes, { status: 503 })
      },
    }),
    /模型下载失败 \(503\)/,
  )
  await loadVerifiedModelFile(modelDir, definition, {
    fetcher: async () => {
      retry503Count += 1
      return responseFor(bytes)
    },
  })
  assert.equal(retry503Count, 2, 'an HTTP failure must allow a clean retry')

  await rm(modelPath)
  await assert.rejects(
    loadVerifiedModelFile(modelDir, { ...definition, sha256: '1'.repeat(64) }, {
      fetcher: async () => responseFor(bytes),
    }),
    /模型文件校验失败/,
  )
  await loadVerifiedModelFile(modelDir, definition, { fetcher: async () => responseFor(bytes) })
  assert.deepEqual(await readFile(modelPath), bytes, 'a checksum failure must allow a clean retry')

  const sharedLoads = new SharedLoadRegistry()
  const preCanceled = new AbortController()
  preCanceled.abort()
  let preCanceledStarts = 0
  await assert.rejects(
    sharedLoads.load('pre-canceled', async () => { preCanceledStarts += 1 }, { signal: preCanceled.signal }),
    (error) => error?.name === 'AbortError',
  )
  assert.equal(preCanceledStarts, 0, 'a pre-canceled consumer must not start a load')

  const firstController = new AbortController()
  const firstProgress = []
  const secondProgress = []
  let starts = 0
  let finishSharedLoad
  const startSharedLoad = async (_signal, reportProgress) => {
    starts += 1
    reportProgress(10)
    await new Promise((resolve) => { finishSharedLoad = resolve })
    reportProgress(100)
    return 'ready'
  }
  const firstLoad = sharedLoads.load('model-a', startSharedLoad, {
    signal: firstController.signal,
    onProgress: (value) => firstProgress.push(value),
  })
  const secondLoad = sharedLoads.load('model-a', startSharedLoad, {
    onProgress: (value) => secondProgress.push(value),
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(starts, 1, 'concurrent consumers must share one load')
  assert.deepEqual(firstProgress, [10])
  assert.deepEqual(secondProgress, [10])
  firstController.abort()
  await assert.rejects(firstLoad, (error) => error?.name === 'AbortError')
  finishSharedLoad()
  assert.equal(await secondLoad, 'ready', 'canceling one subscriber must not abort another')
  assert.deepEqual(secondProgress, [10, 100])

  const lateCancelLoads = new SharedLoadRegistry()
  const lateCancelController = new AbortController()
  let finishLateLoad
  const lateStart = async (_signal, reportProgress) => {
    reportProgress(25)
    await new Promise((resolve) => { finishLateLoad = resolve })
    return 'ready'
  }
  const existingLateLoad = lateCancelLoads.load('model-late', lateStart)
  await new Promise((resolve) => setTimeout(resolve, 0))
  const canceledDuringReplay = lateCancelLoads.load('model-late', lateStart, {
    signal: lateCancelController.signal,
    onProgress: () => lateCancelController.abort(),
  })
  await assert.rejects(canceledDuringReplay, (error) => error?.name === 'AbortError')
  finishLateLoad()
  assert.equal(await existingLateLoad, 'ready', 'canceling a late subscriber must not abort an existing consumer')

  const throwingProgressLoads = new SharedLoadRegistry()
  const unaffectedProgress = []
  const throwingLoad = throwingProgressLoads.load('model-progress', async (_signal, reportProgress) => {
    reportProgress(1)
    reportProgress(2)
    return 'ready'
  }, { onProgress: () => { throw new Error('observer failed') } })
  const unaffectedLoad = throwingProgressLoads.load('model-progress', async () => 'wrong', {
    onProgress: (value) => unaffectedProgress.push(value),
  })
  assert.equal(await throwingLoad, 'ready')
  assert.equal(await unaffectedLoad, 'ready')
  assert.deepEqual(unaffectedProgress, [1, 2], 'one observer failure must not affect another subscriber')

  const allCanceledLoads = new SharedLoadRegistry()
  const cancelA = new AbortController()
  const cancelB = new AbortController()
  let underlyingAborted = false
  const waitForAbort = (signal) => new Promise((_resolve, reject) => {
    if (signal.aborted) {
      underlyingAborted = true
      reject(signal.reason)
      return
    }
    signal.addEventListener('abort', () => {
      underlyingAborted = true
      reject(signal.reason)
    }, { once: true })
  })
  const canceledA = allCanceledLoads.load('model-b', waitForAbort, { signal: cancelA.signal })
  const canceledB = allCanceledLoads.load('model-b', waitForAbort, { signal: cancelB.signal })
  cancelA.abort()
  assert.equal(underlyingAborted, false, 'one remaining subscriber must keep the load alive')
  cancelB.abort()
  await assert.rejects(canceledA, (error) => error?.name === 'AbortError')
  await assert.rejects(canceledB, (error) => error?.name === 'AbortError')
  assert.equal(underlyingAborted, true, 'the last cancellation must abort the underlying load')

  let retryStarts = 0
  const immediateRetry = allCanceledLoads.load('model-b', async () => {
    retryStarts += 1
    return 'retried'
  })
  assert.equal(await immediateRetry, 'retried')
  assert.equal(retryStarts, 1, 'retry after all consumers cancel must start a fresh load immediately')

  const ownershipLoads = new SharedLoadRegistry()
  const oldConsumer = new AbortController()
  let releaseOldTask
  let releaseNewTask
  let ownershipStarts = 0
  const oldTask = ownershipLoads.load('owned', async () => {
    ownershipStarts += 1
    await new Promise((resolve) => { releaseOldTask = resolve })
    return 'old'
  }, { signal: oldConsumer.signal })
  await new Promise((resolve) => setTimeout(resolve, 0))
  oldConsumer.abort()
  await assert.rejects(oldTask, (error) => error?.name === 'AbortError')
  const newStart = async () => {
    ownershipStarts += 1
    await new Promise((resolve) => { releaseNewTask = resolve })
    return 'new'
  }
  const newTask = ownershipLoads.load('owned', newStart)
  await new Promise((resolve) => setTimeout(resolve, 0))
  releaseOldTask()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const thirdSubscriber = ownershipLoads.load('owned', async () => {
    ownershipStarts += 1
    return 'wrong'
  })
  assert.equal(ownershipStarts, 2, 'an old task finishing must not remove the replacement task')
  releaseNewTask()
  assert.equal(await newTask, 'new')
  assert.equal(await thirdSubscriber, 'new')

  const failedLoads = new SharedLoadRegistry()
  let failureStarts = 0
  await assert.rejects(
    failedLoads.load('failure', async () => {
      failureStarts += 1
      throw new Error('first failure')
    }),
    /first failure/,
  )
  assert.equal(await failedLoads.load('failure', async () => {
    failureStarts += 1
    return 'recovered'
  }), 'recovered')
  assert.equal(failureStarts, 2, 'a naturally failed task must allow an immediate retry')

  console.log('model loader tests passed')
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
