# Live Photo 检测与预览方案（已实现）

## 拆分结果

- `electron/livePhotoService.ts` — Live Photo 处理（检测/提取/组合/Apple配对）
- `electron/watermarkAssets.ts` — 仅水印资源路径查找
- `electron/watermarkService.ts` — 已删除（水印处理迁移至 Rust）

## 预览弹窗 — LIVE 徽章

### 主预览区 ✅ 已完成

`PreviewModal.tsx`:
- 新增 `isLivePhoto` state + `useEffect` 检测
- 预览区域右下角叠加 `<LivePhotoBadge size={32} />`

### 缩略图条（方案 B + 缓存）

`PreviewThumbnailStrip.tsx`:
- 组件内部 `useLivePhotoStatus(files)` hook
- 模块级 `livePhotoCache = new Map<string, boolean>()` 避免重复 IPC
- 初次挂载 / filePathList 变化时检测未缓存的文件
- 检测结果预览缩略图右下角的 LIVE 图标

**待实现：**
- [ ] 添加 `useLivePhotoStatus` hook 到 `PreviewThumbnailStrip`
- [ ] `ThumbnailItem` 从 `file.isLivePhoto` 改为从 live photo map 取值
- [ ] 每次 `filePathList` 变化时批量检测未缓存的文件
