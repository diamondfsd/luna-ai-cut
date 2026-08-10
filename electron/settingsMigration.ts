export interface BaseDirectorySettings {
  baseDir?: string
  downloadDir?: string
  [key: string]: unknown
}

export function migrateBaseDirectory<T extends BaseDirectorySettings>(saved: T, defaultBaseDir: string): Omit<T, 'downloadDir'> & { baseDir: string } {
  const { downloadDir, ...rest } = saved
  return {
    ...rest,
    baseDir: saved.baseDir || downloadDir || defaultBaseDir,
  }
}
