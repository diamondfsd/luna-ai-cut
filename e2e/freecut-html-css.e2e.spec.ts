import { createServer, type Server } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from '@playwright/test'

import { expect, test } from './fixtures/lunaElectron'
import { sendTextCompletion, sendToolCallCompletion } from './support/chatCompletionsStream'

const USER_MESSAGE = '创建一个三秒的 HTML/CSS 动画信息卡，放到当前时间线开头。'
const ITEM_LABEL = 'HTML CSS E2E 卡片'
const SAFE_HTML = `
<main id="html-e2e-card">
  <strong>HTML/CSS Preview</strong>
  <span id="html-e2e-script-status">SAFE</span>
  <span id="html-e2e-animated-dot" aria-hidden="true"></span>
</main>`
const INITIAL_CSS = `
#html-e2e-card {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  display: grid;
  place-content: center;
  gap: 20px;
  color: rgb(255, 255, 255);
  background: rgb(18, 52, 86);
}
#html-e2e-animated-dot {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgb(255, 214, 10);
  animation: html-e2e-slide 2s linear infinite;
}
@keyframes html-e2e-slide {
  from { transform: translateX(0); }
  to { transform: translateX(240px); }
}`
const UPDATED_CSS = INITIAL_CSS.replace(
  'background: rgb(18, 52, 86);',
  'background: rgb(12, 140, 96);',
)
const MALICIOUS_HTML = `${SAFE_HTML}
<script>
  document.documentElement.dataset.htmlE2eScriptExecuted = 'true';
  document.getElementById('html-e2e-script-status').textContent = 'EXECUTED';
</script>`

interface ChatRequest {
  tools?: Array<{
    type?: unknown
    function?: { name?: unknown; description?: unknown; parameters?: unknown }
  }>
  messages?: Array<{ role?: unknown; content?: unknown }>
}

async function readRequestBody(request: AsyncIterable<Uint8Array>): Promise<ChatRequest> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as ChatRequest
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

async function startHtmlEditingMock(): Promise<{
  baseUrl: string
  requests: ChatRequest[]
  close: () => Promise<void>
}> {
  const requests: ChatRequest[] = []
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }

    const payload = await readRequestBody(request)
    requests.push(payload)
    if (requests.length === 1) {
      const editProgramTool = payload.tools?.find((tool) =>
        tool.type === 'function'
        && tool.function?.name === 'fc_workspace_apply_edit_program',
      )
      if (typeof editProgramTool?.function?.name !== 'string') {
        response.writeHead(400).end(JSON.stringify({
          error: { message: 'Expected the edit program tool with HTML support.' },
        }))
        return
      }
      sendToolCallCompletion(response, {
        id: 'call_insert_html_e2e',
        name: editProgramTool.function.name,
        arguments: JSON.stringify({
          program: {
            version: 1,
            baseRevision: 0,
            intent: '创建 HTML/CSS 动画信息卡',
            operations: [{
              type: 'insertHtml',
              html: {
                ref: 'html-e2e-card',
                label: ITEM_LABEL,
                html: SAFE_HTML,
                css: INITIAL_CSS,
                start: 0,
                duration: 3,
                renderMode: 'animated',
                viewport: { width: 640, height: 360, deviceScaleFactor: 1 },
              },
            }],
          },
        }),
      })
      return
    }

    sendTextCompletion(response, 'HTML/CSS 动画信息卡已经添加到时间线。')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    await closeServer(server)
    throw new Error('无法启动 HTML/CSS 剪辑助手测试服务。')
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () => closeServer(server),
  }
}

async function ensureAssistantReady(page: Page) {
  const input = page.getByPlaceholder('描述想要完成的剪辑')
  if (!(await input.isVisible())) {
    const openButton = page.getByRole('button', { name: '打开剪辑助手' })
    if (await openButton.isVisible()) await openButton.click()
  }
  await expect(input).toBeEnabled()
  return input
}

async function findProjectFile(userDataDir: string): Promise<string> {
  const projectsRoot = path.join(userDataDir, 'freecut-workspace', 'projects')
  const entries = await readdir(projectsRoot, { withFileTypes: true })
  const project = entries.find((entry) => entry.isDirectory())
  if (!project) throw new Error('HTML/CSS E2E 项目目录尚未创建。')
  return path.join(projectsRoot, project.name, 'project.json')
}

