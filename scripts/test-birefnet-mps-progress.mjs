import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const projectRoot = path.resolve(import.meta.dirname, '..')
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'luna-birefnet-progress-'))

try {
  const sourcePath = path.join(projectRoot, 'electron/birefNetMpsProgress.ts')
  const program = ts.createProgram([sourcePath], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    rootDir: projectRoot,
    outDir: temporaryRoot,
    skipLibCheck: true,
  })
  assert.deepEqual(ts.getPreEmitDiagnostics(program), [])
  assert.equal(program.emit().emitSkipped, false)

  const { mapBiRefNetMpsProgress } = await import(pathToFileURL(path.join(temporaryRoot, 'electron/birefNetMpsProgress.js')))
  const runtimeBytes = 87
  const modelBytes = 161
  const totalBytes = runtimeBytes + modelBytes
  const mapRuntime = (phase, completedBytes, phaseTotal = 100) => mapBiRefNetMpsProgress(
    { phase, completedBytes, totalBytes: phaseTotal },
    '运行组件',
    0,
    totalBytes,
    runtimeBytes,
  )

  assert.equal(mapRuntime('download', 0).percent, 0)
  assert.equal(mapRuntime('download', 100).percent, 35)
  assert.deepEqual(mapRuntime('install', 0), { label: '正在安装运行组件', percent: 35 })
  assert.deepEqual(mapRuntime('verify', 50), { label: '正在校验运行组件', percent: 35 })

  const modelHalf = mapBiRefNetMpsProgress(
    { phase: 'download', completedBytes: 50, totalBytes: 100 },
    '主体模型',
    runtimeBytes,
    totalBytes,
    modelBytes,
  )
  assert.equal(modelHalf.percent, 68)
  assert.equal(mapBiRefNetMpsProgress(
    { phase: 'verify', completedBytes: 100, totalBytes: 100 },
    '主体模型',
    runtimeBytes,
    totalBytes,
    modelBytes,
  ).percent, 100)

  console.log('BiRefNet MPS progress tests passed')
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
