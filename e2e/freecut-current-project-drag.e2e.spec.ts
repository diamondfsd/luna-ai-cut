import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectron'

const projectId = process.env.LUNA_E2E_PROJECT_ID ?? 'J4ANiM2O'
const existingUserDataDir = process.env.LUNA_E2E_EXISTING_USER_DATA_DIR

test.skip(
  !existingUserDataDir,
  '需要显式设置 LUNA_E2E_EXISTING_USER_DATA_DIR 才会操作现有项目',
)

test('打开现有项目并将媒体拖入视频轨道', async ({ lunaApp }) => {
  const { page, runtimeErrors, workspaceDir } = lunaApp
  const projectFile = path.join(
    workspaceDir,
    'projects',
    projectId,
    'project.json',
  )

  const before = JSON.parse(await readFile(projectFile, 'utf8')) as {
    timeline?: { items?: Array<{ mediaId?: string; trackId?: string }> }
  }
  expect(before.timeline?.items ?? []).toHaveLength(0)

  await page.getByRole('link', { name: '剪辑', exact: true }).click()

  const projectCard = page.locator(`[data-project-card][data-project-id="${projectId}"]`)
  await expect(projectCard).toBeVisible()
  await projectCard.dblclick()

  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()
  const mediaCard = page.locator('[data-media-id]').first()
  await expect(mediaCard).toBeVisible()
  const mediaId = await mediaCard.getAttribute('data-media-id')
  expect(mediaId).toBeTruthy()

  const draggableMedia = mediaCard.locator('[draggable="true"]').first()
  await expect(draggableMedia).toBeVisible()

  const videoTrack = page.locator(
    '[data-track-section="video"] [data-timeline-drop-target="true"]',
  ).first()
  await expect(videoTrack).toBeVisible()

  await draggableMedia.dragTo(videoTrack)

  await expect(page.locator('[data-timeline-item]')).toHaveCount(1)
  await expect.poll(async () => {
    const saved = JSON.parse(await readFile(projectFile, 'utf8')) as {
      timeline?: { items?: Array<{ mediaId?: string; trackId?: string }> }
    }
    return saved.timeline?.items?.length ?? 0
  }).toBe(1)

  const saved = JSON.parse(await readFile(projectFile, 'utf8')) as {
    timeline?: { items?: Array<{ mediaId?: string; trackId?: string }> }
  }
  const item = saved.timeline?.items?.[0]
  expect(item?.mediaId).toBe(mediaId)
  expect(item?.trackId).toBeTruthy()
  expect(runtimeErrors).toEqual([])
})
