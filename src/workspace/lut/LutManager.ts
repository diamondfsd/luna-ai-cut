/**
 * LutManager — 全局 LUT 加载/缓存/生命周期管理
 *
 * 管理内置滤镜（从 public/luts/ 加载 .cube 文件），
 * 通过 IPC 加载到 Rust/wgpu 3D 纹理，缓存 GPU LUT ID。
 */
import { getBuiltinLuts, loadBuiltinLutData, type LutFileInfo } from './builtinLuts'

export interface LutEntry {
  id: string
  name: string
  category: string
  gpuId?: number
}

type LunaRenderCore = {
  loadLut: (data: Uint8Array) => Promise<number>
  releaseLut: (id: number) => Promise<void>
  listCubeFiles: (dir: string) => Promise<Array<{ path: string; name: string; relDir: string }>>
  readLutFile: (path: string) => Promise<Uint8Array>
}

function getLrc(): LunaRenderCore | null {
  return (window as unknown as { lunaRenderCore?: LunaRenderCore }).lunaRenderCore ?? null
}

class LutManagerClass {
  private loadedLuts: Map<string, LutEntry> = new Map()
  private activeId: string | null = null
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

  getLoadedLuts(): LutEntry[] {
    return [...this.loadedLuts.values()]
  }

  getActive(): LutEntry | null {
    if (!this.activeId) return null
    return this.loadedLuts.get(this.activeId) ?? null
  }

  getActiveGpuId(): number | undefined {
    return this.getActive()?.gpuId
  }

  getActiveId(): string | null {
    return this.activeId
  }

  setActive(id: string | null): void {
    this.activeId = id
  }

  /** 确保 LUT 已加载到 GPU，返回 GPU ID */
  async ensureLoaded(lutInfo: LutFileInfo): Promise<number | undefined> {
    const existing = this.loadedLuts.get(lutInfo.id)
    if (existing?.gpuId !== undefined) return existing.gpuId

    const lrc = getLrc()
    if (!lrc) return undefined

    try {
      // 外部目录 LUT 通过 IPC 读取，内置 LUT 通过 fetch
      const isExternal = lutInfo.id.startsWith('external:')
      const cubeData = isExternal
        ? await lrc.readLutFile(lutInfo.filePath)
        : await loadBuiltinLutData(lutInfo.filePath)

      const gpuId = await lrc.loadLut(cubeData)
      this.loadedLuts.set(lutInfo.id, {
        id: lutInfo.id,
        name: lutInfo.name,
        category: lutInfo.category,
        gpuId,
      })
      return gpuId
    } catch (error) {
      console.error(`[LutManager] 加载 LUT 失败: ${lutInfo.name}`, error)
      return undefined
    }
  }

  /** 根据 ID 或文件路径查找并加载 LUT */
  async ensureLoadedById(id: string): Promise<number | undefined> {
    const existing = this.loadedLuts.get(id)
    if (existing?.gpuId !== undefined) return existing.gpuId

    const allLuts = this.allLutsCache
    if (!allLuts) return undefined

    // 先按 filePath 匹配（用户存的是文件路径），再按 id 匹配（兼容旧数据）
    const info = allLuts.find((l) => l.filePath === id || l.id === id)
    if (!info) return undefined
    return this.ensureLoaded(info)
  }

  /** 导入自定义 .cube 文件 */
  async importCustomLut(name: string, cubeData: Uint8Array): Promise<string> {
    const lrc = getLrc()
    if (!lrc) throw new Error('渲染引擎未初始化')

    const id = `imported:${Date.now()}`
    const gpuId = await lrc.loadLut(cubeData)
    this.loadedLuts.set(id, {
      id, name, category: '已导入', gpuId,
    })
    return id
  }

  async releaseAll(): Promise<void> {
    const lrc = getLrc()
    if (!lrc) return
    for (const [, entry] of this.loadedLuts) {
      if (entry.gpuId !== undefined) {
        try { await lrc.releaseLut(entry.gpuId) } catch { /* ignore */ }
      }
    }
    this.loadedLuts.clear()
  }

  async release(id: string): Promise<void> {
    const entry = this.loadedLuts.get(id)
    if (!entry || entry.gpuId === undefined) return
    const lrc = getLrc()
    if (lrc) {
      try { await lrc.releaseLut(entry.gpuId) } catch { /* ignore */ }
    }
    this.loadedLuts.delete(id)
  }
}

export const lutManager = new LutManagerClass()
