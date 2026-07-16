import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const projectRoot = path.resolve(import.meta.dirname, '..')
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'luna-segmentation-task-tests-'))
const sourcePath = path.join(projectRoot, 'electron/segmentationTaskRegistry.ts')

try {
  const program = ts.createProgram([sourcePath], {
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

  const { SegmentationTaskRegistry } = await import(pathToFileURL(path.join(temporaryRoot, 'electron/segmentationTaskRegistry.js')))
  const registry = new SegmentationTaskRegistry()
  const taskA = registry.begin(1, 'request-a')
  assert.equal(registry.isActive(taskA), true)
  assert.throws(() => registry.begin(1, 'request-a'), /任务标识重复/)

  assert.equal(registry.cancel(2, 'request-a'), false, 'another renderer must not cancel the task')
  assert.equal(registry.cancel(1, 'missing'), false)
  assert.equal(registry.cancel(1, 'request-a'), true)
  assert.equal(taskA.controller.signal.aborted, true)
  assert.equal(registry.isActive(taskA), false)

  const retriedA = registry.begin(1, 'request-a')
  registry.finish(taskA)
  assert.equal(registry.isActive(retriedA), true, 'finishing an old task must not remove a retry')

  const taskB = registry.begin(1, 'request-b')
  const otherOwnerTask = registry.begin(2, 'request-a')
  assert.equal(registry.cancelOwner(1), 2)
  assert.equal(retriedA.controller.signal.aborted, true)
  assert.equal(taskB.controller.signal.aborted, true)
  assert.equal(registry.isActive(otherOwnerTask), true, 'owner cleanup must not affect another renderer')
  assert.equal(registry.cancelOwner(1), 0)

  registry.finish(otherOwnerTask)
  assert.equal(registry.isActive(otherOwnerTask), false)
  console.log('segmentation task registry tests passed')
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
