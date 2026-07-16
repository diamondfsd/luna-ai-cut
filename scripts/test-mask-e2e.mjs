import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dirname, '..')
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'luna-mask-e2e-'))
const userDataDir = path.join(temporaryRoot, 'user-data')
const downloadDir = path.join(temporaryRoot, 'downloads')
const fixtureDir = path.join(temporaryRoot, 'fixtures')
const artifactDir = path.join(temporaryRoot, 'artifacts')
const projectId = 'mask-e2e'
const projectDir = path.join(downloadDir, 'workspace-projects', projectId)
const projectPath = path.join(projectDir, 'project.json')
const appLogPath = path.join(artifactDir, 'app.log')
const keepArtifacts = process.env.LUNA_E2E_KEEP_ARTIFACTS === '1'

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function waitFor(label, check, timeout = 25_000) {
  const startedAt = Date.now()
  let lastError
  while (Date.now() - startedAt < timeout) {
    try {
      const result = await check()
      if (result) return result
    } catch (error) {
      lastError = error
    }
    await delay(50)
  }
  throw new Error(`等待${label}超时${lastError ? `: ${lastError.message}` : ''}`)
}

async function unusedPort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const port = address.port
  await new Promise((resolve) => server.close(resolve))
  return port
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: process.env,
      ...options,
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => { stdout += chunk })
    child.stderr?.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0 || options.allowFailure) {
        resolve({ code, signal, stdout, stderr })
      } else {
        reject(new Error(`${command} ${args.join(' ')} 失败 (${code ?? signal})\n${stderr || stdout}`))
      }
    })
  })
}

async function agentBrowser(port, session, ...args) {
  return run('agent-browser', ['--session', session, '--cdp', String(port), ...args])
}

class CdpClient {
  static async connect(url) {
    const socket = await new Promise((resolve, reject) => {
      const candidate = new WebSocket(url)
      candidate.onopen = () => resolve(candidate)
      candidate.onerror = reject
    })
    return new CdpClient(socket)
  }

  constructor(socket) {
    this.socket = socket
    this.nextId = 0
    this.pending = new Map()
    this.runtimeErrors = []
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(message.error.message))
        else pending.resolve(message.result)
        return
      }
      if (message.method === 'Runtime.exceptionThrown') {
        this.runtimeErrors.push(message.params.exceptionDetails.text)
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        this.runtimeErrors.push(message.params.args.map((item) => item.value ?? item.description ?? '').join(' '))
      }
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
        this.runtimeErrors.push(message.params.entry.text)
      }
    }
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text)
    return response.result.value
  }

  close() {
    this.socket.close()
  }
}

