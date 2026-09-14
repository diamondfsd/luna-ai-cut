import { expect, test } from './fixtures/lunaElectron'
import { spawn } from 'node:child_process'
import { access, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import path from 'node:path'

test('AI 剪辑导航打开 OpenReel 编辑器', async ({ lunaApp }) => {
  await lunaApp.page.getByRole('link', { name: 'AI 剪辑' }).click()

  const editorFrame = lunaApp.page.locator('iframe[title="AI 剪辑"]')
  const editor = editorFrame.contentFrame()
  await expect(editorFrame).toBeVisible()
  await expect(editor.locator('#root')).not.toBeEmpty({ timeout: 30_000 })
  await editor.getByRole('textbox', { name: '剪辑目标' }).fill('生成一个 30 秒旅行短片')
  await editor.getByRole('button', { name: '生成剪辑提示词' }).click()
  await expect(editor.getByText('剪辑提示词已生成', { exact: true })).toBeVisible()
  await editor.getByRole('button', { name: '复制提示词' }).click()
  const copiedPrompt = await lunaApp.page.evaluate(() => navigator.clipboard.readText())
  expect(copiedPrompt).toContain('/skill.md')
  expect(copiedPrompt).toContain('/api/tools/')
  expect(copiedPrompt).not.toContain('Authorization: Bearer')

  expect(lunaApp.runtimeErrors).toEqual([])
})

test('AI 剪辑通过本机 MCP 返回工具并执行操作', async ({ lunaApp }) => {
  const sourcePath = path.resolve(import.meta.dirname, '../build/icon.png')
  await lunaApp.page.evaluate((source) => {
    history.pushState({ usr: { media: [{ path: source, name: 'icon.png', kind: 'image' }] }, key: 'mcp-test' }, '', '#/ai-editor')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, sourcePath)

  const editorFrame = lunaApp.page.locator('iframe[title="AI 剪辑"]')
  const editor = editorFrame.contentFrame()
  await expect(editor.locator('#root')).not.toBeEmpty({ timeout: 30_000 })
  await expect(editor.getByText('icon.png', { exact: true })).toBeVisible({ timeout: 30_000 })

  const endpointPath = path.join(lunaApp.temporaryRoot, 'user-data', '.luna-ai-cut', 'mcp-endpoint.json')
  const endpoint = JSON.parse(await readFile(endpointPath, 'utf8')) as { url: string; token?: unknown }
  const client = spawn(process.execPath, [path.resolve(import.meta.dirname, '../scripts/luna-mcp.mjs')], {
    env: { ...process.env, LUNA_MCP_ENDPOINT: endpointPath },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const output = createInterface({ input: client.stdout, crlfDelay: Infinity })
  const outputIterator = output[Symbol.asyncIterator]()
  const nextResponse = async () => JSON.parse((await outputIterator.next()).value as string) as {
    result?: { tools?: Array<{ name?: string }>; content?: Array<{ type?: string; text?: string }> }
  }

  try {
    client.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`)
    expect((await nextResponse()).result).toBeTruthy()
    client.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`)
    const tools = (await nextResponse()).result?.tools ?? []
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['rename_project', 'add_track', 'create_text_clip']))

    client.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'start_edit_session',
        arguments: {
          request: '将当前项目改名为 MCP 测试项目',
          agentId: 'e2e-rename',
          agentType: 'Playwright E2E agent',
          agentModel: 'e2e-model',
        },
      },
    })}\n`)
    const started = await nextResponse()
    expect(started.result?.content?.[0]?.text ? JSON.parse(started.result.content[0].text) : null)
      .toMatchObject({ ok: true, data: { state: 'claimed' } })

    client.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'rename_project', arguments: { name: 'MCP 测试项目' } },
    })}\n`)
    const renameResult = (await nextResponse()).result?.content?.[0]?.text
    expect(renameResult ? JSON.parse(renameResult) : null).toMatchObject({ ok: true })
  } finally {
    client.stdin.end()
    client.kill()
    output.close()
  }

  expect(endpoint.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/rpc$/)
  expect(endpoint.token).toBeUndefined()
  expect(lunaApp.runtimeErrors).toEqual([])
})

