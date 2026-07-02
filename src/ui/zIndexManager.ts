/**
 * 全局 z-index 管理器。
 *
 * 弹窗按打开先后顺序递增 z-index，确保后打开的永远在前面。
 * 基础层级：遮罩层 = zIndex * 10 + 40，内容层 = zIndex * 10 + 50
 */

let nextId = 0
const active = new Map<string, number>()

/** 获取一个新的 z-index 序号（每次 +1） */
export function acquireIndex(): { id: string; zIndex: number } {
  const id = `modal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const zIndex = nextId++
  active.set(id, zIndex)
  return { id, zIndex }
}

/** 释放序号 */
export function releaseIndex(id: string): void {
  active.delete(id)
}

/** 计算遮罩层 z-index：基础值 40 + 序号 * 10 */
export function overlayZ(zIndex: number): number {
  return 40 + zIndex * 10
}

/** 计算内容层 z-index：遮罩层 + 10 */
export function contentZ(zIndex: number): number {
  return overlayZ(zIndex) + 10
}
