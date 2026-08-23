import process from 'node:process'

import type { Page } from '@playwright/test'
import { expect, test } from './fixtures/lunaElectron'

const projectId = process.env.LUNA_E2E_PROJECT_ID ?? 'TnPSuAWd'
const sourceUserDataDir = process.env.LUNA_E2E_SOURCE_USER_DATA_DIR

test.skip(
  !sourceUserDataDir,
  '需要设置 LUNA_E2E_SOURCE_USER_DATA_DIR 才会复制真实项目进行预览回归',
)

test.use({
  lunaElectronOptions: {
    launchEnv: {},
    seedProject: {
      sourceUserDataDir: sourceUserDataDir!,
      projectId,
    },
  },
})

test.setTimeout(60_000)

async function readDiagnostics(page: Page) {
  return page.evaluate(async () => {
    const debug = (window as unknown as {
      __DEBUG__?: { getPlaybackState?: () => Promise<unknown> }
    }).__DEBUG__
    const titleSelector =
      '[data-dom-text-scrub-overlay] [data-sequence-from="0"][data-sequence-duration="150"]'
    const title = document.querySelector<HTMLElement>(titleSelector)
    const ancestorVisibility: string[] = []
    let current = title
    while (current) {
      ancestorVisibility.push(getComputedStyle(current).visibility)
      current = current.parentElement
    }
    const overlay = document.querySelector<HTMLElement>('[data-dom-text-scrub-overlay]')
    const players = [...document.querySelectorAll<HTMLElement>('[data-player-container]')].map(
      (element) => ({
        inTextOverlay: Boolean(element.closest('[data-dom-text-scrub-overlay]')),
        currentFrame: element.dataset.playerCurrentFrame ?? null,
        titleVisible: Boolean(
          element.querySelector('[data-sequence-from="0"][data-sequence-duration="150"]'),
        ),
      }),
    )
    return {
      playback: await debug?.getPlaybackState?.(),
      playhead: document
        .querySelector<HTMLElement>('[data-timeline-playhead="ruler"]')
        ?.getBoundingClientRect().x ?? null,
      players,
      primaryFrame:
        players.find((player) => !player.inTextOverlay && player.currentFrame !== null)
          ?.currentFrame ?? null,
      overlay: overlay
        ? {
            visibility: getComputedStyle(overlay).visibility,
            titleVisibility: title ? getComputedStyle(title).visibility : null,
            ancestorVisibility,
          }
        : null,
    }
  })
}

test('从第 0 帧拖动越过字幕结束后，DOM 字幕不会继续显示', async ({ lunaApp }, testInfo) => {
  const { page, runtimeErrors } = lunaApp
  page.on('console', (message) => {
    if (message.text().includes('[timeline-playhead]')) console.log(`APP ${message.text()}`)
  })

  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  const projectCard = page.locator(`[data-project-card][data-project-id="${projectId}"]`)
  await expect(projectCard).toBeVisible()
  await projectCard.dblclick()

  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()
  const monitor = page.getByLabel('Program monitor')
  await expect(monitor).toBeVisible()

  const overlay = page.locator('[data-dom-text-scrub-overlay]')
  const firstTitle = overlay.locator('[data-sequence-from="0"][data-sequence-duration="150"]')

  await monitor.getByRole('button', { name: '跳到开始' }).click()
  await expect(firstTitle).toHaveCount(1)
  await expect(firstTitle).toHaveCSS('visibility', 'visible')
  await page.waitForTimeout(250)
  await page.evaluate(() => {
    const eventLog: string[] = []
    ;(window as typeof window & { __DOM_TEXT_BOUNDARY_EVENTS?: string[] }).__DOM_TEXT_BOUNDARY_EVENTS =
      eventLog
    window.addEventListener('blur', () => eventLog.push('window:blur'))
    document.addEventListener(
      'mouseup',
      (event) => eventLog.push(`document:mouseup:${event.clientX}`),
      true,
    )
    document.addEventListener(
      'mousemove',
      (event) => eventLog.push(`document:mousemove:${event.clientX}`),
      true,
    )
  })

  const handle = page.locator('[data-timeline-playhead="ruler"] [data-playhead-handle]')
  const ruler = page.locator('.timeline-ruler').first()
  await expect(handle).toBeVisible()
  const handleBox = await handle.boundingBox()
  const rulerBox = await ruler.boundingBox()
  expect(handleBox).not.toBeNull()
  expect(rulerBox).not.toBeNull()

  const startX = handleBox!.x + handleBox!.width / 2
  const y = handleBox!.y + handleBox!.height / 2
  const targetX = Math.min(rulerBox!.x + 80, rulerBox!.x + rulerBox!.width - 12)
  await page.mouse.move(startX, y)
  await page.mouse.down()
  await page.waitForTimeout(100)
  await page.mouse.move(startX + (targetX - startX) * 0.4, y, { steps: 5 })
  await page.mouse.move(targetX, y, { steps: 10 })
  const duringDrag = await readDiagnostics(page)
  await page.mouse.up()
  const immediatelyAfterRelease = await readDiagnostics(page)
  console.log(
    `DOM_TEXT_BOUNDARY_DRAG ${JSON.stringify({ duringDrag, immediatelyAfterRelease })}`,
  )
  console.log(
    `DOM_TEXT_BOUNDARY_EVENTS ${JSON.stringify(await page.evaluate(() => (window as typeof window & { __DOM_TEXT_BOUNDARY_EVENTS?: string[] }).__DOM_TEXT_BOUNDARY_EVENTS))}`,
  )

  await expect.poll(async () => {
    const diagnostics = await readDiagnostics(page)
    const frame = Number(diagnostics.primaryFrame)
    return Number.isFinite(frame) ? frame : -1
  }).toBeGreaterThan(150)

  await expect.poll(async () => {
    const diagnostics = await readDiagnostics(page)
    return diagnostics.overlay?.titleVisibility === 'visible'
  }).toBe(false)

  const settled = await readDiagnostics(page)
  const diagnostics = { duringDrag, immediatelyAfterRelease, settled }
  await testInfo.attach('dom-text-boundary-diagnostics.json', {
    body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
    contentType: 'application/json',
  })

  const outputPath = testInfo.outputPath('dom-text-after-boundary.png')
  await monitor.screenshot({ path: outputPath })
  await testInfo.attach('dom-text-after-boundary.png', {
    path: outputPath,
    contentType: 'image/png',
  })
  expect(runtimeErrors.filter((error) => !error.includes('[WaveformOPFS]'))).toEqual([])
})
