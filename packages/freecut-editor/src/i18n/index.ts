import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { createLogger } from '@freecut/shared/logging/logger'
import zh from './locales/zh.json'

const log = createLogger('i18n')

type LocaleTree = Record<string, unknown>

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key]
    if (isPlainObject(existing) && isPlainObject(value)) {
      deepMerge(existing, value)
    } else {
      target[key] = value
    }
  }
}

function normalizePartialSlice(path: string, slice: LocaleTree): LocaleTree {
  if (path.endsWith('/effects.json') && !isPlainObject(slice.effects)) {
    return { effects: slice }
  }

  return slice
}

const zhPartialModules = import.meta.glob<{ default: LocaleTree }>('./locales/partials/zh/*.json', {
  eager: true,
})

const zhMerged: LocaleTree = structuredClone(zh as LocaleTree)
for (const [path, mod] of Object.entries(zhPartialModules).sort(([a], [b]) => a.localeCompare(b))) {
  deepMerge(zhMerged, normalizePartialSlice(path, mod.default ?? {}))
}

const resources = { zh: { translation: zhMerged } }

export const i18nReady: Promise<void> = i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'zh',
    fallbackLng: 'zh',
    supportedLngs: ['zh'],
    interpolation: {
      // React already escapes values to prevent XSS.
      escapeValue: false,
    },
    returnEmptyString: false,
  })
  .then(() => undefined)
  .catch((err) => {
    log.error('Failed to initialize i18n', err)
  })

function syncDocumentLanguage(): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = 'zh-CN'
}

syncDocumentLanguage()
i18n.on('languageChanged', syncDocumentLanguage)

export { i18n }
export default i18n
