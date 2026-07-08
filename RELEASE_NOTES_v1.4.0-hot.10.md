# v1.4.0-hot.10 — 热更新发布说明

## Bug 修复

- **多网卡路由问题**：修复 macOS 上同时连接普通 Wi-Fi 和 Luna 相机网络时，TCP 连接被 macOS Service Order 错误路由到主网卡导致连接超时的问题。现在自动检测本机与目标在同一子网的 IP 地址，强制 socket 绑定到正确网卡（`localAddress` 绑定）

## 改进

- 无
