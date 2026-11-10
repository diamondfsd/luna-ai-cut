import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Module } from 'node:module'
import ts from 'typescript'

const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'luna-export-task-recovery-'))
const servicePath = path.resolve('electron/export/exportTaskService.ts')

function loadService() {
  const source = fs.readFileSync(servicePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const filename = path.join(root, `service-${Math.random().toString(36).slice(2)}.cjs`)
  const serviceModule = new Module(filename)
  serviceModule.filename = filename
  serviceModule.paths = Module._nodeModulePaths(root)
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === '../storage/settingsService' && parent?.filename === filename) {
      return { currentBaseDir: () => root }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    serviceModule._compile(compiled, filename)
    return serviceModule.exports
  } finally {
    Module._load = originalLoad
  }
}

try {
  await fsp.mkdir(path.join(root, 'cache'), { recursive: true })
  await fsp.writeFile(path.join(root, 'cache', 'export-tasks.json'), JSON.stringify({
    version: 1,
    tasks: [{
      id: 'legacy', name: '旧任务', totalCount: 1, status: 'exporting', progress: 37,
      startTime: 1, endTime: null, duration: null,
      items: [{
        id: 'legacy-item', fileName: 'legacy.mp4', kind: 'video', status: 'exporting', progress: 37,
        startTime: 1, endTime: null, duration: null,
      }],
    }],
  }))
  await fsp.writeFile(path.join(root, 'cache', 'export-tasks.json.tmp'), '{partial')

  const firstService = loadService()
  firstService.loadTasks()
  assert.equal(fs.existsSync(path.join(root, 'cache', 'export-tasks.json.tmp')), false, '启动时应清理未完成的任务记录写入')
  const legacyTask = (await firstService.getTask('legacy'))
  assert.equal(legacyTask.status, 'interrupted', '旧的进行中任务应在启动后标为中断')
  assert.equal(legacyTask.items[0].status, 'interrupted')
  assert.equal(legacyTask.items[0].progress, 0)
  assert.equal(legacyTask.resumable, false, '没有执行快照的旧任务不可恢复')

  const payload = {
    version: 1,
    kind: 'local-media',
    exportDir: root,
    taskName: '恢复测试',
    entries: [
      { id: 'done-item', sourcePath: '/source/done.png', outputPath: '/output/done.jpg', index: 0, kind: 'image', layers: [{ filePath: '/source/done.png', opacity: 1 }] },
      { id: 'pending-item', sourcePath: '/source/pending.mp4', outputPath: '/output/pending.mp4', index: 1, kind: 'video', layers: [{ filePath: '/source/pending.mp4', isVideo: true, opacity: 1 }] },
    ],
    exportConfig: { resolution: '1080p', quality: 'high', includeAudio: true },
    appleLivePhoto: false,
  }
  await firstService.createTask('恢复测试', [
    { id: 'done-item', sourcePath: '/source/done.png', outputPath: '/output/done.jpg' },
    { id: 'pending-item', sourcePath: '/source/pending.mp4', outputPath: '/output/pending.mp4' },
  ], 'recoverable', payload)
  await firstService.beginResumeTask('recoverable')
  assert.equal(await firstService.beginResumeTask('recoverable'), undefined, '同一任务不能被重复领取')
  await firstService.updateItem('recoverable', 'done-item', { status: 'done', progress: 100 })
  await firstService.updateItem('recoverable', 'pending-item', { status: 'exporting', progress: 43 })

  const restartedService = loadService()
  restartedService.loadTasks()
  const restartedTask = await restartedService.getTask('recoverable')
  assert.equal(restartedTask.status, 'interrupted')
  assert.equal(restartedTask.resumable, true)
  assert.equal(restartedTask.items.find((item) => item.id === 'done-item').status, 'done', '完成项应保留')
  assert.equal(restartedTask.items.find((item) => item.id === 'pending-item').status, 'interrupted')
  assert.equal(restartedTask.items.find((item) => item.id === 'pending-item').progress, 0)

  const resumed = await restartedService.beginResumeTask('recoverable')
  assert.equal(resumed.payload.kind, 'local-media')
  assert.deepEqual(resumed.payload, payload, '冻结的图层与导出选项应保存在任务快照中')
  assert.equal(resumed.task.items.find((item) => item.id === 'done-item').status, 'done')
  assert.equal(resumed.task.items.find((item) => item.id === 'pending-item').status, 'queued')
  await restartedService.updateItem('recoverable', 'pending-item', { status: 'failed', error: '模拟失败' })

  const retried = await restartedService.beginResumeTask('recoverable')
  assert.equal(retried.task.items.find((item) => item.id === 'done-item').status, 'done')
  assert.equal(retried.task.items.find((item) => item.id === 'pending-item').status, 'queued')
  await restartedService.updateItem('recoverable', 'pending-item', { status: 'done', progress: 100 })
  assert.equal((await restartedService.getTask('recoverable')).status, 'completed')
  assert.equal(fs.existsSync(path.join(root, 'cache', 'export-task-payloads', 'recoverable.json')), false, '完成任务后应清除快照')

  await restartedService.createTask('待清理', [{ id: 'cleanup', sourcePath: '/source/a.png', outputPath: '/output/a.jpg' }], 'cleanup', payload)
  await restartedService.clearTasks()
  assert.equal(fs.readdirSync(path.join(root, 'cache', 'export-task-payloads')).length, 0, '清除历史时应清除快照')
  console.log('export task recovery tests passed')
} finally {
  await fsp.rm(root, { recursive: true, force: true })
}
