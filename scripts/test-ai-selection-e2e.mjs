import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dirname, '..')
const sourceRoot = process.env.LUNA_AI_SELECTION_E2E_SOURCE || '/Users/REDACTED/wps同步文件夹/2026-媒体素材/20260621 - 珠海'
const sourceNames = [
  'IMG_20260619_161341_011.jpg',
  'IMG_20260619_161352_012.jpg',
  'IMG_20260619_161405_013.jpg',
  'IMG_20260620_165522_057.jpg',
  'VID_20260621_110118_207.mp4',
]
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function waitFor(label, check, timeout = 90_000) {
  const started = Date.now()
  let lastError
  while (Date.now() - started < timeout) {
    try { const result = await check(); if (result) return result } catch (error) { lastError = error }
    await delay(80)
  }
  throw new Error(`等待${label}超时${lastError ? `: ${lastError.message}` : ''}`)
}

async function unusedPort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  await new Promise((resolve) => server.close(resolve))
  return address.port
}

class CdpClient {
  static async connect(url) {
    const socket = await new Promise((resolve, reject) => { const candidate = new WebSocket(url); candidate.onopen = () => resolve(candidate); candidate.onerror = reject })
    return new CdpClient(socket)
  }

  constructor(socket) {
    this.socket = socket
    this.nextId = 0
    this.pending = new Map()
    this.errors = []
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id); clearTimeout(pending.timer)
        if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result)
      } else if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params.exceptionDetails.text)
      else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') this.errors.push(message.params.args.map((item) => item.value ?? item.description ?? '').join(' '))
    }
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP ${method} 超时`)) }, 30_000)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
    return response.result.value
  }
}

async function main() {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'luna-ai-selection-e2e-'))
  const userData = path.join(temporaryRoot, 'user-data')
  const fixture = path.join(temporaryRoot, 'fixture')
  const port = await unusedPort()
  const rendererPort = await unusedPort()
  let appProcess
  let client
  let succeeded = false
  try {
    await Promise.all([mkdir(userData, { recursive: true }), mkdir(fixture, { recursive: true })])
    await Promise.all(sourceNames.map((name) => copyFile(path.join(sourceRoot, name), path.join(fixture, name))))
    await writeFile(path.join(userData, 'settings.json'), `${JSON.stringify({ downloadDir: path.join(temporaryRoot, 'downloads'), localResourcesDir: fixture, exportDir: path.join(temporaryRoot, 'exports') })}\n`)
    appProcess = spawn('pnpm', ['exec', 'vite', '--mode', 'e2e', '--port', String(rendererPort), '--strictPort'], { cwd: projectRoot, env: { ...process.env, LUNA_E2E_CDP_PORT: String(port), LUNA_E2E_USER_DATA_DIR: userData }, detached: true, stdio: 'ignore' })
    const target = await waitFor('Electron 页面', async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`).catch(() => null)
      if (!response?.ok) return null
      return (await response.json()).find((entry) => entry.type === 'page' && entry.url.startsWith('http'))
    }, 45_000)
    client = await CdpClient.connect(target.webSocketDebuggerUrl)
    await Promise.all([client.send('Runtime.enable'), client.send('Page.enable')])
    await client.send('Page.navigate', { url: `${target.url.split('#')[0]}#/ai-selection` })
    await waitFor('AI 选片页面', async () => {
      const page = await client.evaluate(`({ url: location.href, ready: Boolean(document.querySelector('.ai-selection-page')), text: document.body?.innerText.slice(0, 500) })`)
      if (page.ready && page.text.includes('AI 选片任务')) return true
      throw new Error(JSON.stringify(page))
    }, 15_000)

    const sessionId = await client.evaluate(`window.luna.aiSelection.start(${JSON.stringify({ name: '真实素材自动化选片', source: { kind: 'directory', directory: fixture, label: '真实素材测试' }, preset: 'balanced' })}).then((session) => session.id)`)
    const session = await waitFor('快速选片完成', async () => {
      const value = await client.evaluate(`window.luna.aiSelection.getSession(${JSON.stringify(sessionId)})`)
      return value?.status === 'ready' ? value : null
    })
    assert.equal(session.items.length, 5)
    assert.equal(session.items.filter((item) => item.kind === 'video').length, 1)
    assert.ok(session.groups.length >= 1, '连续实拍照片应形成可比较组')
    assert.ok(session.items.some((item) => item.state === 'recommended'), '新任务应默认给出推荐结果')

    await waitFor('选片任务卡片', async () => {
      const opened = await client.evaluate(`(() => { const card = Array.from(document.querySelectorAll('.ai-selection-task-open')).find((item) => item.textContent?.includes('真实素材自动化选片')); if (!card) return false; card.click(); return true })()`)
      return opened || null
    })

    const bodyText = await waitFor('选片结果界面', async () => {
      const text = await client.evaluate('document.body.innerText')
      return text.includes('分析概览') ? text : null
    })
    for (const label of ['分析概览', '场景确认', '精准比较', '全局复核', '选片设置', '创建工作台项目']) assert.ok(bodyText.includes(label), `页面应显示“${label}”`)
    for (const retiredLabel of ['添加素材', '自动整理', '比较确认', '接下来', '标签分组']) assert.ok(!bodyText.includes(retiredLabel), `主界面不应恢复旧流程“${retiredLabel}”`)
    for (const developerCopy of ['本地轻量模型', '关键帧', '裁剪范围', '技术指标', '后台分析']) assert.ok(!bodyText.includes(developerCopy), `页面不应显示开发说明“${developerCopy}”`)
    const hasExcellentGrade = await client.evaluate(`Array.from(document.querySelectorAll('span, strong, em')).some((item) => item.textContent?.trim() === '优秀')`)
    assert.equal(hasExcellentGrade, false, '页面不应继续输出无意义的“优秀”评级标签')

    const groupIds = session.groups[0].itemIds
    const scenicId = session.items.find((item) => item.name === 'IMG_20260620_165522_057.jpg').id
    const semanticStartedAt = Date.now()
    const contentSession = await client.evaluate(`window.luna.aiSelection.analyzeContentTags(${JSON.stringify(sessionId)}, ${JSON.stringify([...new Set([...groupIds, scenicId])])})`)
    const semanticMs = Date.now() - semanticStartedAt
    const scenic = contentSession.items.find((item) => item.id === scenicId)
    assert.ok(scenic.contentTags.some((tag) => ['建筑', '天空', '水面'].includes(tag)), '建筑风景照片应获得场景标签')
    assert.ok(!scenic.contentTags.includes('人物'), '远处非主体小人不应把建筑风景照片标成人物')
    assert.ok(contentSession.items.some((item) => groupIds.includes(item.id) && item.contentTags.includes('人物')), '人物照片应获得对象标签')
    const peopleSession = await client.evaluate(`window.luna.aiSelection.analyzePeople(${JSON.stringify(sessionId)}, ${JSON.stringify(groupIds)})`)
    assert.ok(peopleSession.items.some((item) => item.personEvidence?.faceCount > 0))
    assert.ok(peopleSession.items.some((item) => item.personEvidence?.eyeState === 'open'))

    const videoId = session.items.find((item) => item.kind === 'video').id
    const storySession = await client.evaluate(`window.luna.aiSelection.analyzeVideos(${JSON.stringify(sessionId)}, [${JSON.stringify(videoId)}])`)
    const video = storySession.items.find((item) => item.id === videoId)
    assert.equal(video.videoKeyframes.length, 5)
    assert.equal(video.videoSegments.length, 5)
    const segment = video.videoSegments.find((item) => item.status === 'usable') ?? video.videoSegments[0]
    const selectedSession = await client.evaluate(`window.luna.aiSelection.applyOperation(${JSON.stringify(sessionId)}, ${storySession.revision}, ${JSON.stringify({ type: 'set-video-segment-state', itemId: videoId, segmentId: segment.id, state: 'kept' })})`)
    const project = await client.evaluate(`window.luna.aiSelection.createWorkspaceProject(${JSON.stringify(sessionId)}, '自动化选片工程')`)
    const videoAsset = project.assets.find((item) => item.path === video.path && item.pipeline?.trim)
    assert.deepEqual(videoAsset.pipeline.trim, { startTime: segment.startTime, endTime: segment.endTime })
    assert.equal(selectedSession.items.find((item) => item.id === videoId).state, 'kept')
    assert.deepEqual(client.errors, [])
    succeeded = true
    console.log(JSON.stringify({ total: session.items.length, groups: session.groups.length, scenicTags: scenic.contentTags, semanticMs, faces: peopleSession.items.filter((item) => item.personEvidence?.faceCount > 0).length, keyframes: video.videoKeyframes.length, trim: videoAsset.pipeline.trim }))
    console.log('AI selection Electron integration passed')
  } finally {
    client?.socket.close()
    if (appProcess?.exitCode === null) {
      try { process.kill(-appProcess.pid, 'SIGINT') } catch { /* process already stopped */ }
      await delay(800)
      if (appProcess.exitCode === null) { try { process.kill(-appProcess.pid, 'SIGKILL') } catch { /* process already stopped */ } }
    }
    if (succeeded) await rm(temporaryRoot, { recursive: true, force: true })
    else console.error(`失败现场保留在 ${temporaryRoot}`)
  }
}

await main()
