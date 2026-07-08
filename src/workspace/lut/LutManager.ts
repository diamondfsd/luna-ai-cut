/**
 * LutManager — LUT 发现/扫描
 *
 * 只负责发现和列出可用 LUT（内置 + 外部目录），
 * 不再管理 GPU 加载，由 Rust 直接读取文件路径。
 */
import { getBuiltinLuts, type LutFileInfo } from './builtinLuts'

class LutManagerClass {
  private allLutsCache: LutFileInfo[] | null = null

  /** 发现所有可用 LUT（内置 + 外部目录 LUT） */
  async discoverLuts(externalDir?: string | null): Promise<LutFileInfo[]> {
    if (this.allLutsCache && externalDir === undefined) {
      return this.allLutsCache
    }
    const builtins = await getBuiltinLuts()
    const externals: LutFileInfo[] = []

    if (externalDir) {
      try {
        const lrc = getLrc()
        if (lrc) {
          const entries = await lrc.listCubeFiles(externalDir)
          for (const entry of entries) {
            const cat = entry.relDir ? entry.relDir.replace(/\\/g, '/') : '未分类'
            externals.push({
              id: `external:${cat}/${entry.name}`,
              name: entry.name,
              category: cat,
              filePath: entry.path,
            })
          }
        }
      } catch (error) {
        console.warn('[LutManager] 扫描 LUT 目录失败:', error)
      }
    }

    this.allLutsCache = [...builtins, ...externals]
    return this.allLutsCache
  }

  /** 清除缓存（目录变更后调用） */
  clearCache(): void {
    this.allLutsCache = null
  }
}

type LunaRenderCore = {
  listCubeFiles: (dir: string) => Promise<Array<{ path: string; name: string; relDir: string }>>
}

function getLrc(): LunaRenderCore | null {
  return (window as unknown as { lunaRenderCore?: LunaRenderCore }).lunaRenderCore ?? null
}

export const lutManager = new LutManagerClass()
