import type { AppSettings } from '../shared/types'

export type TransferKind = 'download' | 'export'

function configuredDirectory(kind: TransferKind, settings: AppSettings): string | null {
  if (kind === 'download') return settings.localResourcesDir || `${settings.baseDir}/localResources`
  return settings.exportDir || null
}

export async function resolveTransferDirectory(kind: TransferKind, settings: AppSettings): Promise<string | null> {
  const fallback = configuredDirectory(kind, settings)
  if (!settings.chooseTransferDirectoryBeforeAction) return fallback
  return window.luna.chooseTransferDirectory(kind, fallback || undefined)
}

export async function rememberTransferDirectory(
  kind: TransferKind,
  directory: string,
  settings: AppSettings,
): Promise<void> {
  const target = directory.trim()
  if (!target) return
  const settingKey = kind === 'download' ? 'downloadDirectories' : 'exportDirectories'
  const directories = settings[settingKey] ?? []
  if (directories.includes(target)) return
  await window.luna.saveSettings({ [settingKey]: [...directories, target] } as Partial<AppSettings>)
}
