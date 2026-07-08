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
}
