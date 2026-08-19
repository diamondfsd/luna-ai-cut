const LOCALE_IDS = ['zh', 'en'] as const
const PERMISSION_PRESET_IDS = ['read-only', 'workspace-write', 'danger-full-access'] as const

type LocaleId = typeof LOCALE_IDS[number]
type PermissionPresetId = typeof PERMISSION_PRESET_IDS[number]

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isLocaleId(value: unknown): value is LocaleId {
  return typeof value === 'string' && (LOCALE_IDS as readonly string[]).includes(value)
}

function isPermissionPresetId(value: unknown): value is PermissionPresetId {
  return typeof value === 'string' && (PERMISSION_PRESET_IDS as readonly string[]).includes(value)
}

/**
 * Apply defaults for the Luna Harness without overwriting choices already
 * made in the Harness settings page.
 *
 * @param settings - Parsed Harness settings document.
 * @returns A new settings document with embedded-surface defaults applied.
 */
export function withDeepSeekHarnessDefaults(settings: Record<string, unknown>): Record<string, unknown> {
  const locale = isRecord(settings.locale) ? settings.locale : {}
  const permission = isRecord(settings.permission) ? settings.permission : {}
  return {
    ...settings,
    locale: {
      ...locale,
      preference: isLocaleId(locale.preference) ? locale.preference : 'zh',
    },
    permission: {
      ...permission,
      // workspace-write is rooted at the Harness session directory by the
      // application host. It is not rooted at a FreeCut project directory.
      defaultPreset: isPermissionPresetId(permission.defaultPreset)
        ? permission.defaultPreset
        : 'workspace-write',
    },
  }
}
