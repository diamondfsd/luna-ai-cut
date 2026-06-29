# v1.3.2-hot.9 — 热更新发布说明

## Bug 修复

- **修复低版本 macOS 视频导出失败问题**：某些旧 Mac（macOS < 10.13 或旧款 Intel 硬件）不支持 HEVC 硬件编码，使用 `hevc_videotoolbox` 时底层 VideoToolbox 框架返回 `kVTParameterErr (-12905)` 导致导出报错。现增加启动时自动探测机制，检测到 `hevc_videotoolbox` 不可用时自动回退到 `libx265` 软件编码，确保所有 Mac 都能正常导出。

## 改进

- **硬件加速探测增强**：macOS 平台首次导出前会快速验证 `hevc_videotoolbox` 是否真实可用，避免因旧系统兼容性问题导致导出中途失败
