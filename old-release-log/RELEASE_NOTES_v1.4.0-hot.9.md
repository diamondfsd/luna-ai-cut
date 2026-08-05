# v1.4.0-hot.9 — 热更新发布说明

## Bug 修复

- **连接失败诊断信息展示**：连接失败时自动采集系统网卡信息，展示诊断面板并支持一键复制，方便排查连接问题
- **Windows Wi-Fi 调试接口注册条件**：修复 `wifiDebug:getStatus` 被错误包含在 Windows 平台条件判断内的问题，确保各平台均可获取系统网络状态

## 改进

- **Wi-Fi 调试状态检测重构**：从依赖 `airport`/`netsh wlan show interfaces` 改为通用跨平台实现，基于 `os.networkInterfaces()` 直接采集系统网卡信息，提升兼容性和稳定性
- **精简日志输出**：移除缩略图生成、文件缓存等流程中的冗余 debug/info 日志，减少日志文件冗余
