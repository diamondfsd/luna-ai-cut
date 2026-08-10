import { expect, test } from './fixtures/lunaElectronLive'

const projectId = process.env.LUNA_E2E_PROJECT_ID ?? 'Dag9toSB'
const outgoingText = '我给女儿做了个AI小伙伴'
const incomingText = '她说想要彩虹色的字母'

interface VisibleSequenceSnapshot {
  from: number
  duration: number
  text: string
  inTextOverlay: boolean
  visible: boolean
  painted: boolean
  overlayVisibility: string | null
}

async function readSequenceSnapshot(
  monitor: import('@playwright/test').Locator,
): Promise<VisibleSequenceSnapshot[]> {
  return monitor.locator('[data-sequence-from]').evaluateAll((elements) =>
    elements
      .map((element) => {
        const html = element as HTMLElement
        const text = html.innerText.replace(/\s+/g, '')
        return {
          from: Number(html.dataset.sequenceFrom),
          duration: Number(html.dataset.sequenceDuration),
          text,
          inTextOverlay: Boolean(html.closest('[data-dom-text-scrub-overlay]')),
          visible: getComputedStyle(html).visibility !== 'hidden',
          painted: html.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
          overlayVisibility: html.closest<HTMLElement>('[data-dom-text-scrub-overlay]')
            ? getComputedStyle(html.closest<HTMLElement>('[data-dom-text-scrub-overlay]')!).visibility
            : null,
        }
      })
      .filter((entry) => entry.text.length > 0),
  )
}

test.skip(process.env.LUNA_E2E_LIVE !== '1', '需要显式设置 LUNA_E2E_LIVE=1 才会读取现有项目')

test('播放跨越相邻文字边界时不保留上一段', async ({ lunaLiveApp }, testInfo) => {
  const { page, runtimeErrors } = lunaLiveApp
  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  const projectCard = page.locator(`[data-project-card][data-project-id="${projectId}"]`)
  await expect(projectCard).toBeVisible()
  await projectCard.dblclick()
  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()

  const monitor = page.getByLabel('Program monitor')
  await expect(monitor).toBeVisible()
  await page.getByRole('button', { name: '跳到开始' }).click()
  await page.getByRole('button', { name: '播放', exact: true }).click()
  await page.waitForTimeout(3_600)

  const playbackSnapshot = await readSequenceSnapshot(monitor)
  const outputPath = testInfo.outputPath('during-playback-boundary.png')
  await monitor.screenshot({ path: outputPath })
  await testInfo.attach('during-playback-boundary.png', {
    path: outputPath,
    contentType: 'image/png',
  })
  await testInfo.attach('visible-sequences.json', {
    body: Buffer.from(JSON.stringify(playbackSnapshot, null, 2)),
    contentType: 'application/json',
  })
  await page.getByRole('button', { name: '暂停', exact: true }).click()

  const visibleMainText = playbackSnapshot.filter(
    (entry) => !entry.inTextOverlay && entry.painted,
  ).map((entry) => entry.text)
  expect(visibleMainText.some((text) => text.includes(incomingText))).toBe(true)
  expect(visibleMainText.some((text) => text.includes(outgoingText))).toBe(false)
  expect(playbackSnapshot.filter((entry) => entry.inTextOverlay && entry.painted)).toEqual([])
  expect(runtimeErrors.filter((error) => !error.includes('[WaveformOPFS]'))).toEqual([])
})
