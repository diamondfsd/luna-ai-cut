# 导出流程分析

> 分析日期：2026-07-05
> 基于当前代码（当前分支 `feat-luna-gpu-create`）

---

## 概览

当前存在 **两条导出路径**：

| 路径 | 适用场景 | 渲染引擎 | 输出格式 |
|------|----------|----------|----------|
| **PreviewStage 导出** | 预览帧导出（单帧图片/视频/Live Photo） | Rust wgpu 合成 + FFmpeg 编码 | JPEG/PNG/WebP/MP4 |
| **FFmpegFast 导出** | 工作台（EditPipeline）批量导出（含调色/水印/曲线） | Electron 主进程 FFmpeg 滤镜链 | JPEG/MP4 |

---

## 一、预览帧导出流程（PreviewStage → Rust wgpu）

### 前端（React）

#### 入口组件
**[PreviewStage.tsx](src/components/PreviewStage.tsx)** (`export()` 方法 via `useImperativeHandle`)

```
用户触发 PreviewStage.export()
 └─ 1. window.luna.getSettings() → 获取 exportDir
 └─ 2. window.luna.workspace.getMediaResolution(url) → 获取原始分辨率
 └─ 3. buildAdjustedLayers() → 构建渲染层（含 color/transform 管线）
 └─ 4. 根据媒体类型选择路径：
      ├─ 图片 → exportPreviewImage()
      ├─ 视频 → exportPreviewVideo()
      └─ Live Photo → exportPreviewLivePhoto()
```

#### 桥接层
**[previewStageExport.ts](src/components/previewStageExport.ts)**

| 函数 | 调用 | 说明 |
|------|------|------|
| `exportPreviewImage()` | `lrc().exportImageFromSources(path, w, h, layers, format, quality)` | 直接由 Rust 按导出分辨率独立加载纹理、渲染、编码、落盘 |
| `exportPreviewVideo()` | `lrc().exportVideo(inputPath, outputPath, cw, ch, fps, hw, videoLayer, overlayLayers, taskId, quality)` | Rust 逐帧解码→合成→编码，通过 `export:progress` 事件回传进度 |
| `exportPreviewLivePhoto()` | 先导出 image + video，再调 `window.luna.workspace.exportRenderedLivePhoto()` | 三阶段：导出图片→导出视频→合成 Live Photo |

#### 渲染组件
**[LrcRender.tsx](src/components/LrcRender.tsx)**

- 通过 `window.lunaRenderCore`（contextBridge 暴露的 IPC API）与 Rust 通信
- 加载静态图片纹理到 Rust GPU（LRU 缓存管理）
- 视频通过浏览器 `<video>` 硬件解码，逐帧通过 `updateTexture()` 上传到 GPU
- RAF 循环驱动视频帧更新
- 暴露 `exportImage()` / `exportVideo()` 方法（走 `exportImageFromSources` / `exportVideo`）

### Electron 主进程（Bridge）

#### IPC 注册
**[ipcLunaRenderCore.ts](electron/ipcLunaRenderCore.ts)**

- `lrc:exportImageFromSources` → `lrcExportImageFromSources()` → Rust export_image_from_sources
- `lrc:exportVideo` → `lrcExportFileAsync()` → Rust export_file_async
  - 启动时发送 `export:progress` (status: exporting)
  - 完成时发送 `export:progress` (status: done)
  - 异常时发送 `export:progress` (status: failed)

#### Native 封装
**[lunaRenderCore.ts](electron/lunaRenderCore.ts)**

- 通过 `require()` 加载 `luna-render-core/luna-render-core.node` (napi addon)
- 提供类型安全封装，会补全可选字段的默认值（color、transform 等）
- `exportImageFromSources()` → `getNative().exportImageFromSources()`
- `exportFileAsync()` → `getNative().exportFileAsync()`

**[preload.ts](electron/preload.ts)** — contextBridge 暴露

- `window.lunaRenderCore`: `init`, `loadTexture`, `loadTextureFromPath`, `updateTexture`, `releaseTexture`, `renderFrame`, `exportImage`, `exportVideo`, `exportImageFromSources`, `renderPreview`, `renderLayersToFile`
- `window.luna.workspace`: `exportRenderedLivePhoto`, `getMediaResolution`, `exportFFmpeg`, `createExportTask`

### Rust 原生层（wgpu + FFmpeg）

**[luna-render-core/src/lib.rs](luna-render-core/src/lib.rs)** — NAPI 导出

| NAPI 函数 | 功能 |
|-----------|------|
| `init_compositor()` | 初始化 wgpu 设备/队列/管线 |
| `load_texture()` | 上传 RGBA 数据到 GPU |
| `load_texture_from_path()` | 用 FFmpeg 解码文件 + EXIF 解析 + HDR normalize → wgpu 纹理 |
| `export_image_from_sources()` | **从源文件导出图片**（独立加载，不依赖预览缓存） |
| `export_file_async()` | **异步导出统一入口**（内部判断 image/video 分流） |
| `render_layers_to_file()` | 渲染已有纹理到文件 |
| `cancel_export_task()` | 取消导出（AtomicBool + kill 子进程） |
| `get_export_task_progress()` | 查询进度 |

