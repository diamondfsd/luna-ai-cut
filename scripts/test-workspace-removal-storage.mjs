import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import ts from 'typescript'

const root = path.resolve(import.meta.dirname, '..')
const compiled = await mkdtemp(path.join(tmpdir(), 'luna-workspace-removal-test-'))
const temporary = await mkdtemp(path.join(tmpdir(), 'luna-workspace-removal-data-'))
try {
  const sources = [path.join(root, 'electron', 'workspaceProjectService.ts'), path.join(root, 'electron', 'resumableDownloadService.ts')]
  const program = ts.createProgram(sources, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    rootDir: root,
    outDir: compiled,
    esModuleInterop: true,
    skipLibCheck: true,
  })
  const diagnostics = ts.getPreEmitDiagnostics(program)
  assert.equal(diagnostics.length, 0, ts.formatDiagnostics(diagnostics, { getCanonicalFileName: String, getCurrentDirectory: () => root, getNewLine: () => '\n' }))
  assert.equal(program.emit().emitSkipped, false)
  await writeFile(path.join(compiled, 'package.json'), '{"type":"commonjs"}\n')
  const service = createRequire(import.meta.url)(path.join(compiled, 'electron', 'workspaceProjectService.js'))
  const project = await service.createWorkspaceProject(temporary, '消除存储测试', [{ id: 'asset', name: 'source.png', path: '/tmp/source.png', kind: 'image' }])
  const directory = path.join(temporary, 'workspace-projects', project.id, 'removal')
  await mkdir(directory, { recursive: true })
  const resultPath = path.join(directory, 'result.png')
  const maskPath = path.join(directory, 'result.mask')
  const result = Buffer.from('valid-result')
  const mask = Buffer.from([0, 255, 255, 0])
  await Promise.all([writeFile(resultPath, result), writeFile(maskPath, mask)])
  const withRemoval = {
    ...project,
    assets: [{
      ...project.assets[0],
      removal: { schemaVersion: 1, operations: [{
        id: 'operation', enabled: true, maskPath, maskWidth: 2, maskHeight: 2, resultPath,
        inputRevision: '/tmp/source.png', edgeExpansion: 4, feather: 2,
        model: { id: 'big-lama-fp32', version: 'carve-c3c0c9e', sha256: 'a'.repeat(64) },
        createdAt: '2026-07-29T00:00:00.000Z',
      }] },
    }],
  }
  await service.saveWorkspaceProject(temporary, withRemoval)
  let loaded = (await service.listWorkspaceProjects(temporary))[0]
  let operation = loaded.assets[0].removal.operations[0]
  assert.equal(operation.status, 'ready')
  assert.equal(operation.resultSha256, createHash('sha256').update(result).digest('hex'))
  assert.equal(operation.maskSha256, createHash('sha256').update(mask).digest('hex'))
  await service.saveWorkspaceProject(temporary, loaded)

  await writeFile(resultPath, 'corrupt')
  loaded = (await service.listWorkspaceProjects(temporary))[0]
  operation = loaded.assets[0].removal.operations[0]
  assert.equal(operation.status, 'needs-regeneration')
  assert.match(operation.failureReason, /大小异常|校验失败/)

  await service.saveWorkspaceProject(temporary, { ...loaded, assets: [{ ...loaded.assets[0], removal: { schemaVersion: 1, operations: [] } }] })
  assert.equal(await stat(resultPath).catch(() => null), null)
  assert.equal(await stat(maskPath).catch(() => null), null)
  JSON.parse(await readFile(path.join(temporary, 'workspace-projects', project.id, 'project.json'), 'utf8'))
  console.log('workspace removal storage tests passed')
} finally {
  await Promise.all([rm(compiled, { recursive: true, force: true }), rm(temporary, { recursive: true, force: true })])
}
