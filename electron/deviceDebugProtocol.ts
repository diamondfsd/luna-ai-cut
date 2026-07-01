/**
 * 设备调试协议接口
 *
 * 定义统一的设备调试协议接口，以最大需求为准，
 * 各设备类型（Luna Ultra、Go Ultra 等）实现此接口。
 *
 * 用于设备调试页面的端口检测、连接、授权、文件读取、保活等操作。
 */


// ============================================================
// 类型定义
// ============================================================

export interface DebugPortResult {
  httpOk: boolean
  controlOk: boolean
  httpPort: number | null
  controlPort: number | null
  message: string
}

export interface DebugConnectResult {
  success: boolean
  authState: string
  message: string
  httpOk: boolean
  controlOk: boolean
}

export interface DebugAuthResult {
  success: boolean
  authState: string
  message: string
}

export interface DebugFileListResult {
  success: boolean
  files: Array<{ name: string; size: number | null; url: string }>
  message: string
}

export interface DebugStatusResult {
  httpOk: boolean
  controlOk: boolean
  authState: string
  message: string
}

// ============================================================
// 设备调试协议接口
// ============================================================

export interface IDeviceDebugProtocol {
  readonly deviceId: string
  readonly deviceName: string

  /** 获取当前授权状态 */
  getAuthState(): string

  /** 详细的端口检测 — 扫描 HTTP / 控制端口 */
  checkPort(host: string): Promise<DebugPortResult>

  /** 连接设备（含基础认证 + 授权流程） */
  connect(host: string): Promise<DebugConnectResult>

  /** 断开连接 */
  disconnect(): Promise<void>

  /** 检查授权状态 */
  checkAuth(): Promise<DebugAuthResult>

  /** 请求授权（触发相机弹窗） */
  requestAuth(): Promise<DebugAuthResult>

  /** 等待用户在相机上确认授权 */
  waitForAuthConfirm(timeoutMs?: number): Promise<boolean>

  /** 读取文件列表 */
  listFiles(): Promise<DebugFileListResult>

  /** 启动保活 */
  startKeepAlive(intervalMs?: number): void

  /** 停止保活 */
  stopKeepAlive(): void

  /** 关闭并清理资源 */
  close(): void
}