**[luna-render-core/src/export.rs](luna-render-core/src/export.rs)** — 核心导出逻辑

**图片导出 (`export_image`)**:
```
源文件 → ffmpeg decode RGBA → wgpu loadTexture → render(叠加层) → ffmpeg encode → 写文件
```

**视频导出 (`export_video`)**:
```
ffprobe 探测尺寸/fps/帧数/音频信息
→ 选择编码器（h264_videotoolbox / nvenc / libx264）
→ 计算码率（按 QualityPreset）
→ 启动 decode pipe: ffmpeg -i input → rawvideo pipe
→ 启动 encode pipe: ffmpeg rawvideo ← pipe + -i input(音频)
→ 逐帧循环:
    read_exact(frame) → wgpu updateTexture → wgpu render → write_all(encoded)
→ 音频直通 (-map 1:a:0?)
→ 清理
```

任务状态管理：全局 `HashMap<String, Arc<TaskState>>`，支持取消（kill 子进程 + AtomicBool 标记）。

**[luna-render-core/src/compositor.rs](luna-render-core/src/compositor.rs)** — wgpu 合成器

- WGSL shader: 每层一个 textured quad，支持：
  - 裁剪/旋转/翻转/缩放
  - 颜色调整（exposure, brightness, contrast, saturation, vibrance, temperature, tint, highlights/shadows, whites/blacks）
  - 透明度混合（PREMULTIPLIED_ALPHA_BLENDING）
- LRU 缓存：静态图片纹理缓存 10 张
- 视频帧通过持久 FFmpeg pipe 逐帧读取（保持进程存活）
- 预览统一入口 `render_preview()`：自动管理静态图缓存和视频 pipe

---

## 二、工作台 FFmpegFast 导出流程（EditPipeline → Electron FFmpeg）

此路径用于**带完整编辑管线（调色、曲线、水印等）的批量导出**，通过 Electron 主进程直接调用 ffmpeg 二进制，不走 Rust wgpu。

### 前端

- **canExportFFmpeg.ts**: 检查 pipeline 是否可走 ffmpeg（当前默认 true）
- **exportUtils.ts**: 曲线数据 → ffmpeg `curves` filter 参数
- **ExportModal.tsx**: 导出设置 UI（分辨率、帧率、码率、水印）
- **exportTaskRunner.ts**: 任务调度（图片 4 路并发，视频 1 路，分别调度）

### Electron 主进程

**[ipcWorkspaceFfmpegExport.ts](electron/ipcWorkspaceFfmpegExport.ts)**

IPC: `workspace:exportFFmpeg`

```
接收 sourcePath + pipeline + exportMeta
→ 创建导出任务记录
→ 检查是否为 Live Photo（Google Motion Photo）
  ├─ 是: extractImage → processImage(FFmpegPipeline) → extractVideo → processVideo(FFmpegPipeline) → combineLivePhoto
  └─ 否: 直接执行 FFmpegPipeline
→ 构建 FFmpeg 管线:
  1. 硬件加速 (detectHardwareAccel)
  2. 水印 (watermarkFileFor → overlay filter)
  3. 调色 LUT (bakeColorLut → lut filter)
  4. 码率 (BitrateModule)
  5. 编码器 (CodecModule: h264_videotoolbox/nvenc/libx264)
  6. 音频直通
→ 执行 ffmpeg (progress 回调 → export:progress)
→ 更新任务状态
```

**FFmpeg 滤镜模块文件（[electron/ffmpeg/](electron/ffmpeg/)）**:
- [pipeline.ts](electron/ffmpeg/pipeline.ts) — FfmpegPipeline 类
- [pipelineCompiler.ts](electron/ffmpeg/pipelineCompiler.ts) — 完整管线编译
- [colorGrading.ts](electron/ffmpeg/colorGrading.ts) — 调色滤镜
- [watermark.ts](electron/ffmpeg/watermark.ts) — 水印 overlay
- [lutGenerator.ts](electron/ffmpeg/lutGenerator.ts) — 颜色参数→LUT cube
- [hwaccel.ts](electron/ffmpeg/hwaccel.ts) — 硬件加速检测
- [codec.ts](electron/ffmpeg/codec.ts) — 编码器配置
- [bitrate.ts](electron/ffmpeg/bitrate.ts) — 码率计算
- [scale.ts](electron/ffmpeg/scale.ts) — 缩放
- [framerate.ts](electron/ffmpeg/framerate.ts) — 帧率

---

## 三、关键 IPC 通道汇总