test('AI 剪辑通过本机 MCP 查询并导入最近本地素材', async ({ lunaApp }) => {
  const localResourcesDir = path.join(lunaApp.temporaryRoot, 'downloads', 'localResources')
  await mkdir(localResourcesDir, { recursive: true })
  await copyFile(
    path.resolve(import.meta.dirname, '../build/icon.png'),
    path.join(localResourcesDir, 'IMG_20260830_202400_001.png'),
  )

  await lunaApp.page.getByRole('link', { name: 'AI 剪辑' }).click()
  const editorFrame = lunaApp.page.locator('iframe[title="AI 剪辑"]')
  await expect(editorFrame.contentFrame().locator('#root')).not.toBeEmpty({ timeout: 30_000 })

  const endpointPath = path.join(lunaApp.temporaryRoot, 'user-data', '.luna-ai-cut', 'mcp-endpoint.json')
  const client = spawn(process.execPath, [path.resolve(import.meta.dirname, '../scripts/luna-mcp.mjs')], {
    env: { ...process.env, LUNA_MCP_ENDPOINT: endpointPath },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const output = createInterface({ input: client.stdout, crlfDelay: Infinity })
  const outputIterator = output[Symbol.asyncIterator]()
  const nextResponse = async () => JSON.parse((await outputIterator.next()).value as string) as {
    result?: {
      tools?: Array<{ name?: string }>
      content?: Array<{ type?: string; text?: string }>
    }
  }
  const call = async (id: number, name: string, arguments_: Record<string, unknown>) => {
    client.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: arguments_ },
    })}\n`)
    return nextResponse()
  }

  try {
    client.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`)
    await nextResponse()
    client.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`)
    const tools = (await nextResponse()).result?.tools ?? []
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['list_local_media', 'import_local_media']))

    const started = await call(3, 'start_edit_session', {
      request: '从最近本地素材创建一个测试项目并导入素材',
      agentId: 'e2e-local-media',
      agentType: 'Playwright E2E agent',
      agentModel: 'e2e-model',
    })
    expect(started.result?.content?.[0]?.text ? JSON.parse(started.result.content[0].text) : null)
      .toMatchObject({ ok: true, data: { state: 'claimed' } })

    const skill = await call(4, 'get_editing_skill', {})
    expect(skill.result?.content?.[0]?.text ? JSON.parse(skill.result.content[0].text) : null).toMatchObject({ ok: true })

    const created = await call(5, 'create_project', { name: '本地素材查询测试项目' })
    expect(created.result?.content?.[0]?.text ? JSON.parse(created.result.content[0].text) : null).toMatchObject({ ok: true })

    const listed = await call(6, 'list_local_media', { limit: 10 })
    const listedResult = listed.result?.content?.[0]?.text ? JSON.parse(listed.result.content[0].text) : null
    expect(listedResult).toMatchObject({ ok: true, data: { value: [{ name: 'IMG_20260830_202400_001.png', groupDay: '2026-08-30' }] } })

    const mediaId = listedResult.data.value[0].mediaId as string
    const contactSheet = await call(7, 'create_media_contact_sheet', { mediaIds: [mediaId], columns: 1 })
    expect(contactSheet.result?.content?.some((item) => item.type === 'image')).toBe(true)
    const contactSheetResult = contactSheet.result?.content?.[0]?.text ? JSON.parse(contactSheet.result.content[0].text) : null
    expect(contactSheetResult).toMatchObject({
      ok: true,
      data: {
        contactSheet: { columns: 1, rows: 1, labeled: true },
        items: [{ frames: [{
          frameId: `${mediaId}#0`,
          label: '#01',
          timecode: '00:00.0',
          cell: { sheetIndex: 0 },
        }] }],
      },
    })
    expect(contactSheet.result?.content?.[1]?.text).toContain(`#01 | IMG_20260830_202400_001.png | PHOTO`)

    const imported = await call(8, 'import_local_media', { mediaIds: [mediaId] })
    expect(imported.result?.content?.[0]?.text ? JSON.parse(imported.result.content[0].text) : null).toMatchObject({ ok: true })

    const media = await call(9, 'list_media', {})
    expect(media.result?.content?.[0]?.text ? JSON.parse(media.result.content[0].text) : null).toMatchObject({
      ok: true,
      data: { value: [{ name: 'IMG_20260830_202400_001.png', type: 'image' }] },
    })
  } finally {
    client.stdin.end()
    client.kill()
    output.close()
  }

  expect(lunaApp.runtimeErrors).toEqual([])
})

