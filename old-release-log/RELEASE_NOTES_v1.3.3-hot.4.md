# v1.3.3-hot.4 — 热更新发布说明

## Bug 修复

- **修复缩略图不加载问题**：修复了主进程 `luna:cacheFile` 队列任务缺少 try-catch 导致异常被吞的 Bug，并增强全链路日志便于排查缩略图加载失败根因

## 改进

- **增强缩略图调试日志**：从渲染进程 `requestThumbnail` → IPC → 主进程队列 → `cacheFile` 下载 → `thumbnailService` ffmpeg 缩略图生成 → `thumbnail-ready` 回调的完整链路添加 INFO/ERROR 级别日志
- **缩略图生成日志修复**：`thumbnailService.ts` 原来使用 `console.log/error`，日志不会写入文件，现改为 `logMain*` 写入正式日志文件
- **系统信息日志**：应用启动时打印操作系统版本、芯片架构、CPU 核心数、内存等信息到日志文件
- **文件加载状态统计**：媒体库加载完成后打印文件状态摘要（有缩略图/本地路径/缓存路径的文件数）
