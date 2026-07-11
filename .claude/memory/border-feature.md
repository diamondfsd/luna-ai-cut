# Border Feature (边框功能) — 最终实现

## 架构

**Canvas 绘制边框 → base64 → PreviewLayer → Rust 统一渲染**

```
前端 Canvas2D 绘制边框（文字+颜色）
       ↓ toDataURL('image/png') → split(',')[1] 得到 base64
       ↓ 填入 PreviewLayer.imageDataBase64
       ↓ 传给 Rust Compositor
Rust 解码 base64 → ffmpeg pipe:0 解码 PNG → RGBA 纹理
       ↓ wgpu 合成 → 预览 + 导出
```

## Rust 层改动

**`luna-render-core/Cargo.toml`**: 新增 `base64 = "0.22"` 依赖

**`compositor.rs`**:
- `PreviewLayerInput` 新增 `image_data_base64: Option<String>` 字段
- 新增 `decode_image_from_base64_scaled()` 函数：
  - 解码 base64 → PNG bytes
  - ffprobe pipe:0 探测 PNG 原始尺寸
  - ffmpeg pipe:0 解码 + Lanczos 缩放到目标尺寸 → raw RGBA
- `render_preview()` 静态图加载分支增加 base64 处理（优先于 file_path，不缓存）

**`lib.rs`**: napi `PreviewLayer` 新增 `image_data_base64` 字段，映射到 `PreviewLayerInput`

**`composition.rs`**: `CompositionLayer` 新增 `image_data_base64` 字段，`composition_layers()` 透传

## 前端改动

**`buildBorderLayer.ts`**（新文件）:
- `renderBorderToBase64()`: Canvas 绘制底部白色信息条 + 文字（设备/参数/日期）
- `buildBorderLayer()`: 返回 `PreviewLayer[]`（含 base64 数据）

**`render.ts`**: `PreviewLayer` 和 `CompositionLayer` 新增 `imageDataBase64?: string`

**`renderComposition.ts`**: `buildCompositionFromPreviewLayers()` 透传 `imageDataBase64`

**`workspaceExportLayers.ts`**: `buildWorkspaceExportLayers()` 可选接收 `borderMetadata`，导出时包含边框层

**`WorkspacePage.tsx`**:
- 加载 EXIF 元数据 → `borderMetadata` state
- `useMemo` 计算 `borderLayer` → 合并到 `extraLayers`
- `renderOverlay` 不再渲染 DOM 覆盖层（移除 `BorderPreviewOverlay`）

## 工作原理

1. 用户在面板中开启边框，调整颜色/高度/字体/内容
2. 当 media 切换或 border 参数变化时：
   - 加载 EXIF 元数据（IPC: getMediaMetadataByPath）
   - Canvas 按输出分辨率绘制边框图片
   - 导出 base64 PNG 字符串
   - 构建 PreviewLayer（含 imageDataBase64）
3. 预览/导出时，Rust Compositor 识别到 imageDataBase64 → ffmpeg 解码 → GPU 纹理 → wgpu 合成
4. 边框作为 zIndex=10 的覆盖层，位于主画面之上

## 不支持的场景（当前限制）

- 暂无内存缓存（每次重新生成 base64 图片），后续可按 content hash 缓存
