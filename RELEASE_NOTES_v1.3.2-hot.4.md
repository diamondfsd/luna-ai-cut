# v1.3.2-hot.4 — 热更新发布说明

## Bug 修复

- **修复 Live Photo 水印定位偏移问题**：`probeImage()` 改用 `probe-image-size` 库替换 ffprobe，彻底解决不同 ffprobe 版本/平台下 Live Photo 文件流顺序不一致导致图片尺寸读错、水印位置跑偏的问题
- **修复导出后预览仍加载源文件的问题**：导出进度弹窗点击「预览」时，正确使用导出文件（带水印）替代原始相机文件

## 改进

- **开发模式跳过热更新**：`npm run dev` 时不再加载已安装的热更新代码，直接使用本地源码
- **窗口标题始终显示版本号**：无热更新时显示 `Luna AI Cut v1.3.2`，有热更新追加 `-hot.x` 后缀
- **减少 ffprobe 依赖**：图片尺寸探测从 ffprobe 子进程改为 `probe-image-size` 库，减少跨平台兼容问题
- **导出进度弹窗日志增强**：新增 `[PROBE IMG]`、`[WATERMARK IMG]`、`[WATERMARK VID]`、`[EXPORT]` 等关键链路日志，方便问题排查
