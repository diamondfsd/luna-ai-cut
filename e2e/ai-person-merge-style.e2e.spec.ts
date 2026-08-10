import { expect, test } from './fixtures/lunaElectron'

test('人物合并卡片媒体使用统一方形样式', async ({ lunaApp }) => {
  await lunaApp.page.evaluate(() => { window.location.hash = '/ai-selection' })
  await lunaApp.page.waitForTimeout(100)

  const styles = await lunaApp.page.evaluate(() => {
    const host = document.createElement('div')
    host.innerHTML = `
      <div class="merge-dialog-card-media">
        <span class="ai-selection-face-group-cover"><img alt="" /></span>
      </div>
    `
    document.body.appendChild(host)
    const media = host.querySelector('.merge-dialog-card-media') as HTMLElement
    const cover = host.querySelector('.ai-selection-face-group-cover') as HTMLElement
    const image = host.querySelector('img') as HTMLElement
    const getStyle = (element: HTMLElement) => {
      const style = getComputedStyle(element)
      return { width: style.width, height: style.height, borderRadius: style.borderRadius }
    }
    const result = { media: getStyle(media), cover: getStyle(cover), imageBorderRadius: getComputedStyle(image).borderRadius }
    host.remove()
    return result
  })

  expect(styles).toEqual({
    media: { width: '120px', height: '120px', borderRadius: '5px' },
    cover: { width: '120px', height: '120px', borderRadius: '5px' },
    imageBorderRadius: '5px',
  })
  expect(lunaApp.runtimeErrors).toEqual([])
})
