# v1.3.3-hot.1 — 热更新发布说明

## 新功能

- **Apple Live Photo 导出开关**：设置页新增「Apple Live Photo」开关（默认关闭），仅在 macOS 上显示，开启后才在导出时生成配对文件夹

## 改进

- **Live Photo 视频加速**：跳过完整 ffmpeg pipeline，强制 `h264_videotoolbox` 硬件编码，速度提升 3-5 倍
- **版本更新检测优化**：遍历 GitCode release 列表找最新版本，不再依赖有 bug 的 `/releases/latest` 接口

## Bug 修复

- **livetool.swift 元数据修复**：补上关键的 `live-photo-info` 字段，修正 `content-identifier` 键名，Apple Live Photo 在 iOS 上能被正确识别
- **修复安装包文件名匹配**：修正 macOS DMG 和 Windows exe 的匹配规则，使更新检测能正确找到 v1.3.3
