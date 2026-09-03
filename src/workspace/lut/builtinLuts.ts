/**
 * 内置滤镜 LUT 类型定义
 *
 * LUT 已通过 IPC listCubeFiles 从文件系统扫描，
 * 不再需要 fetch manifest / meta.json。
 */

export interface LutFileInfo {
  id: string
  name: string
  category: string
  /** 文件系统绝对路径 */
  filePath: string
  /** 可选描述（从 .cube.meta.json 加载） */
  description?: string
  /** 是否为内置 LUT（不可删除） */
  isBuiltin?: boolean
  /** 技术还原 LUT 不作为创意滤镜展示。 */
  isTechnical?: boolean
  /** 技术还原 LUT 所属设备。 */
  deviceId?: string
}