if (process.env.LUNA_EXTERNAL_AGENT_TEST === '1') {
  test('AI 剪辑支持外部 MCP 子 Agent 实际修改并保存项目', async ({ lunaApp }) => {
    const handshakePath = process.env.LUNA_EXTERNAL_AGENT_HANDSHAKE
    if (!handshakePath) throw new Error('缺少 LUNA_EXTERNAL_AGENT_HANDSHAKE')

    const sourcePath = path.resolve(import.meta.dirname, '../build/icon.png')
    await lunaApp.page.evaluate((source) => {
      history.pushState({ usr: { media: [{ path: source, name: 'icon.png', kind: 'image' }] }, key: 'external-agent-test' }, '', '#/ai-editor')
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, sourcePath)

    const editorFrame = lunaApp.page.locator('iframe[title="AI 剪辑"]')
    const editor = editorFrame.contentFrame()
    await expect(editor.locator('#root')).not.toBeEmpty({ timeout: 30_000 })
    await expect(editor.getByRole('button', { name: 'AI 剪辑项目' })).toBeVisible({ timeout: 30_000 })

    await editor.getByRole('textbox', { name: '剪辑目标' }).fill('将当前项目改名并保存')
    await editor.getByRole('button', { name: '生成剪辑提示词' }).click()
    await expect(editor.getByText('剪辑提示词已生成', { exact: true })).toBeVisible()
    await editor.getByRole('button', { name: '复制提示词' }).click()
    const prompt = await lunaApp.page.evaluate(() => navigator.clipboard.readText())
    const endpointPath = path.join(lunaApp.temporaryRoot, 'user-data', '.luna-ai-cut', 'mcp-endpoint.json')
    const markerPath = path.join(lunaApp.temporaryRoot, 'external-agent-done')
    await writeFile(handshakePath, `${JSON.stringify({ endpointPath, markerPath, prompt })}\n`, 'utf8')

    await expect.poll(async () => {
      try {
        return await readFile(markerPath, 'utf8')
      } catch {
        return ''
      }
    }, { timeout: 300_000, intervals: [250, 1_000] }).toBe('done\n')

    await expect(editor.getByRole('textbox', { name: '项目名称' })).toHaveValue('外部子 Agent 测试项目')
    expect(lunaApp.runtimeErrors).toEqual([])
  })
}

test('AI 剪辑通过 Luna 文件桥接保存项目并写出导出文件', async ({ lunaApp }) => {
  await lunaApp.page.getByRole('link', { name: 'AI 剪辑' }).click()
  const editorFrame = lunaApp.page.locator('iframe[title="AI 剪辑"]')
  const editor = editorFrame.contentFrame()
  await expect(editor.locator('#root')).not.toBeEmpty({ timeout: 30_000 })
  const editorPageFrame = lunaApp.page.frames().find((frame) => frame.url().includes('/ai-editor/'))
  expect(editorPageFrame).toBeDefined()

  const projectPath = path.join(lunaApp.temporaryRoot, 'project.oreel')
  const exportPath = path.join(lunaApp.temporaryRoot, 'export.mp4')
  const abortedPath = path.join(lunaApp.temporaryRoot, 'aborted.mp4')
  const bridgeResult = await editorPageFrame!.evaluate(async ({ projectPath: nextProjectPath, exportPath: nextExportPath, abortedPath: nextAbortedPath }) => {
    const bridge = (window as unknown as {
      openreel?: {
        platform?: string
        fs?: {
          writeFile(path: string, data: string): Promise<void>
          readFile(path: string): Promise<string>
          openWrite(path: string): Promise<string>
          writeChunk(handleId: string, data: Uint8Array, position: number): Promise<void>
          closeWrite(handleId: string): Promise<void>
          abortWrite(handleId: string): Promise<void>
        }
      }
    }).openreel
    if (!bridge?.fs) return { hasFs: false, platform: bridge?.platform ?? null, project: null, exportBytes: 0 }

    const project = JSON.stringify({ name: 'Luna test project', tracks: [] })
    await bridge.fs.writeFile(nextProjectPath, project)
    const openedProject = await bridge.fs.readFile(nextProjectPath)
    const handleId = await bridge.fs.openWrite(nextExportPath)
    const bytes = new TextEncoder().encode('export-test')
    await bridge.fs.writeChunk(handleId, bytes, 0)
    await bridge.fs.closeWrite(handleId)
    const abortedHandleId = await bridge.fs.openWrite(nextAbortedPath)
    await bridge.fs.writeChunk(abortedHandleId, bytes, 0)
    await bridge.fs.abortWrite(abortedHandleId)
    return {
      hasFs: true,
      platform: bridge.platform ?? null,
      project: openedProject,
      exportBytes: bytes.byteLength,
    }
  }, { projectPath, exportPath, abortedPath })

  expect(bridgeResult).toEqual({
    hasFs: true,
    platform: null,
    project: JSON.stringify({ name: 'Luna test project', tracks: [] }),
    exportBytes: 'export-test'.length,
  })
  await expect(readFile(projectPath, 'utf8')).resolves.toContain('Luna test project')
  await expect(readFile(exportPath, 'utf8')).resolves.toBe('export-test')
  await expect(readFile(abortedPath, 'utf8')).rejects.toThrow()
  expect(lunaApp.runtimeErrors).toEqual([])
})

test('AI 剪辑接收 Luna 本地素材并导入素材面板', async ({ lunaApp }) => {
  const sourcePath = path.resolve(import.meta.dirname, '../build/icon.png')
  await lunaApp.page.evaluate((source) => {
    history.pushState({ usr: { media: [{ path: source, name: 'icon.png', kind: 'image' }] }, key: 'test' }, '', '#/ai-editor')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, sourcePath)

  const editorFrame = lunaApp.page.locator('iframe[title="AI 剪辑"]')
  const editor = editorFrame.contentFrame()
  await expect(editorFrame).toBeVisible()
  await expect(editor.locator('input[type="file"]')).toBeAttached({ timeout: 30_000 })
  await expect(editor.getByRole('button', { name: '素材', exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(editor.getByText('icon.png', { exact: true })).toBeVisible({ timeout: 30_000 })

  const editorPageFrame = lunaApp.page.frames().find((frame) => frame.url().includes('/ai-editor/'))
  expect(editorPageFrame).toBeDefined()
  const locale = await editorPageFrame!.evaluate(() => ({
    lang: document.documentElement.lang,
    title: document.title,
    hasEnglishMediaLabel: document.body.innerText.includes('No media imported'),
  }))
  expect(locale).toEqual({
    lang: 'zh-CN',
    title: 'Luna AI 剪辑',
    hasEnglishMediaLabel: false,
  })

  expect(lunaApp.runtimeErrors).toEqual([])
})

test('AI 剪辑导入素材、调整片段并导出文件', async ({ lunaApp }) => {
  const sourcePath = path.resolve(import.meta.dirname, '../build/icon.png')
  await lunaApp.page.addInitScript(() => {
    localStorage.setItem('openreel-onboarding-complete', 'true')
  })
  await lunaApp.page.evaluate((source) => {
    history.pushState({ usr: { media: [{ path: source, name: 'icon.png', kind: 'image' }] }, key: 'export-test' }, '', '#/ai-editor')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, sourcePath)

  const editorFrame = lunaApp.page.locator('iframe[title="AI 剪辑"]')
  const editor = editorFrame.contentFrame()
  await expect(editor.getByText('icon.png', { exact: true })).toBeVisible({ timeout: 30_000 })

  const thumbnail = editor.locator('img[alt="icon.png"]').first()
  await thumbnail.hover()
  await editor.getByRole('button', { name: '添加到时间线' }).click()

  const timelineClip = editor.getByRole('button', { name: '选择片段：icon.png' })
  await expect(timelineClip).toBeVisible({ timeout: 30_000 })
  await timelineClip.click()

  const rotateUp = editor.getByRole('button', { name: '增大旋转角度' })
  await expect(rotateUp).toBeVisible()
  await rotateUp.click()
  const rotationInput = editor.getByText('旋转', { exact: true }).locator('..').locator('input')
  await expect(rotationInput).toHaveValue('1°')

  const exportPath = path.join(lunaApp.temporaryRoot, 'export.mp4')
  await lunaApp.app.evaluate(({ dialog }, nextPath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: nextPath })
  }, exportPath)

  await editor.getByRole('button', { name: '导出', exact: true }).click()

  await expect.poll(async () => {
    try {
      return (await stat(exportPath)).size
    } catch {
      return 0
    }
  }, { timeout: 30_000 }).toBeGreaterThan(0)

  const logDir = await lunaApp.page.evaluate(() => window.luna.getLogDir())
  const logFiles = await (await import('node:fs/promises')).readdir(logDir)
  const openReelLogName = logFiles.find((name) => name.startsWith('openreel-') && name.endsWith('.log'))
  expect(openReelLogName).toBeDefined()
  const openReelLog = await readFile(path.join(logDir, openReelLogName!), 'utf8')
  expect(openReelLog).toContain('[OpenReel]')
  expect(openReelLog).toContain('导出位置已选择')
  expect(openReelLog).toContain('导出文件写入完成')
  expect(openReelLog).toContain('export.mp4')
  expect(lunaApp.runtimeErrors).toEqual([])

  await access(exportPath)
})
