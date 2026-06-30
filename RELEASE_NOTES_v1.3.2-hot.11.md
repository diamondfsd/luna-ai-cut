# v1.3.2-hot.11 — 热更新发布说明

## Bug 修复

- **修复 Windows NVIDIA 显卡导出 10-bit HEVC 视频时崩溃**：NVIDIA CUDA 硬件加速配置中使用了 `overlay_cuda` GPU 滤镜，当视频为 10-bit HEVC（yuv420p10le）格式时，PNG 水印上传到 GPU 后无法完成格式转换，导出直接失败。现改为 CPU overlay + GPU 编码的混合方案，稳定性大幅提升。

- **修复 Windows 上检查更新时下载到 .dmg 文件**：更新服务中安装包匹配逻辑使用 `.find()` 返回第一个匹配项，当 Release 中同时存在 Mac 和 Windows 安装包时，Windows 用户可能匹配到 Mac 的 .dmg 文件。现已根据操作系统精确匹配对应平台和架构的安装包。

## 改进

- **Watermark 水印滤镜优化**：软件 overlay 路径增加 `format=rgba` 确保 PNG 透明通道稳定，overlay 增加 `:format=auto` 自动选择最佳输出格式。