test('剪辑助手创建的 HTML/CSS 可预览、编辑、动画并安全导出', async ({ lunaApp }) => {
  test.setTimeout(180_000)
  const { page, runtimeErrors, userDataDir } = lunaApp
  const mock = await startHtmlEditingMock()

  try {
    await page.getByRole('link', { name: '剪辑', exact: true }).click()
    await page.evaluate((baseUrl) => window.luna.aiEditingAssistant.saveConfig({
      baseUrl,
      model: 'freecut-html-e2e',
      apiKey: 'e2e-placeholder-key',
    }), mock.baseUrl)
    await page.getByRole('link', { name: /^(创建第一个项目|新建项目)$/ }).click()
    await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()

    const input = await ensureAssistantReady(page)
    await input.fill(USER_MESSAGE)
    await page.getByRole('button', { name: '发送剪辑请求' }).click()

    const timelineItem = page.locator('[data-timeline-item]').filter({ hasText: ITEM_LABEL })
    await expect(timelineItem).toHaveCount(1)
    await expect(page.getByText('HTML/CSS 动画信息卡已经添加到时间线。', { exact: true })).toBeVisible()
    expect(mock.requests).toHaveLength(2)
    const editProgramSchema = JSON.stringify(
      mock.requests[0]?.tools?.find(
        (tool) => tool.function?.name === 'fc_workspace_apply_edit_program',
      )?.function?.parameters,
    )
    expect(editProgramSchema).toContain('insertHtml')

    const previewFrame = page.frameLocator('[data-html-item] iframe')
    await expect(page.locator('[data-html-item] iframe')).toBeVisible()
    await expect(previewFrame.locator('#html-e2e-card')).toBeVisible()
    await expect(previewFrame.locator('#html-e2e-script-status')).toHaveText('SAFE')

    await page
      .getByRole('complementary', { name: '剪辑助手' })
      .getByRole('button', { name: '关闭剪辑助手' })
      .click()
    await timelineItem.click()
    const advancedEditor = page.getByRole('button', { name: '高级编辑（HTML/CSS）' })
    await expect(advancedEditor).toHaveAttribute('aria-expanded', 'false')
    const visualTextEditor = page.getByRole('textbox', { name: '文字', exact: true })
    await visualTextEditor.fill('可视化编辑标题')
    await visualTextEditor.press('Tab')
    await expect(previewFrame.locator('strong')).toHaveText('可视化编辑标题')
    const fontSizeInput = page.locator('.html-visual-controls input[inputmode="decimal"]')
    await fontSizeInput.fill('64')
    await fontSizeInput.press('Enter')
    await expect.poll(() => previewFrame.locator('strong').evaluate(
      (element) => getComputedStyle(element).fontSize,
    )).toBe('64px')

    await advancedEditor.click()
    await page.getByRole('tab', { name: 'CSS', exact: true }).click()
    const cssEditor = page.getByRole('textbox', { name: 'CSS 源码' })
    await expect(cssEditor).toHaveValue(INITIAL_CSS)
    await cssEditor.fill(UPDATED_CSS)
    await cssEditor.press('ControlOrMeta+Enter')
    await expect.poll(() => previewFrame.locator('#html-e2e-card').evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    )).toBe('rgb(12, 140, 96)')

    const animatedDot = previewFrame.locator('#html-e2e-animated-dot')
    const animationTime = () => animatedDot.evaluate((element) => {
      const currentTime = element.getAnimations()[0]?.currentTime
      return typeof currentTime === 'number' ? currentTime : Number(currentTime ?? 0)
    })
    const startTime = await animationTime()
    await page.getByRole('button', { name: '播放', exact: true }).click()
    await expect.poll(animationTime).toBeGreaterThan(startTime + 120)
    await page.getByRole('button', { name: '暂停', exact: true }).click()
    const pausedTime = await animationTime()
    await page.waitForTimeout(250)
    expect(Math.abs((await animationTime()) - pausedTime)).toBeLessThan(50)

    await page.getByRole('tab', { name: 'HTML', exact: true }).click()
    const htmlEditor = page.getByRole('textbox', { name: 'HTML 源码' })
    await htmlEditor.fill(MALICIOUS_HTML)
    await htmlEditor.press('ControlOrMeta+Enter')
    await expect(previewFrame.locator('#html-e2e-script-status')).toHaveText('SAFE')
    await expect.poll(() => previewFrame.locator('html').getAttribute(
      'data-html-e2e-script-executed',
    )).toBeNull()

    const projectFile = await findProjectFile(userDataDir)
    const itemId = await timelineItem.getAttribute('data-item-id')
    expect(itemId).toBeTruthy()
    await expect.poll(async () => {
      const project = JSON.parse(await readFile(projectFile, 'utf8')) as {
        timeline?: { items?: Array<{
          id?: string
          type?: string
          css?: string
          sourceRevision?: number
        }> }
      }
      return project.timeline?.items?.find((item) => item.id === itemId)
    }).toMatchObject({
      type: 'html',
      css: UPDATED_CSS,
      sourceRevision: 5,
    })

    await page.getByRole('button', { name: '导出', exact: true }).click()
    await page.getByRole('menuitem', { name: '导出视频', exact: true }).click()
    const exportDialog = page.getByRole('dialog', { name: '导出' })
    await expect(exportDialog.getByText('主线程回退', { exact: true })).toBeVisible()
    await exportDialog.getByRole('button', { name: '关闭', exact: true }).click()

    const renderFrame = (timeMs: number) => page.evaluate(async ({ html, css, timeMs }) => {
      const result = await window.lunaHtmlRenderer.render({
        html,
        css,
        width: 640,
        height: 360,
        timeMs,
      })
      const bitmap = await createImageBitmap(new Blob([result.png], { type: 'image/png' }))
      const canvas = new OffscreenCanvas(result.width, result.height)
      const context = canvas.getContext('2d')!
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
      const pixels = context.getImageData(0, 0, result.width, result.height).data
      let nonTransparentPixels = 0
      let checksum = 0
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 3] !== 0) nonTransparentPixels += 1
        const pixelWeight = ((index / 4) % 65_521) + 1
        checksum = (checksum + pixelWeight * (pixels[index]! * 3 + pixels[index + 1]! * 5
          + pixels[index + 2]! * 7 + pixels[index + 3]! * 11)) >>> 0
      }
      return { byteLength: result.png.byteLength, nonTransparentPixels, checksum }
    }, { html: MALICIOUS_HTML, css: UPDATED_CSS, timeMs })
    const firstFrame = await renderFrame(0)
    const animatedFrame = await renderFrame(1_000)
    expect(firstFrame.byteLength).toBeGreaterThan(1_000)
    expect(firstFrame.nonTransparentPixels).toBeGreaterThan(10_000)
    expect(animatedFrame.checksum).not.toBe(firstFrame.checksum)

    const unexpectedErrors = runtimeErrors.filter((message) =>
      !/Content Security Policy|Refused to execute inline script|Blocked script execution/i.test(message),
    )
    expect(unexpectedErrors).toEqual([])
  } finally {
    await mock.close()
  }
})
