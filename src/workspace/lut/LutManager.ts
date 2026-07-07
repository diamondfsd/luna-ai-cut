/**
 * LutManager — 全局 LUT 加载/缓存/生命周期管理
 *
 * - 管理内置滤镜和用户导入的自定义 .cube LUT
 * - 通过 IPC 将 LUT 数据加载到 Rust/wgpu 3D 纹理
 * - 缓存 GPU LUT ID，供渲染层使用
 */
import { BUILTIN_LUTS, cubeTextToBuffer, type BuiltinLutDef } from './builtinLuts'

export interface LutEntry {
  /** 唯一标识（内置 id 或自定义 'custom_xxx'） */
  id: string
  /** 显示名称 */
  name: string
  /** GPU LUT ID（由 loadLut 返回），加载失败时为 undefined */
  gpuId?: number
  /** 来源：内置或自定义 */
  source: 'builtin' | 'custom'
}

type LunaRenderCore = {
  loadLut: (data: Uint8Array) => Promise<number>
  releaseLut: (id: number) => Promise<void>
}

function getLrc(): LunaRenderCore | null {
  const lrc = (window as unknown as { lunaRenderCore?: LunaRenderCore }).lunaRenderCore
  return lrc ?? null
}

class LutManagerClass {
  /** 已加载的 LUT 映射 <id → LutEntry> */
  private luts: Map<string, LutEntry> = new Map()
  /** 当前激活的 LUT ID（null = 无滤镜） */
  private activeId: string | null = null
  /** 生成的自定义 ID 计数器 */
  private customCounter = 0
  /** 内置 LUT 定义 */
  private builtins: Map<string, BuiltinLutDef> = new Map()

  constructor() {
    for (const def of BUILTIN_LUTS) {
      this.builtins.set(def.id, def)
    }
  }

  /** 获取所有已注册的 LUT 元数据（含未加载的） */
  getAvailableLuts(): LutEntry[] {
    const result: LutEntry[] = []
    // 内置 LUT
    for (const [id, def] of this.builtins) {
      const existing = this.luts.get(id)
      result.push(existing ?? { id, name: def.name, source: 'builtin' })
    }
    // 自定义 LUT
    for (const [, entry] of this.luts) {
      if (entry.source === 'custom') {
        result.push(entry)
      }
    }
    return result
  }

  /** 获取当前激活的 LUT */
  getActive(): LutEntry | null {
    if (!this.activeId) return null
    return this.luts.get(this.activeId) ?? null
  }

  /** 获取当前激活的 GPU LUT ID（用于渲染层设置 lutId） */
  getActiveGpuId(): number | undefined {
    return this.getActive()?.gpuId
  }

  /** 获取当前激活的滤镜 ID */
  getActiveId(): string | null {
    return this.activeId
  }

  /** 设置激活的滤镜（null = 取消滤镜） */
  setActive(id: string | null): void {
    this.activeId = id
  }

  /** 确保 LUT 已加载到 GPU，返回 GPU ID */
  async ensureLoaded(id: string): Promise<number | undefined> {
    // 已缓存
    const existing = this.luts.get(id)
    if (existing?.gpuId !== undefined) {
      return existing.gpuId
    }

    // 查找 LUT 数据源
    let cubeData: Uint8Array
    let name: string

    const builtin = this.builtins.get(id)
    if (builtin) {
      // 内置 LUT — 即时生成 .cube 数据
      name = builtin.name
      const cubeText = builtin.generate()
      cubeData = cubeTextToBuffer(cubeText)
    } else {
      // 自定义 LUT 但尚未加载
      const entry = this.luts.get(id)
      if (!entry) return undefined
      return undefined // 没有数据就无法加载
    }

    // 通过 IPC 加载到 GPU
    const lrc = getLrc()
    if (!lrc) return undefined
    try {
      const gpuId = await lrc.loadLut(cubeData)
      this.luts.set(id, { id, name, gpuId, source: 'builtin' })
      return gpuId
    } catch (error) {
      console.error('[LutManager] loadLut failed:', error)
      return undefined
    }
  }

  /** 加载自定义 .cube 文件 */
  async importCustomLut(name: string, cubeData: Uint8Array): Promise<string> {
    const id = `custom_${++this.customCounter}`
    const lrc = getLrc()
    if (!lrc) throw new Error('渲染引擎未初始化')

    const gpuId = await lrc.loadLut(cubeData)
    this.luts.set(id, { id, name, gpuId, source: 'custom' })
    return id
  }

  /** 释放所有已加载的 LUT 纹理 */
  async releaseAll(): Promise<void> {
    const lrc = getLrc()
    if (!lrc) return
    for (const [, entry] of this.luts) {
      if (entry.gpuId !== undefined) {
        try { await lrc.releaseLut(entry.gpuId) } catch { /* ignore */ }
      }
    }
    this.luts.clear()
  }

  /** 释放指定 LUT */
  async release(id: string): Promise<void> {
    const entry = this.luts.get(id)
    if (!entry || entry.gpuId === undefined) return
    const lrc = getLrc()
    if (lrc) {
      try { await lrc.releaseLut(entry.gpuId) } catch { /* ignore */ }
    }
    this.luts.delete(id)
  }
}

/** 全局单例 */
export const lutManager = new LutManagerClass()
