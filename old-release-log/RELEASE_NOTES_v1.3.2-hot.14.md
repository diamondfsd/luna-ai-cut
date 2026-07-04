# v1.3.2-hot.14 — 热更新发布说明

## 改进

- **优化 Live Photo 视频处理速度**：跳过完整 ffmpeg pipeline，强制 `h264_videotoolbox` 硬件编码，旧款 ARM Mac 上速度提升 3-5 倍
- **暂关闭 Apple Live Photo 配对导出**：待兼容问题修复后再开启，安卓 Google Motion Photo 输出不受影响
