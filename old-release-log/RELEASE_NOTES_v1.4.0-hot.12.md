# v1.4.0-hot.12 — 热更新发布说明

## 改进

- **添加网络诊断信息**：连接超时或失败时，自动采集全面的网络诊断数据（ping、路由、端口探测、子网匹配等），展示在连接页诊断面板中，方便排查连接问题
- **优化连接超时体验**：`enrichConnectionStatus` 降级为完整的网络诊断收集，失败时回退到基础 Wi-Fi 状态检测
- **控制会话绑定地址日志**：`resolveLocalAddress` 结果写入主进程 debug 日志，便于追踪多网卡场景下的路由绑定情况
- **减少无谓重试**：Luna Ultra 控制会话建立重试次数从 6 次降至 3 次，加快连接失败时的反馈速度

## 技术变更

- 新增 `electron/networkDiagnostics.ts`：主进程网络诊断服务
- 新增 `src/shared/types/networkDiagnostics.ts`：诊断结果类型定义
- 新增 IPC 通道 `luna:collectNetworkDiagnostics`，暴露 `window.luna.collectNetworkDiagnostics()`
- 新增 `network.resolvedLocalAddress` 字段：通过子网掩码匹配目标主机，显示实际绑定的本地地址（与 `connectSocket` 逻辑一致）
