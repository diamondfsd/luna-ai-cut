import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const projectRoot = path.resolve(import.meta.dirname, '..')
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'luna-specialized-worker-tests-'))

try {
  const sourcePath = path.join(projectRoot, 'electron/features/segmentation/specializedWorkerClient.ts')
  const attemptSourcePath = path.join(projectRoot, 'electron/features/segmentation/specializedSegmentationAttempt.ts')
  const program = ts.createProgram([sourcePath, attemptSourcePath], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    rootDir: projectRoot,
    outDir: temporaryRoot,
    skipLibCheck: true,
  })
  const diagnostics = ts.getPreEmitDiagnostics(program)
  assert.deepEqual(diagnostics, [], diagnostics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n')).join('\n'))
  assert.equal(program.emit().emitSkipped, false)

  const fakeWorkerPath = path.join(temporaryRoot, 'fake-worker.mjs')
  await writeFile(fakeWorkerPath, `
import { writeFile } from 'node:fs/promises'
import readline from 'node:readline'

let completed = 0
const lines = readline.createInterface({ input: process.stdin })
for await (const line of lines) {
  const command = JSON.parse(line)
  if (command.mode === 'crash') process.exit(17)
  if (command.mode === 'invalid') {
    process.stdout.write('{"kind":"result"}\\n')
    continue
  }
  if (command.mode === 'delay') await new Promise((resolve) => setTimeout(resolve, 10_000))
  if (command.outputPath && command.mode !== 'missing') {
    await writeFile(command.outputPath, Buffer.alloc(command.outputBytes ?? 1, 255))
  }
  process.stdout.write(JSON.stringify({
    kind: 'result',
    id: command.id,
    sessionLoadMs: completed === 0 ? 10 : 0,
    inferenceMs: 5,
    sessionReused: completed > 0,
  }) + '\\n')
  completed += 1
}
`)

  const { SpecializedWorkerClient } = await import(pathToFileURL(path.join(temporaryRoot, 'electron/features/segmentation/specializedWorkerClient.js')))
  const { runSpecializedWorkerAttempt } = await import(pathToFileURL(path.join(temporaryRoot, 'electron/features/segmentation/specializedSegmentationAttempt.js')))
  const client = new SpecializedWorkerClient(() => ({ executable: process.execPath, args: [fakeWorkerPath] }), 2_000)

  const first = await client.segment({ mode: 'success' })
  assert.equal(first.sessionReused, false)
  const second = await client.segment({ mode: 'success' })
  assert.equal(second.sessionReused, true)

  await assert.rejects(client.segment({ mode: 'crash' }), /已退出/)
  assert.equal((await client.segment({ mode: 'success' })).sessionReused, false, 'a crashed worker must be recreated')

  const controller = new AbortController()
  const delayed = client.segment({ mode: 'delay' }, controller.signal)
  controller.abort(new Error('test cancellation'))
  await assert.rejects(delayed, /test cancellation/)
  assert.equal((await client.segment({ mode: 'success' })).sessionReused, false, 'an aborted worker must be recreated')

  await assert.rejects(client.segment({ mode: 'invalid' }), /响应无效|协议不兼容/)
  assert.equal((await client.segment({ mode: 'success' })).sessionReused, false, 'a worker with an invalid protocol must be recreated')

  const outputPath = path.join(temporaryRoot, 'attempt.mask')
  const attempt = (mode, outputBytes = 2) => runSpecializedWorkerAttempt(
    client,
    { mode, outputPath, outputBytes },
    outputPath,
    2,
  )
  await assert.rejects(attempt('missing'), /ENOENT/)
  await assert.rejects(attempt('success', 1), /尺寸无效/)

  client.shutdown()
  console.log('specialized worker client tests passed')
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
