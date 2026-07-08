/**
 * LutManager — LUT 发现/扫描
 *
 * 通过 IPC 扫描目录获取 .cube 文件（内置 + 外部），
 * 所有路径均为绝对路径，直接传给 Rust。
 */
import type { LutFileInfo } from './builtinLuts'

class LutManagerClass {
  private allLutsCache: LutFileInfo[] | null = null

  /** 发现所有可用 LUT（内置 + 外部目录 LUT） */
  async discoverLuts(externalDir?: string | null): Promise<LutFileInfo[]> {
    if (this.allLutsCache && externalDir === undefined) {
      return this.allLutsCache
    }
    const results: LutFileInfo[] = []

    try {
      const lrc = getLrc()
      if (lrc) {
        // listCubeFiles 内部会扫描内置 + 外部目录，外部目录为空则只返回内置
        const entries = await lrc.listCubeFiles(externalDir || '')
        console.log('[LutManager] listCubeFiles 扫描结果:', JSON.stringify(entries, null, 2))
        for (const entry of entries) {
          const cat = entry.relDir ? entry.relDir.replace(/\\/g, '/') : '未分类'
          results.push({
            id: `${cat}/${entry.name}`,
            name: entry.name,
            category: cat,
            filePath: entry.path,
          })
        }
      }
    } catch (error) {
      console.warn('[LutManager] 扫描 LUT 目录失败:', error)
    }

    this.allLutsCache = results
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
