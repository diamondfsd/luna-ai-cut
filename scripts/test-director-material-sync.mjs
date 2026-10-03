import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')
const root = await mkdtemp(path.join(tmpdir(), 'luna-material-sync-'))
const directory = path.join(root, 'plan')
const handlers = new Map()
const bytes = Buffer.from('simulated phone video bytes')
let uploadStatus = 201
const uploads = []
let remoteShots = []
const progressEvents = []
const event = { sender: { isDestroyed: () => false, send: (channel, progress) => {
  assert.equal(channel, 'director-lab:material-sync-progress')
  progressEvents.push(progress)
} } }
const server = createServer(async (request, response) => {
  if (request.method === 'POST') {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    uploads.push({ url: request.url, headers: request.headers, bytes: Buffer.concat(chunks) })
    response.writeHead(uploadStatus).end()
  } else if (request.url === '/media/phone-video') {
    response.writeHead(200, { 'Content-Length': String(bytes.length) })
    response.end(bytes)
  } else {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ id: 'plan-1', shots: remoteShots }))
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const endpoint = `http://127.0.0.1:${server.address().port}`
globalThis.__directorMaterialTest = {
  ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
  dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [path.join(root, 'video.mp4')] }) },
  settings: { directorPlanDir: root },
  client: {
    connect: async () => {},
    authorizationHeadersFor: async () => ({ Authorization: 'Bearer simulation' }),
    request: async (base, route) => {
      const response = await fetch(new URL(route, base))
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json()
    },
  },
}
try {
  const output = path.join(root, 'harness.mjs')
  await build({
    stdin: {
      contents: "export { registerDirectorLocalImport } from './electron/features/director-lab/directorLabLocalImport.ts'; export { writeDirectorPlanFiles } from './electron/features/director-lab/directorLabPlanStorage.ts';",
      resolveDir: process.cwd(), loader: 'ts',
    },
    outfile: output, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    plugins: [{ name: 'isolated-director-services', setup(builder) {
      const mocks = {
        electron: 'export const {ipcMain,dialog}=globalThis.__directorMaterialTest',
        fileService: 'export const getSettings=async()=>globalThis.__directorMaterialTest.settings; export const getDirectorPlanDir=s=>s.directorPlanDir',
        lunaka_http_client: 'export const lunaKaHttpClient=globalThis.__directorMaterialTest.client',
        directorLabPlanDeletion: 'export const reconcileDirectorPlanDeletions=async()=>{}',
      }
      builder.onResolve({ filter: /^(electron)$|\/(fileService|lunaka_http_client|directorLabPlanDeletion)$/ }, args => {
        const name = args.path.split('/').at(-1)
        return { path: name, namespace: 'mock' }
      })
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js' }))
    } }],
  })
  const service = await import(pathToFileURL(output).href)
  const plan = { id: 'plan-1', title: '模拟计划', created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(), attributes: [], pending_take_ids: [],
    shots: [{ id: 'shot-1', order: 1, name: '镜头', attributes: [], remark: '', duration_ms: 5000, takes: [] }] }
  await service.writeDirectorPlanFiles(directory, plan)
  await writeFile(path.join(root, 'video.mp4'), bytes)
  const listPlans = async () => {
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'))
    return [{ ...plan, ...manifest, id: manifest.plan_id, local_directory: directory,
      shots: manifest.shots.map(shot => ({ ...shot, takes: shot.media.map(take => ({ ...take,
        kind: take.type, stream_url: take.path ? pathToFileURL(path.join(directory, take.path)).href : null })) })) }]
  }
  service.registerDirectorLocalImport(listPlans)
  const imported = await handlers.get('director-lab:import-materials')(null, plan, 'shot-1')
  assert.equal(imported.pending_take_ids.length, 1)
  const sync = () => handlers.get('director-lab:sync-materials')(event, endpoint, plan.id, 'simulation')
  uploadStatus = 404
  await assert.rejects(sync(), /素材上传失败 HTTP 404/)
  assert.equal(progressEvents.at(-1).status, 'failed')
  assert.equal(progressEvents.some(item => item.status === 'done'), false, '手机拒绝时不能显示已完成')
  assert.equal((await listPlans())[0].pending_take_ids.length, 1, '失败后必须保留上传队列')
  uploadStatus = 201
  await Promise.all([sync(), sync()])
  assert.equal(uploads.length, 2, '并发重试只能上传一次')
  assert.deepEqual(uploads[1].bytes, bytes)
  assert.equal(uploads[1].headers.authorization, 'Bearer simulation')
  assert.equal(Number(uploads[1].headers['content-length']), bytes.length)
  assert.match(uploads[1].url, /\/plans\/plan-1\/shots\/shot-1\/media\/take-/)
  assert.equal((await listPlans())[0].pending_take_ids.length, 0, '成功后必须持久化清除上传队列')
  assert.equal(progressEvents.at(-1).status, 'done')
  assert.equal(progressEvents.at(-1).transferred, bytes.length)
  assert.equal(progressEvents.at(-1).total, bytes.length)
  assert.equal(progressEvents.at(-1).operationId, 'simulation')
  await sync()
  assert.equal(uploads.length, 2, '已上传素材不应重复上传')
  remoteShots = [{ id: 'shot-1', takes: [{ id: 'phone-take', file_name: 'phone-video.mp4', available: true,
    kind: 'video', size_bytes: bytes.length, download_path: '/media/phone-video', selected_range: null }] }]
  await sync()
  const downloadEvents = progressEvents.filter(item => item.takeId === 'phone-take')
  assert.equal(downloadEvents[0].status, 'pending')
  assert.equal(downloadEvents[1].status, 'transferring')
  assert.equal(downloadEvents.at(-1).status, 'done')
  assert.equal(downloadEvents.at(-1).direction, 'download')
  assert.equal(downloadEvents.at(-1).transferred, bytes.length)
  const downloadedTake = (await listPlans())[0].shots[0].takes.find(take => take.id === 'phone-take')
  assert.deepEqual(await readFile(new URL(downloadedTake.stream_url)), bytes)
  const eventCount = progressEvents.length
  await sync()
  assert.equal(progressEvents.length, eventCount, '无待同步文件时不应制造进度任务')
  console.log('PASS: 双向真实 HTTP 传输与进度、失败保留队列、恢复重试、并发去重、成功持久化')

  let cleanup
  let effectTask
  let syncCalls = 0
  let refreshCalls = 0
  let rejectUpload = false
  let poll
  let progressListener
  let hookProgress = []
  let lastOperationId
  const notifications = []
  const logs = []
  const originalWindow = globalThis.window
  globalThis.__directorHookTest = {
    useEffect: callback => { effectTask = callback },
    useRef: value => ({ current: value }),
    useState: () => [hookProgress, update => { hookProgress = typeof update === 'function' ? update(hookProgress) : update }],
    toast: { error: message => notifications.push(message) },
  }
  globalThis.window = {
    luna: { log: (...args) => logs.push(args), directorLab: {
      listLocalPlans: listPlans,
      onMaterialSyncProgress: callback => { progressListener = callback; return () => { progressListener = null } },
      syncMaterials: async (_endpoint, _planId, operationId) => {
        lastOperationId = operationId
        progressListener?.({ endpoint, planId: plan.id, operationId, takeId: 'test-take', direction: 'upload', status: 'transferring', transferred: 5, total: 10 })
        syncCalls += 1
        if (rejectUpload) throw new Error('素材上传失败 HTTP 404')
      },
    } },
    setInterval: callback => { poll = callback; return 1 }, clearInterval: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
  }
  try {
    const hookSource = await readFile(new URL('../src/hooks/useDirectorMaterialSync.ts', import.meta.url), 'utf8')
    const compiled = ts.transpileModule(hookSource.replace(
      "import { useEffect, useRef, useState } from 'react'",
      'const {useEffect,useRef,useState}=globalThis.__directorHookTest',
    ).replace("import { toast } from '../ui/toast'", 'const {toast}=globalThis.__directorHookTest'),
    { compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 } }).outputText
    const { useDirectorMaterialSync } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
    async function runHook(active, enabled, connectedEndpoint, expectedRefreshes) {
      cleanup?.()
      syncCalls = 0
      refreshCalls = 0
      useDirectorMaterialSync(active, enabled, connectedEndpoint, () => { refreshCalls += 1 })
      cleanup = effectTask()
      for (let attempt = 0; attempt < 100 && refreshCalls < expectedRefreshes; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      assert.equal(refreshCalls, expectedRefreshes)
    }
    await runHook(false, true, endpoint, 0)
    assert.equal(syncCalls, 0)
    await runHook(true, false, endpoint, 1)
    assert.equal(syncCalls, 0)
    await runHook(true, true, null, 1)
    assert.equal(syncCalls, 0)
    await runHook(true, true, endpoint, 2)
    assert.equal(syncCalls, 1, '开启后应立即触发上传，不必等待下一次轮询')
    assert.equal(hookProgress[0].transferred, 5)
    progressListener({ ...hookProgress[0], operationId: 'stale', transferred: 9 })
    assert.equal(hookProgress[0].transferred, 5, '过期任务不得覆盖当前进度')
    progressListener({ ...hookProgress[0], endpoint: 'http://other-phone', operationId: lastOperationId, transferred: 9 })
    assert.equal(hookProgress[0].transferred, 5, '其他手机不得覆盖当前进度')
    rejectUpload = true
    await runHook(true, true, endpoint, 2)
    assert.equal(syncCalls, 1)
    assert.deepEqual(notifications, ['素材同步失败'])
    assert.match(logs[0][2].error, /HTTP 404/)
    async function pollOnce() {
      const expected = refreshCalls + 2
      poll()
      for (let attempt = 0; attempt < 100 && refreshCalls < expected; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      assert.equal(refreshCalls, expected)
    }
    await pollOnce()
    assert.equal(notifications.length, 1, '持续失败不应重复弹出提醒')
    rejectUpload = false
    await pollOnce()
    rejectUpload = true
    await pollOnce()
    assert.equal(notifications.length, 2, '恢复后再次失败应重新提醒')
    cleanup?.()
    let rejectPending
    let markStarted
    const started = new Promise(resolve => { markStarted = resolve })
    const pending = new Promise((_resolve, reject) => { rejectPending = reject })
    globalThis.window.luna.directorLab.syncMaterials = () => { markStarted(); return pending }
    useDirectorMaterialSync(true, true, endpoint, () => {})
    cleanup = effectTask()
    await started
    cleanup()
    rejectPending(new Error('Disconnected'))
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(notifications.length, 2, '离开页面后过期失败不应弹出提醒')
    console.log('PASS: 同步触发条件、失败提醒与日志、轮询提醒去重、恢复后再次失败提醒')
  } finally {
    cleanup?.()
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
    delete globalThis.__directorHookTest
  }
} finally {
  delete globalThis.__directorMaterialTest
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await rm(root, { recursive: true, force: true })
}
