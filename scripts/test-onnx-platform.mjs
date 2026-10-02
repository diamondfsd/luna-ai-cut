#!/usr/bin/env node
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { closeSync, copyFileSync, createReadStream, existsSync, openSync, readdirSync, rmSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import ts from 'typescript'
import { ensureMacX64OnnxRuntime } from './prepare-macos-x64-runtime.mjs'

const root = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
function option(name, fallback) {
  const index = args.indexOf(name)
  if (index < 0) return fallback
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value for ${name}`)
  return args[index + 1]
}
const platform = option('--platform', process.platform)
if (platform !== process.platform || !['darwin', 'win32'].includes(platform)) {
  throw new Error('Run the macOS test on macOS, or the Windows test on Windows')
}
const runtime = option('--runtime', process.env.LUNA_ONNX_TEST_RUNTIME)
if (runtime && !existsSync(runtime)) throw new Error('ONNX Runtime library does not exist')
const modelRoot = resolve(option('--models', platform === 'darwin'
  ? join(homedir(), 'Library', 'Application Support', 'luna-ai-cut', 'models')
  : join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'luna-ai-cut', 'models')))
const output = resolve(option('--output', join(root, 'test-results', 'onnx-platform', `${platform}-${Date.now()}`)))
const only = option('--model', '')

async function definitions(file) {
  const source = (await readFile(join(root, 'src', 'shared', file), 'utf8'))
    .replace(/^import .*ADE20K_REMAINING_SEGMENTATION_TARGETS.*\n/m, 'const ADE20K_REMAINING_SEGMENTATION_TARGETS = [];\n')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
}
const [seg, inpaint, subtitles, reference, composition] = await Promise.all([
  definitions('segmentationModels.ts'), definitions('inpaintModels.ts'), definitions('subtitleModels.ts'),
  definitions('referenceMatchModels.ts'), definitions('compositionModels.ts'),
])
const catalog = []
function add(definition, kind, width, height = width, id = definition.id, filename = 'model.onnx') {
  catalog.push({ id, kind, width, height, path: join(modelRoot, definition.id, filename), sha256: definition.sha256 })
}
for (const model of [...seg.SEGMENTATION_MODELS, ...seg.SPECIALIZED_SEGMENTATION_MODELS, ...seg.AI_SELECTION_MODELS, ...composition.COMPOSITION_MODELS]) {
  add(model, 'image', model.inputSize, model.id === 'ultraface-rfb-320' ? 240 : model.inputSize)
}
for (const model of seg.SAM_MODELS) {
  for (const [key, kind] of [['visionEncoder', 'sam-encoder'], ['promptDecoder', 'sam-decoder']]) {
    add({ ...model, sha256: model.files[key].sha256 }, kind, model.inputSize, model.inputSize, `${model.id}-${key}`, model.files[key].fileName)
  }
}
for (const model of inpaint.INPAINT_MODELS) add(model, 'inpaint', 512, 512, model.id, model.fileName)
for (const model of reference.REFERENCE_MATCH_MODELS) add(model, 'reference', model.inputSize, model.inputSize, model.id, model.fileName)
for (const [definition,kind] of [[subtitles.SUBTITLE_ASR_MODEL,'asr'],[subtitles.SUBTITLE_VAD_MODEL,'vad'],[subtitles.SUBTITLE_PUNCTUATION_MODEL,'punctuation']]) {
  add(definition,kind,0,0,definition.id,definition.fileName)
}
const ids = only.split(',')
const selected = only ? catalog.filter(model => ids.includes(model.id)) : catalog
if (only && ids.some(id => !selected.some(model => model.id === id))) throw new Error(`Unknown model in ${only}`)
if (!selected.length) throw new Error(`Unknown model ${only}`)
const problems = []
for (const model of selected) {
  if (!existsSync(model.path)) { problems.push(`Missing ${model.id}: ${model.path}`); continue }
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(model.path)) hash.update(chunk)
  if (hash.digest('hex') !== model.sha256) problems.push(`Model hash mismatch: ${model.id}`)
}
if (problems.length) throw new Error(`${problems.join('\n')}\nDownload these models in the app first. The test does not download or modify models.`)
await mkdir(output, { recursive: true })
const catalogPath = join(output,'catalog.json')
await writeFile(catalogPath, JSON.stringify(selected,null,2))
const name = platform === 'darwin' ? 'macos_coreml_all_models_and_cpu_fallback' : 'windows_directml_all_models_and_cpu_fallback'
console.log(`Testing ${selected.length}/${catalog.length} ONNX files; report: ${join(output,'report.json')}`)
// Match cargo and rustc from the same rustup toolchain, including Homebrew hosts.
const toolchainCargo = spawnSync('rustup',['which','cargo'],{ encoding:'utf8' })
const toolchainRustc = spawnSync('rustup',['which','rustc'],{ encoding:'utf8' })
const cargo = toolchainCargo.status === 0 ? toolchainCargo.stdout.trim() : 'cargo'
const environment = {
  ...process.env, ...(toolchainRustc.status === 0 ? { RUSTC:toolchainRustc.stdout.trim() } : {}),
  ...(runtime ? { LUNA_ONNX_TEST_RUNTIME:resolve(runtime) } : {}),
  LUNA_ONNX_TEST_CATALOG:catalogPath, LUNA_ONNX_TEST_OUTPUT:output,
}
if (!runtime && platform === 'darwin' && process.arch === 'x64') {
  environment.ORT_LIB_LOCATION = await ensureMacX64OnnxRuntime({ rootDir:root, nativeDir:join(output,'runtime') })
  environment.ORT_PREFER_DYNAMIC_LINK = '1'
}
const cargoArgs = [
  'test','--release','--manifest-path',join(root,'scripts','onnx-provider-probe','Cargo.toml'),
  ...(runtime ? [] : ['--no-default-features','--features','linked-runtime']),
  '--test','platform_models',
]
// Build only the test harness first. Stage runtime dependencies before it runs,
// including on Windows machines without Developer Mode (ORT copy fallback).
const prepared = spawnSync(cargo,[...cargoArgs,'--no-run','--message-format=json'],{
  cwd:root, stdio:['ignore','pipe','inherit'],env:environment,encoding:'utf8',maxBuffer:16 * 1024 * 1024,
})
if (prepared.status !== 0) process.exit(prepared.status ?? 1)
const artifacts = prepared.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line))
const executable = artifacts.find(item => item.reason === 'compiler-artifact'
  && item.target?.name === 'platform_models' && item.executable)?.executable
if (!executable) throw new Error('Platform test executable was not produced')
const cargoTarget = environment.CARGO_TARGET_DIR
  ? resolve(root,environment.CARGO_TARGET_DIR)
  : join(root,'scripts','onnx-provider-probe','target')
const runtimeRoot = join(cargoTarget,'release')
const deps = join(runtimeRoot,'deps')
const dependencyRoot = runtime ? dirname(resolve(runtime)) : runtimeRoot
for (const file of readdirSync(dependencyRoot)) {
  if (!/^(?:onnxruntime.*|DirectML)\.dll$/i.test(file) && !/^libonnxruntime.*\.dylib$/i.test(file)) continue
  const destination = join(deps,file)
  const source = join(dependencyRoot,file)
  if (resolve(source) === resolve(destination)) continue
  // Replace old copies and symlinks so changing the selected runtime cannot
  // accidentally reuse dependencies from a previous test.
  rmSync(destination,{ force:true })
  copyFileSync(source,destination)
}
// Native compiler aborts cannot be caught by Rust. Isolate each model and write
// the aggregate report incrementally so one crash cannot hide other results.
const reports = []
for (const model of selected) {
  const modelOutput = join(output,model.id)
  await mkdir(modelOutput,{ recursive:true })
  const modelCatalog = join(modelOutput,'catalog.json')
  await writeFile(modelCatalog,JSON.stringify([model],null,2))
  const logPath = join(modelOutput,'test.log')
  const log = openSync(logPath,'w')
  console.log(`Testing ${model.id}`)
  let result
  try {
    result = spawnSync(executable,[name,'--exact','--nocapture','--test-threads=1'],{
      cwd:root, stdio:['ignore',log,log],timeout:300_000,
      env:{ ...environment,LUNA_ONNX_TEST_CATALOG:modelCatalog,LUNA_ONNX_TEST_OUTPUT:modelOutput,
        LUNA_ONNX_TEST_ALLOW_CPU_ONLY:'1' },
    })
  } finally { closeSync(log) }
  const modelReport = join(modelOutput,'report.json')
  let report = existsSync(modelReport) ? JSON.parse(await readFile(modelReport,'utf8'))[0] : { id:model.id }
  if (result.status !== 0) {
    report = { ...report,error:report.error ?? result.error?.message ?? `test process failed: exit=${result.status}, signal=${result.signal}` }
  }
  report.log = logPath
  reports.push(report)
  await writeFile(join(output,'report.json'),JSON.stringify(reports,null,2))
  console.log(`${model.id}: ${report.error ? `FAILED: ${report.error}` : report.acceleratedExecution ? 'PASS (platform EP)' : 'PASS (CPU compatibility)'}`)
}
const failures = reports.filter(report => report.error)
const accelerated = reports.filter(report => report.acceleratedExecution)
console.log(`${reports.length - failures.length}/${reports.length} passed; ${accelerated.length} used platform EP; report: ${join(output,'report.json')}`)
if (!accelerated.length) console.error('No model executed on the platform EP; CPU-only compatibility is insufficient')
process.exit(failures.length || !accelerated.length ? 1 : 0)
