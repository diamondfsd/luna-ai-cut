import assert from 'node:assert/strict'
import { createRequire, Module } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import ts from 'typescript'

const root = path.resolve(import.meta.dirname, '..')
process.env.NODE_PATH = [path.join(root, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter)
Module._initPaths()
const compiled = await mkdtemp(path.join(tmpdir(), 'luna-workspace-subtitle-test-'))
const temporary = await mkdtemp(path.join(tmpdir(), 'luna-workspace-subtitle-data-'))
try {
  const sources = [
    path.join(root, 'electron', 'features', 'workspace', 'workspaceProjectService.ts'),
    path.join(root, 'electron', 'media', 'resumableDownloadService.ts'),
    path.join(root, 'src', 'shared', 'subtitleTrack.ts'),
  ]
  const program = ts.createProgram(sources, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    baseUrl: root,
    paths: { 'opencc-js/t2cn': ['node_modules/opencc-js/types/full.d.ts'] },
    rootDir: root,
    outDir: compiled,
    esModuleInterop: true,
    skipLibCheck: true,
  })
  const diagnostics = ts.getPreEmitDiagnostics(program)
  assert.equal(diagnostics.length, 0, ts.formatDiagnostics(diagnostics, { getCanonicalFileName: String, getCurrentDirectory: () => root, getNewLine: () => '\n' }))
  assert.equal(program.emit().emitSkipped, false)
  await writeFile(path.join(compiled, 'package.json'), '{"type":"commonjs"}\n')
  const service = createRequire(import.meta.url)(path.join(compiled, 'electron', 'features', 'workspace', 'workspaceProjectService.js'))
  const project = await service.createWorkspaceProject(temporary, '字幕存储测试', [{ id: 'video', name: 'source.mp4', path: '/tmp/source.mp4', kind: 'video' }])
  await service.saveWorkspaceProject(temporary, {
    ...project,
    assets: [{
      ...project.assets[0],
      subtitles: {
        schemaVersion: 1,
        enabled: true,
        language: 'zh',
        model: { id: 'model', version: '1', sha256: 'a'.repeat(64) },
        sourceRange: { startMs: 0, endMs: 5000 },
        sourceFingerprint: { size: 10, modifiedAtMs: 20 },
        generatedAt: '2026-07-30T00:00:00.000Z',
        style: {
          backgroundOpacity: 35,
          cornerRadius: 12,
          fontWeight: 700,
          fontAssets: [{ fileName: 'MyFont.ttf', filePath: '/tmp/MyFont.ttf', format: 'ttf' }],
        },
        cues: [
          { id: 'duplicate', startMs: 2000, endMs: 3000, text: '第二條', source: 'generated' },
          { id: 'duplicate', startMs: 500, endMs: 1500, text: ' 第一条 ', source: 'generated' },
          { id: 'edited', startMs: 3500, endMs: 4500, text: '手動編輯', source: 'edited' },
          { id: 'empty', startMs: 3000, endMs: 4000, text: ' ' },
        ],
      },
    }],
  })
  const loaded = (await service.listWorkspaceProjects(temporary))[0]
  assert.deepEqual(loaded.assets[0].subtitles.cues.map((cue) => cue.text), ['第一条', '第二条', '手動編輯'])
  assert.equal(new Set(loaded.assets[0].subtitles.cues.map((cue) => cue.id)).size, 3)
  assert.equal(loaded.assets[0].subtitles.style.backgroundOpacity, 35)
  assert.equal(loaded.assets[0].subtitles.style.fontFile, 'fonts/SourceHanSansSC-Regular.otf')
  assert.deepEqual(loaded.assets[0].subtitles.style.fontAssets.map((font) => font.fileName), ['MyFont.ttf'])
  console.log('workspace subtitle storage tests passed')
} finally {
  await Promise.all([rm(compiled, { recursive: true, force: true }), rm(temporary, { recursive: true, force: true })])
}
