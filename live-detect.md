# Live Photo 检测与预览方案（已完成）

## 文件拆分

- `electron/livePhotoService.ts` ✅ — Live Photo 检测/提取/组合/Apple配对
- `electron/watermarkAssets.ts` ✅ — 仅水印资源路径查找
- `electron/watermarkService.ts` ✅ — 已删除

## 预览弹窗 LIVE 徽章

### 主预览区 ✅
`PreviewModal.tsx`:
- `window.luna.workspace.isLivePhoto()` 检测
- 预览区右下角叠加 `<LivePhotoBadge size={32} />`

### 缩略图条 ✅（方案B + 模块级缓存）
`PreviewThumbnailStrip.tsx`:
- `useLivePhotoStatus(files)` hook
- 模块级 `livePhotoCache = new Map<string, boolean>()`
- `ThumbnailItem(isLive={livePhotoMap[file.href]})` → 显示 LIVE 图标
