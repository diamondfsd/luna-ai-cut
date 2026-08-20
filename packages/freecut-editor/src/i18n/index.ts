import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { createLogger } from '@freecut/shared/logging/logger'
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGE_CODES, resolveSupportedLanguage } from './languages'
import zh from './locales/zh.json'

const log = createLogger('i18n')

export const I18N_STORAGE_KEY = 'freecut-language'

type LocaleTree = Record<string, unknown>

const baseLocales: Record<string, LocaleTree> = {
  zh: zh as LocaleTree,
}

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

// Chinese is the only supported UI language for now, so its partials are bundled eagerly.
const zhPartialModules = import.meta.glob<{ default: LocaleTree }>('./locales/partials/zh/*.json', {
  eager: true,
})

// Build the merged Chinese tree eagerly.
const zhMerged: LocaleTree = structuredClone(baseLocales.zh ?? {})
for (const [path, mod] of Object.entries(zhPartialModules).sort(([a], [b]) => a.localeCompare(b))) {
  deepMerge(zhMerged, normalizePartialSlice(path, mod.default ?? {}))
}

// Chinese is currently the only UI resource.
const resources = Object.fromEntries(
  SUPPORTED_LANGUAGE_CODES.map((lang) => [
    lang,
    {
      translation: lang === DEFAULT_LANGUAGE ? zhMerged : structuredClone(baseLocales[lang] ?? {}),
    },
  ]),
)

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGE_CODES as string[],
    load: 'currentOnly',
    interpolation: {
      // React already escapes values to prevent XSS.
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: I18N_STORAGE_KEY,
      caches: ['localStorage'],
      convertDetectedLanguage: resolveSupportedLanguage,
    },
    returnEmptyString: false,
  })
  .catch((err) => {
    log.error('Failed to initialize i18n', err)
  })

function syncDocumentLanguage(lng: string): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = resolveSupportedLanguage(lng)
}

syncDocumentLanguage(i18n.resolvedLanguage ?? i18n.language ?? DEFAULT_LANGUAGE)
i18n.on('languageChanged', syncDocumentLanguage)

// Track which languages have had their partials fully loaded.
const loadedLanguages = new Set<string>([DEFAULT_LANGUAGE])

export async function loadLanguageResources(lang: string): Promise<void> {
  const resolved = resolveSupportedLanguage(lang)
  if (loadedLanguages.has(resolved)) return
  loadedLanguages.add(resolved)
}

export async function changeAppLanguage(lang: string): Promise<void> {
  const resolved = resolveSupportedLanguage(lang)
  await loadLanguageResources(resolved)
  await i18n.changeLanguage(resolved)
}

// Preload the user's persisted/detected language before first render.
// Errors are caught so the app still renders with English fallback.
export const i18nReady: Promise<void> = (async () => {
  const persistedLanguage =
    typeof localStorage === 'undefined' ? null : localStorage.getItem(I18N_STORAGE_KEY)
  const detectedLanguage = typeof navigator === 'undefined' ? DEFAULT_LANGUAGE : navigator.language
  const initial = resolveSupportedLanguage(
    persistedLanguage ?? detectedLanguage,
  )
  if (initial !== DEFAULT_LANGUAGE) await loadLanguageResources(initial)
})().catch((err) => {
  log.error('Failed to preload language resources', err)
})

export { i18n }
export default i18n
