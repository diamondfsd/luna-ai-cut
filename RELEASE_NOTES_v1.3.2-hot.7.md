# v1.3.2-hot.6 — 热更新发布说明

## 新功能

- **热更新发布说明查看**：检测到热更新时横幅新增「更新内容」按钮，点击可查看本次热更新的 Bug 修复和改进详情
- **构建脚本自动打 tag**：`build-hot-update.sh` 执行完后自动创建 `hot/v1.3.2-hot.x` 并推送到远程

## Bug 修复

- **修复 Live Photo 水印定位偏移问题**：`probeImage()` 改用 `probe-image-size` 库替换 ffprobe，彻底解决不同 ffprobe 版本/平台下 Live Photo 文件流顺序不一致导致图片尺寸读错、水印位置跑偏的问题
- **修复导出后预览仍加载源文件的问题**：导出进度弹窗点击「预览」时，正确使用导出文件（带水印）替代原始相机文件。同时修复 Live Photo 预览因文件名缓存碰撞导致播放无水印原片的问题
- **修复 Live Photo 视频水印位置偏高的问题**：视频水印 Y 方向边距改用 `outputH × 3%`（之前误用 `outputW`），使其与图片水印底部边距比例一致
- **修复预览预览 Live Photo 视频无水印的问题**：播放区块新增 `WatermarkOverlay` 覆盖层

## 改进

- **开发模式跳过热更新**：`npm run dev` 时不再加载已安装的热更新代码，直接使用本地源码
- **窗口标题始终显示版本号**：无热更新时显示 `Luna AI Cut v1.3.2`，有热更新追加 `-hot.x` 后缀
- **减少 ffprobe 依赖**：图片尺寸探测从 ffprobe 子进程改为 `probe-image-size` 库，减少跨平台兼容问题
- **导出进度弹窗日志增强**：新增 `[PROBE IMG]`、`[WATERMARK IMG]`、`[WATERMARK VID]`、`[EXPORT]` 等关键链路日志，方便问题排查