async function createFixture() {
  await Promise.all([
    mkdir(userDataDir, { recursive: true }),
    mkdir(projectDir, { recursive: true }),
    mkdir(fixtureDir, { recursive: true }),
    mkdir(artifactDir, { recursive: true }),
  ])

  const sourceImage = path.join(projectRoot, 'public', 'luna-icon.png')
  const firstImage = path.join(fixtureDir, 'asset-a.png')
  const secondImage = path.join(fixtureDir, 'asset-b.png')
  await Promise.all([copyFile(sourceImage, firstImage), copyFile(sourceImage, secondImage)])

  const width = 1254
  const height = 1254
  const maskDir = path.join(projectDir, 'masks')
  const validMask = path.join(maskDir, 'valid.pgm')
  const damagedMask = path.join(maskDir, 'damaged.pgm')
  await mkdir(maskDir, { recursive: true })
  await writeFile(validMask, Buffer.concat([
    Buffer.from(`P5\n${width} ${height}\n255\n`, 'ascii'),
    Buffer.alloc(width * height, 255),
  ]))
  await writeFile(damagedMask, Buffer.from(`P5\n${width} ${height}\n255\n${'x'.repeat(32)}`, 'ascii'))

  const layer = (id, name, maskPath) => ({
    id,
    name,
    path: maskPath,
    width,
    height,
    opacity: 0.5,
    inverted: false,
    feather: 20,
    kind: 'brush',
    enabled: true,
    blendMode: 'normal',
  })
  const now = new Date().toISOString()
  const project = {
    id: projectId,
    name: '蒙版自动化测试',
    dir: projectDir,
    createdAt: now,
    updatedAt: now,
    assets: [
      { id: 'asset-a', name: '素材 A', path: firstImage, kind: 'image', pipeline: { colorMasks: [layer('valid-layer', '合法蒙版层', validMask)] } },
      { id: 'asset-b', name: '素材 B', path: secondImage, kind: 'image', pipeline: { colorMasks: [layer('damaged-layer', '待恢复蒙版层', damagedMask)] } },
    ],
  }
  await writeFile(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf8')
  await writeFile(path.join(userDataDir, 'settings.json'), `${JSON.stringify({
    downloadDir,
    localResourcesDir: path.join(downloadDir, 'localResources'),
    exportDir: path.join(downloadDir, 'export'),
    developerMode: false,
  }, null, 2)}\n`, 'utf8')
}

function startApp(port) {
  const log = createWriteStream(appLogPath, { flags: 'a' })
  const child = spawn('pnpm', ['dev:e2e'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      LUNA_E2E_CDP_PORT: String(port),
      LUNA_E2E_USER_DATA_DIR: userDataDir,
    },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.pipe(log)
  child.stderr.pipe(log)
  child.once('exit', () => log.end())
  return child
}

async function stopApp(child) {
  if (!child || child.exitCode !== null) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  try { process.kill(-child.pid, 'SIGINT') } catch { return }
  await Promise.race([exited, delay(5_000)])
  if (child.exitCode === null) {
    try { process.kill(-child.pid, 'SIGKILL') } catch { /* already stopped */ }
    await exited
  }
}

async function connectToApp(port) {
  const target = await waitFor('Electron CDP', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`).catch(() => null)
    if (!response?.ok) return null
    const targets = await response.json()
    return targets.find((item) => item.type === 'page' && !item.url.startsWith('devtools:')) ?? null
  }, 40_000)
  const client = await CdpClient.connect(target.webSocketDebuggerUrl)
  await Promise.all([
    client.send('Runtime.enable'),
    client.send('Log.enable'),
    client.send('Page.enable'),
  ])
  return { client, target }
}

async function waitForText(client, text) {
  return waitFor(`文本“${text}”`, () => client.evaluate(`document.body?.innerText.includes(${JSON.stringify(text)})`))
}

async function clickButton(client, label, exact = true) {
  const clicked = await client.evaluate(`(() => {
    const label = ${JSON.stringify(label)};
    const button = Array.from(document.querySelectorAll('button')).find((item) => {
      const value = item.getAttribute('aria-label') || item.textContent?.trim() || '';
      return ${exact ? 'value === label' : 'value.includes(label)'};
    });
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`)
  assert.equal(clicked, true, `应能点击“${label}”`)
}

async function openFixtureProject(client, targetUrl) {
  const baseUrl = targetUrl.split('#')[0]
  await client.send('Page.navigate', { url: `${baseUrl}#/workspace` })
  await waitForText(client, '工作台项目')
  await waitForText(client, '蒙版自动化测试')
  await clickButton(client, '蒙版自动化测试')
  await waitForText(client, '返回工作台')
  await clickButton(client, '调色与蒙版')
  await waitForText(client, '蒙版图层')
}

async function openValidMaskEditor(client) {
  await clickButton(client, '编辑蒙版')
  await waitForText(client, '编辑蒙版 · 合法蒙版层')
  await waitFor('羽化滑块', () => client.evaluate(`document.querySelector('[aria-label="羽化滑块"]')?.getAttribute('aria-valuenow') === '20'`))
}

async function selectFirstMaskLayer(client) {
  const selected = await client.evaluate(`(() => {
    const button = document.querySelector('.workspace-color-mask-layer:not(.workspace-color-mask-global-layer) .workspace-color-mask-layer-select');
    if (!button) return false;
    button.click();
    return true;
  })()`)
  assert.equal(selected, true, '应能选择第一层蒙版')
}

async function typeFeather(port, session, value) {
  await agentBrowser(port, session, 'fill', '[aria-label="羽化数值"]', String(value))
  await agentBrowser(port, session, 'press', 'Enter')
}

async function assertNoRuntimeErrors(client) {
  assert.deepEqual(client.runtimeErrors, [], `Electron renderer 不应产生错误: ${client.runtimeErrors.join('\n')}`)
}

async function saveDiagnostics(port, session, suffix) {
  for (const command of ['snapshot', 'errors', 'console']) {
    const args = command === 'snapshot' ? ['snapshot', '-i'] : [command, '--json']
    const result = await agentBrowser(port, session, ...args).catch((error) => ({ stdout: '', stderr: error.message }))
    await writeFile(path.join(artifactDir, `${suffix}-${command}.txt`), result.stdout || result.stderr, 'utf8')
  }
}

async function runFirstPass(port) {
  const app = startApp(port)
  let client
  const session = `luna-mask-e2e-${process.pid}-1`
  try {
    const connection = await connectToApp(port)
    client = connection.client
    await agentBrowser(port, session, 'errors', '--clear')
    await agentBrowser(port, session, 'console', '--clear')
    await openFixtureProject(client, connection.target.url)
    await openValidMaskEditor(client)

    await typeFeather(port, session, 40)
    await waitFor('羽化值 40', () => client.evaluate(`document.querySelector('[aria-label="羽化滑块"]')?.getAttribute('aria-valuenow') === '40'`))
    assert.equal(await client.evaluate(`document.querySelector('[aria-label="撤销"]')?.disabled`), false, '修改后应可撤销')

    await clickButton(client, '撤销')
    await waitFor('一次撤销回到 20', () => client.evaluate(`document.querySelector('[aria-label="羽化滑块"]')?.getAttribute('aria-valuenow') === '20'`))

    await clickButton(client, '重做')
    await waitFor('一次重做回到 40', () => client.evaluate(`document.querySelector('[aria-label="羽化滑块"]')?.getAttribute('aria-valuenow') === '40'`))
    await client.evaluate(`document.querySelectorAll('.workspace-thumb')[1]?.click()`)
    await waitForText(client, '待恢复蒙版层')
    await selectFirstMaskLayer(client)
    await waitForText(client, '文件不可用，可重新编辑')
    assert.equal(await client.evaluate(`document.querySelector('[aria-label="撤销"]')?.disabled`), true, '损坏检测不能制造撤销记录')
    assert.equal(await client.evaluate(`document.querySelector('[aria-label="蒙版文件不可用，无法切换显示"]')?.disabled`), true, '损坏蒙版必须禁用显示切换')

    await waitFor('项目自动保存', async () => {
      const project = JSON.parse(await readFile(projectPath, 'utf8'))
      return project.assets[0].pipeline.colorMasks[0].feather === 40
        && project.assets[1].pipeline.colorMasks[0].enabled === false
        && project.assets[1].pipeline.colorMasks[0].loadError === 'missing-or-damaged'
    })
    await assertNoRuntimeErrors(client)
    await saveDiagnostics(port, session, 'first-pass')
  } finally {
    client?.close()
    await stopApp(app)
  }
}

async function runRestartPass(port) {
  const app = startApp(port)
  let client
  const session = `luna-mask-e2e-${process.pid}-2`
  try {
    const connection = await connectToApp(port)
    client = connection.client
    await openFixtureProject(client, connection.target.url)
    await clickButton(client, '编辑蒙版')
    await waitForText(client, '编辑蒙版 · 合法蒙版层')
    await waitFor('重启后羽化值 40', () => client.evaluate(`document.querySelector('[aria-label="羽化滑块"]')?.getAttribute('aria-valuenow') === '40'`))

    await client.evaluate(`document.querySelectorAll('.workspace-thumb')[1]?.click()`)
    await waitForText(client, '待恢复蒙版层')
    await selectFirstMaskLayer(client)
    await waitForText(client, '文件不可用，可重新编辑')
    assert.equal(await client.evaluate(`document.querySelector('[aria-label="蒙版文件不可用，无法切换显示"]')?.disabled`), true)
    await assertNoRuntimeErrors(client)
    await saveDiagnostics(port, session, 'restart-pass')
  } finally {
    client?.close()
    await stopApp(app)
  }
}

let succeeded = false
try {
  const browserCheck = spawnSync('agent-browser', ['--version'], { encoding: 'utf8' })
  assert.equal(browserCheck.status, 0, '需要先安装 agent-browser')
  await createFixture()
  const port = await unusedPort()
  await runFirstPass(port)
  await runRestartPass(port)
  succeeded = true
  console.log('mask Electron E2E tests passed')
} catch (error) {
  console.error(error)
  console.error(`失败证据保留在: ${artifactDir}`)
  process.exitCode = 1
} finally {
  if (succeeded && !keepArtifacts) await rm(temporaryRoot, { recursive: true, force: true })
  else console.log(`Electron E2E 临时目录: ${temporaryRoot}`)
}
