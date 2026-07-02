# PreviewModal 组件参数说明

## Props 表格

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `files` | `LunaFile[]` | ✅ | — | 可切换的文件列表（含缩略图条） |
| `currentFile` | `LunaFile` | ✅ | — | 当前要预览的文件 |
| `currentFileId` | `string` | ✅ | — | 当前文件的 ID，用于在 files 中匹配 |
| `preview` | `PreviewResult \| null` | ✅ | — | 预览结果（含 cachedPath/thumbnailUrl）。**为 null 时**图片元数据无法加载（已修复，降级用本地路径） |
| `previewLoading` | `boolean` | ✅ | — | 预览加载中 |
| `downloadProgress` | `DownloadProgress \| undefined` | — | `undefined` | 下载进度（下载页面用，用于水印控制和进度条） |
| `isDownloadsPage` | `boolean` | ✅ | — | 是否在已下载页面；为 true 时启用水印控制和 EXIF 预览 |
| `showWatermarkControls` | `boolean` | — | `isDownloadsPage` | 是否显示水印控制（水印开关、样式选择等） |
| `onClose` | `() => void` | ✅ | — | 关闭弹窗回调 |
| `onDownload` | `(file: LunaFile) => void` | ✅ | — | 下载按钮回调（无下载场景传空函数） |
| `onExportWithWatermark` | `(file: LunaFile, settings: WatermarkSettingsType) => void` | — | — | 水印导出回调 |
| `onReveal` | `(file: LunaFile) => void` | ✅ | — | 在文件夹中显示回调 |
| `onFileChange` | `(file: LunaFile) => void` | ✅ | — | 切换当前文件回调（缩略图条、上/下翻页） |
| `autoPlayLive` | `boolean` | — | `false` | 是否自动播放 Live Photo |

## 调用方传参对比

### MediaLibraryPage（常规媒体库预览）

```tsx
<PreviewModal
  files={previewFiles.length > 0 ? previewFiles : filteredFiles}
  currentFile={previewFile}
  currentFileId={previewFile.id}
  preview={preview}             // ← 有值，能正常加载元数据
  previewLoading={previewLoading}
  downloadProgress={progressForPreview}
  isDownloadsPage={isDownloadsPage}
  showWatermarkControls={isDownloadsPage && viewMode === 'download'}
  onClose={() => { ... }}
  onDownload={(file) => downloadOne(file)}
  onExportWithWatermark={...}
  onReveal={...}
  onFileChange={...}
/>
```

### ExportTaskTable（导出记录列表预览）

```tsx
<PreviewModal
  files={[previewFile]}          // ← 只有一个文件
  currentFile={previewFile}
  currentFileId={previewFile.id}
  preview={null}                 // ← 没传，会降级到本地路径加载元数据
  previewLoading={false}
  downloadProgress={undefined}
  isDownloadsPage={false}
  onClose={() => setPreviewFile(null)}
  onDownload={() => {}}          // ← 空函数，其实不需要显示下载按钮
  onReveal={(f) => onRevealFile?.(...)}
  onFileChange={setPreviewFile}
/>
```

## 值得注意的点

1. **`preview` 为 null 时** — 之前图片元数据加载会跳过（已修），现在会降级到 `file.downloadFilePath` / `localPath`
2. **`onDownload` 空函数** — 导出记录场景没有下载操作，但必填，导致下载图标仍然显示但没反应
3. **`downloadProgress` 不传** — 进度条区域隐藏，没有影响
4. **`isDownloadsPage` 为 false** — 水印相关功能自动关闭（`showWatermarkControls` 默认等于它）
