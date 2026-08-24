import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const projectRoot = path.resolve(import.meta.dirname, '..')
const outputRoot = await mkdtemp(path.join(tmpdir(), 'luna-semantic-protocol-'))

try {
  const sourcePath = path.join(projectRoot, 'electron/features/segmentation/semanticWorkerProtocol.ts')
  const program = ts.createProgram([sourcePath], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    rootDir: projectRoot,
    outDir: outputRoot,
    skipLibCheck: true,
  })
  assert.deepEqual(ts.getPreEmitDiagnostics(program), [])
  assert.equal(program.emit().emitSkipped, false)
  const { parseSemanticWorkerOutput } = await import(pathToFileURL(path.join(outputRoot, 'electron/features/segmentation/semanticWorkerProtocol.js')))

  const mask = Buffer.from([0, 64, 128, 255, 10, 20])
  const output = Buffer.alloc(12 + mask.byteLength)
  output.writeUInt32LE(3, 0)
  output.writeUInt32LE(2, 4)
  output.writeUInt32LE(21, 8)
  mask.copy(output, 12)
  const parsed = parseSemanticWorkerOutput(output)
  assert.deepEqual({ width: parsed.width, height: parsed.height, classId: parsed.classId }, { width: 3, height: 2, classId: 21 })
  assert.deepEqual(parsed.bytes, mask)
  assert.throws(() => parseSemanticWorkerOutput(Buffer.alloc(11)), /数据无效/)
  assert.throws(() => parseSemanticWorkerOutput(output.subarray(0, -1)), /尺寸无效/)
  console.log('semantic worker protocol tests passed')
} finally {
  await rm(outputRoot, { recursive: true, force: true })
}
