import type { AppSettings } from '../shared/types'

export type TransferKind = 'download' | 'export'

export function configuredTransferDirectory(kind: TransferKind, settings: AppSettings): string | null {
  if (kind === 'download') return settings.localResourcesDir || `${settings.baseDir}/localResources`
  return settings.exportDir || null
}

function normalizedDirectory(directory: string): string {
  const normalized = directory.trim().replace(/\\/g, '/').replace(/\/+$/, '') || '/'
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized
}

export function isWithinConfiguredTransferDirectory(
  kind: TransferKind,
  directory: string,
  settings: AppSettings,
): boolean {
  const configured = configuredTransferDirectory(kind, settings)
  if (!configured) return false
  const configuredPath = normalizedDirectory(configured)
  const selectedPath = normalizedDirectory(directory)
  const childPrefix = configuredPath === '/' ? '/' : `${configuredPath}/`
  return selectedPath === configuredPath || selectedPath.startsWith(childPrefix)
}

export async function resolveTransferDirectory(kind: TransferKind, settings: AppSettings): Promise<string | null> {
  const fallback = configuredTransferDirectory(kind, settings)
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
