import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import * as os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = await mkdtemp(path.join(os.tmpdir(), 'luna-ai-editor-project-test-'))
const aiEditorService = await import(pathToFileURL(path.resolve(import.meta.dirname, '..', 'electron/features/ai-editor/aiEditorProjectService.ts')).href)

const editorDocument = (id, name) => JSON.stringify({
  version: '1',
  project: {
    id,
    name,
    mediaLibrary: { items: [] },
    timeline: { duration: 0, tracks: [] },
  },
})

try {
  const workspaceProject = {
    id: 'workspace-project-1',
    name: 'Workspace Project',
    dir: path.join(root, 'workspace-projects', 'workspace-project-1'),
    createdAt: '2026-09-09T00:00:00.000Z',
    updatedAt: '2026-09-09T00:00:00.000Z',
    assets: [],
  }
  const aiProject = await aiEditorService.createAiEditorProject(root, 'Editor Project', [])
  const workspacePath = workspaceProject.dir
  const aiEditorPath = path.join(root, 'ai-editor-projects', aiProject.id)

  assert.notEqual(workspacePath, aiEditorPath, '两类项目必须使用不同目录')
  assert.equal(aiProject.dir, aiEditorPath, 'AI 剪辑项目应记录自己的目录')
  await fs.mkdir(workspacePath, { recursive: true })
  await fs.writeFile(path.join(workspacePath, 'project.json'), JSON.stringify(workspaceProject))
  await fs.access(path.join(workspacePath, 'project.json'))
  await fs.access(path.join(aiEditorPath, 'project.json'))

  assert.deepEqual((await aiEditorService.listAiEditorProjects(root)).map((project) => project.id), [aiProject.id], 'AI 剪辑列表不应包含工作台项目')

  const savedDocument = editorDocument(aiProject.id, aiProject.name)
  await aiEditorService.saveAiEditorProject(root, aiProject.id, savedDocument)
  const loaded = await aiEditorService.loadAiEditorProject(root, aiProject.id)
  assert.equal(loaded.projectId, aiProject.id)
  assert.equal(loaded.editorDocument, `${savedDocument}\n`)
  await fs.access(path.join(aiEditorPath, 'editor', 'openreel.json'))
  await assert.rejects(
    () => fs.access(path.join(workspacePath, 'editor', 'openreel.json')),
    'AI 剪辑文档不应写入工作台目录',
  )

  await aiEditorService.deleteAiEditorProject(root, aiProject.id)
  await assert.rejects(() => fs.access(aiEditorPath), '删除 AI 剪辑项目后目录应消失')
  await fs.access(path.join(workspacePath, 'project.json'))
  assert.deepEqual(await aiEditorService.listAiEditorProjects(root), [], '删除后刷新列表不应恢复项目')

  const legacyId = 'legacy-openreel-project'
  const legacyPath = path.join(root, 'workspace-projects', legacyId)
  await fs.mkdir(path.join(legacyPath, 'editor'), { recursive: true })
  await fs.writeFile(path.join(legacyPath, 'project.json'), JSON.stringify({
    id: legacyId,
    name: 'Legacy OpenReel',
    dir: legacyPath,
    createdAt: '2026-09-09T00:00:00.000Z',
    updatedAt: '2026-09-09T00:00:00.000Z',
    assets: [],
  }))
  await fs.writeFile(path.join(legacyPath, 'editor', 'openreel.json'), editorDocument(legacyId, 'Legacy OpenReel'))

  const migrated = await aiEditorService.listAiEditorProjects(root)
  const migratedProject = migrated.find((project) => project.id === legacyId)
  assert.ok(migratedProject, '旧 OpenReel 项目应被识别并迁移')
  await fs.access(path.join(root, 'ai-editor-projects', legacyId, 'editor', 'openreel.json'))
  await assert.rejects(() => fs.access(legacyPath), '迁移后旧工作台目录不应保留 OpenReel 项目')
  assert.equal(migratedProject.dir, path.join(root, 'ai-editor-projects', legacyId))
  assert.equal(await fs.readFile(path.join(workspacePath, 'project.json'), 'utf8'), JSON.stringify(workspaceProject), '迁移 OpenReel 项目不应影响工作台项目')

  await aiEditorService.deleteAiEditorProject(root, legacyId)
  await fs.access(path.join(workspacePath, 'project.json'))
  console.log('ai editor project storage tests passed')
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