### 导出专用 IPC
| 通道 | 方向 | 说明 |
|------|------|------|
| `lrc:exportImageFromSources` | Renderer→Main→Rust | Rust 图片导出 |
| `lrc:exportVideo` | Renderer→Main→Rust | Rust 视频导出（异步） |
| `lrc:cancelExportTask` | Renderer→Main→Rust | 取消 Rust 导出任务 |
| `lrc:getExportTaskProgress` | Renderer→Main→Rust | 查询 Rust 导出进度 |
| `lrc:renderLayersToFile` | Renderer→Main→Rust | 渲染已有纹理到文件 |
| `workspace:exportFFmpeg` | Renderer→Main | 工作台 FFmpeg 导出 |
| `workspace:exportRenderedLivePhoto` | Renderer→Main | Live Photo 合成 |
| `workspace:createExportTask` | Renderer→Main | 创建导出任务记录 |
| `workspace:getMediaResolution` | Renderer→Main | 获取媒体分辨率 |
| `export:progress` | Main→Renderer | 导出进度推送 |
| `luna-export:start/cancel/progress` | Renderer↔Main | 遗留导出 API |

---

## 四、各层职责总结

| 层 | 职责 |
|----|------|
| **前端** (React) | 导出 UI、图层构建、媒体类型判断、任务调度、进度展示 |
| **Electron Bridge** (preload + IPC) | 参数规范化、Native 调用桥接、进程间事件转发 |
| **Electron FFmpeg** (ipcWorkspaceFfmpegExport) | 完整管线编译（调色LUT+水印+编码）、Live Photo 分阶段处理 |
| **Rust wgpu** (luna-render-core) | GPU 合成渲染（WGSL shader）、FFmpeg 编解码管道、逐帧处理、取消/进度追踪 |

---

## 五、流程图

```
                          PreviewStage 导出                         FFmpegFast 导出（工作台）
                     ╔══════════════════════╗               ╔════════════════════════════╗
   前端               ║  PreviewStage.tsx    ║               ║  exportTaskRunner.ts       ║
                     ║  export() 方法       ║               ║  ExportModal.tsx           ║
                     ║  previewStageExport.ts║              ║  canExportFFmpeg.ts        ║
                     ╚══════════╤═══════════╝               ╚══════════════╤═════════════╝
                                │                                         │
                     ╔══════════▼═══════════╗               ╔══════════════▼═════════════╗
   Electron          ║  preload.ts          ║               ║  preload.ts                 ║
   Bridge            ║  window.lunaRenderCore║              ║  window.luna.workspace      ║
                     ╚══════════╤═══════════╝               ╚══════════════╤═════════════╝
                                │                                         │
                     ╔══════════▼═══════════╗               ╔══════════════▼═════════════╗
   Electron          ║  ipcLunaRenderCore.ts║               ║  ipcWorkspaceFfmpegExport.ts║
   Main              ║                      ║               ║  ┌─────────────────────┐    ║
                     ║  lunaRenderCore.ts   ║               ║  │FfmpegPipeline       │    ║
                     ║  (native addon 封装) ║               ║  │→ FullPipelineModule  │    ║
                     ╚══════════╤═══════════╝               ║  │→ BitrateModule      │    ║
                                │                           ║  │→ CodecModule        │    ║
                     ╔══════════▼═══════════╗               ║  │→ 水印 overlay       │    ║
   Rust              ║  luna-render-core    ║               ║  │→ 调色 LUT           │    ║
                     ║  ┌───────────────┐   ║               ║  │→ 音频直通           │    ║
                     ║  │wgpu Compositor│   ║               ║  └─────────────────────┘    ║
                     ║  │(WGSL shader)  │   ║               ╚══════════════╤═════════════╝
                     ║  └──────┬────────┘   ║                              │
                     ║         │             ║                  ╔═══════════▼═════════════╗
                     ║  ffmpeg decode/encode║                  ║  ffmpeg 命令行           ║
                     ║  (pipe 模式)         ║                  ║  (完整滤镜链)            ║
                     ╚══════════════════════╝                  ╚═══════════════════════════╝
```

---

## 六、注意事项 / 待改进

1. **两条导出路径并存**：PreviewStage 走 Rust wgpu 逐帧合成，FFmpegFast 走 Electron 主进程 ffmpeg 滤镜链。前者逐帧渲染更准确（wgpu shader 合成），后者性能更高但精度受限于 LUT + ffmpeg filter 映射。
2. **Live Photo 有两套处理**：PreviewStage 走 Rust 导出后调 `exportRenderedLivePhoto` 合成；FFmpegFast 走 `extract→process→combine` 三阶段（在 Electron 中完成）。
3. **水印渲染差异**：PreviewStage 导出中水印作为 `PreviewLayer` 层传入 Rust wgpu 合成；FFmpegFast 导出中水印通过 ffmpeg `overlay` filter 叠加。
4. **调色处理差异**：PreviewStage 用 WGSL shader 逐像素颜色调整；FFmpegFast 用 baked LUT cube + `lut` filter 近似。
5. **上下文：当前分支为 `feat-luna-gpu-create`**，正处于 GPU 渲染核心的重构阶段，后续可能会有变化。
