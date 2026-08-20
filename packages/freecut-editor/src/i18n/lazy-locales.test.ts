// @vitest-environment node

/**
 * Tests for the single Chinese UI locale.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { i18n, changeAppLanguage, loadLanguageResources } from './index'

// A key that lives only in partials (not in the base locale file), so it
// exercises the partial-merge path for Chinese.
const PARTIAL_ONLY_KEY = 'editor.tts.kokoroOption'
const ZH_VALUE = 'Kokoro (英语, WebGPU)'

describe('Chinese locale loading', () => {
  beforeEach(async () => {
    // Reset to Chinese so each test starts from a known state.
    await i18n.changeLanguage('zh')
  })

  it('Chinese is available synchronously after module import', () => {
    expect(i18n.t(PARTIAL_ONLY_KEY)).toBe(ZH_VALUE)
  })

  it('unsupported languages resolve to Chinese', async () => {
    await changeAppLanguage('en')
    expect(i18n.language).toBe('zh')
    expect(i18n.t(PARTIAL_ONLY_KEY)).toBe(ZH_VALUE)
  })

  it('unknown language resources resolve without loading another locale', async () => {
    await expect(loadLanguageResources('fr')).resolves.toBeUndefined()
    expect(i18n.t(PARTIAL_ONLY_KEY)).toBe(ZH_VALUE)
  })

  it('changeAppLanguage is idempotent for Chinese', async () => {
    await changeAppLanguage('zh')
    await changeAppLanguage('zh')
    expect(i18n.language).toBe('zh')
    expect(i18n.t(PARTIAL_ONLY_KEY)).toBe(ZH_VALUE)
  })
})
