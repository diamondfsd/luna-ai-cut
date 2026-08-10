import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { ensureFontsLoaded, loadFont } from './font-loader'

afterEach(() => {
  document.head.querySelectorAll('link[data-font]').forEach((link) => link.remove())
})

describe('font loader', () => {
  it('uses unknown font names as local fonts without requesting Google Fonts', async () => {
    const load = vi.fn().mockResolvedValue([])
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        ready: Promise.resolve(),
        check: vi.fn().mockReturnValue(true),
        load,
      },
    })

    expect(loadFont('思源黑体')).toBe('"思源黑体", sans-serif')
    await ensureFontsLoaded(['思源黑体'], [400, 700])

    expect(document.head.querySelector('link[data-font="思源黑体"]')).toBeNull()
    expect(load).toHaveBeenCalledWith('700 16px "思源黑体"', 'BESbswy')
  })
})
