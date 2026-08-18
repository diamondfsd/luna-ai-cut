/**
 * IPC 处理器 — Luna Render Core
 */
import { app, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { appendFileSync, statSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, extname, basename } from 'node:path'
import { getLogDir, logMainError, logMainInfo } from './loggerService'
import { RUNTIME_RESOURCE_DEFINITIONS } from './runtimeResourceDefinitions'
import { loadRuntimeResource } from './runtimeResourceService'
import { readWebGpuLutFile } from './webGpuLutService'

async function runtimeResourceCacheRoot(): Promise<string> {
  return join(app.getPath('userData'), 'resource-packs')
}

/** 写日志到文件（追加模式），APP_ROOT 在 appMain.ts 中设置 */
function rcLog(msg: string): void {
  const logPath = join(getLogDir(), 'luna-rc.log')
  try {
    const ts = new Date().toISOString().slice(11, 23)
    appendFileSync(logPath, `[${ts}] [main] ${msg}\n`)
  } catch { /* ignore */ }
}

/** 包装 handler：自动 catch 异常并记日志 */
function safe<T extends (...args: never[]) => unknown>(label: string, fn: T): T {
  let firstCall = true
  return (async (...args: Parameters<T>) => {
    const traceThisCall = firstCall
    firstCall = false
    if (traceThisCall) logMainInfo('[LRC] 首次调用开始', { label })
    try {
      const result = await fn(...args)
      if (traceThisCall) logMainInfo('[LRC] 首次调用完成', { label })
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      rcLog(`ERROR in ${label}: ${msg}`)
      logMainError('[LRC] 调用失败', { label, error: msg })
      throw err
    }
  }) as unknown as T
}

export function register(): void {
  ipcMain.handle('lrc:readWebGpuLut', safe('readWebGpuLut', async (_event: IpcMainInvokeEvent, filePath: string) => {
    return readWebGpuLutFile(filePath)
  }))

  ipcMain.handle('lrc:prepareRuntimeResource', safe('prepareRuntimeResource',
    async (_event: IpcMainInvokeEvent, kind: 'fonts' | 'luts') => {
      if (kind !== 'fonts' && kind !== 'luts') throw new Error('未知运行时资源类型')
      await loadRuntimeResource(await runtimeResourceCacheRoot(), RUNTIME_RESOURCE_DEFINITIONS[kind])
    },
  ))

  /** 递归扫描 .cube 文件（内置 + 外部目录），按目录名作为分类 */
  ipcMain.handle('lrc:listCubeFiles', safe('listCubeFiles',
    async (_event: IpcMainInvokeEvent, dirPath: string) => {
      const results: Array<{ path: string; name: string; relDir: string; description?: string; isBuiltin: boolean }> = []
      const seen = new Set<string>()

      // 内置 LUT 目录：遍历候选路径，取第一个存在的
      //   打包后：process.resourcesPath/luts（extraResources 复制到 resources/luts/）
      //   开发时：VITE_PUBLIC/luts 或 APP_ROOT/public/luts
      let builtinDir = [
        join(process.resourcesPath || '', 'luts'),
        join(process.env.VITE_PUBLIC || join(process.env.APP_ROOT || join(import.meta.dirname, '..'), 'public'), 'luts'),
      ].find((p) => { try { return statSync(p).isDirectory() } catch { return false } }) || ''
      if (!builtinDir) {
        builtinDir = await loadRuntimeResource(await runtimeResourceCacheRoot(), RUNTIME_RESOURCE_DEFINITIONS.luts)
      }

      async function scanDir(dir: string, baseDir: string): Promise<void> {
        let entries: string[]
        try { entries = await readdir(dir) } catch { return }
        for (const entry of entries.sort()) {
          const fullPath = join(dir, entry)
          try {
            const info = await stat(fullPath)
            if (info.isDirectory()) {
              await scanDir(fullPath, baseDir)
            } else if (info.isFile() && extname(entry).toLowerCase() === '.cube') {
              const fileBaseName = entry.replace(/\.cube$/i, '')
              // 尝试读取同名的 .meta.json，用其中的 name 字段作为显示名
              let name = fileBaseName
              let description: string | undefined
              try {
                const metaPath = join(dir, `${fileBaseName}.cube.meta.json`)
                const metaRaw = await readFile(metaPath, 'utf8')
                const meta = JSON.parse(metaRaw)
                if (meta.name) name = meta.name
                if (meta.description) description = meta.description
              } catch { /* 没有 meta 文件就用文件名 */ }
              const relDir = dir === baseDir ? '' : dir.slice(baseDir.length + 1)
              const key = `${fileBaseName}:${relDir}`
              if (seen.has(key)) continue
              seen.add(key)
              results.push({ path: fullPath, name, relDir, description, isBuiltin: dir.startsWith(builtinDir) })
            }
          } catch { /* 跳过无权限文件 */ }
        }
      }

      await scanDir(dirPath, dirPath)

      // 始终扫描内置 LUT 目录
      try {
        await stat(builtinDir)
        await scanDir(builtinDir, builtinDir)
      } catch { /* 内置 LUT 目录不存在则跳过 */ }

      return results
    },
  ))

  /** 导入 .cube 文件到 LUT 目录的指定分组 */
  ipcMain.handle('lrc:importCubeFile', safe('importCubeFile',
    async (
      _event: IpcMainInvokeEvent,
      sourcePath: string,
      categoryName: string,
      lutDir: string,
      targetName?: string,
      meta?: { name?: string; description?: string },
    ) => {
      if (!sourcePath.toLowerCase().endsWith('.cube')) {
        throw new Error('只支持 .cube 格式的 LUT 文件')
      }
      const fileName = targetName ? `${targetName}.cube` : basename(sourcePath)
      const destDir = join(lutDir, categoryName)
      await mkdir(destDir, { recursive: true })
      const destPath = join(destDir, fileName)
      await cp(sourcePath, destPath, { force: true })
      const fileBaseName = fileName.replace(/\.cube$/i, '')

      // 写入同名 .meta.json（与内置 LUT 格式一致）
      const metaObj: Record<string, unknown> = {}
      if (meta?.name) {
        metaObj.name = meta.name
      } else {
        metaObj.name = fileBaseName
      }
      if (meta?.description) metaObj.description = meta.description
      const metaPath = destPath + '.meta.json'
      await writeFile(metaPath, JSON.stringify(metaObj), 'utf-8')

      rcLog(`lrc:importCubeFile ${destPath}`)
      return { path: destPath, name: fileBaseName, relDir: categoryName }
    },
  ))

  /** 删除 .cube 文件及其同名 .meta.json（内置 LUT 不可删除） */
  ipcMain.handle('lrc:deleteCubeFile', safe('deleteCubeFile',
    async (_event: IpcMainInvokeEvent, cubePath: string, isBuiltin?: boolean) => {
      if (isBuiltin) {
        throw new Error('内置 LUT 不可删除')
      }
      const rmOpts = { force: true } as const
      await rm(cubePath, rmOpts)
      // 同时删除同名的 meta 文件（如果存在）
      const metaPath = cubePath + '.meta.json'
      await rm(metaPath, rmOpts)
      rcLog(`lrc:deleteCubeFile ${cubePath}`)
    },
  ))

}
