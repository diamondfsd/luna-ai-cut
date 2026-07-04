# Export 模块设计文档

`export.rs` — Rust 内部完成全部加载 + 渲染 + 编码的统一导出入口。

## 整体架构

```
JS 调用层 (IPC)
    │
    ▼
expor_file()          render_layers_to_file()
    │                         │
    ├─ export_image()         └─ 直接渲染已有纹理 (GPU)→编码→写文件
    └─ export_video()
```

所有导出路径共用同一个核心技术：**`Compositor::render()`**（wgpu 合成管线），区别仅在于输入源和输出方式。

---

## 函数说明

### 1. `render_layers_to_file()` — 新增（预览导出入口）

```
输入: 已加载的 GPU 纹理 + 坐标参数 + 输出路径 + 格式 + 质量
流程: c.render() → ffmpeg 编码 → 写入磁盘
输出: 无（直接写文件）
```

- 纹理已由 JS 侧通过 `loadTexture`/`loadTextureFromPath` 预加载到 GPU
- 不做任何文件加载，**一次 IPC 完成全部工作**，无像素数据回传
- 支持 `jpeg` / `png` / `webp` 三种格式
- JPEG 质量映射：`quality(1-100)` → ffmpeg `-q:v(2-25)`，值越低质量越高
- PNG 无损，WebP 用 `-quality` 参数

**调用栈**: `PreviewStage.export()` → `LrcRender.exportImage()` → `lrc:renderLayersToFile` IPC → `render_layers_to_file()`

### 2. `export_file()` — 统一导出入口（旧入口，保留）

```
输入: 源文件路径 + 输出路径 + 画布尺寸 + 视频参数 + 叠加层
```

根据文件后缀自动判断：
- `.png/.jpg/.jpeg/.webp` → `export_image()` 
- 其他（含 `.mp4/.mov/.insv` 等）→ `export_video()`

### 3. `export_image()` — 图片导出

```
输入: ffmpeg路径 / ffprobe路径 / 源图路径 / 输出路径 / 尺寸 / 叠加层
流程: decode_image() → c.load_texture() → c.render() → encode_to_file() → 清理
```

- FFmpeg 解码源图为 RGBA rawvideo
- 上传到 wgpu 纹理
- 渲染 + 叠加层
- 回读像素 → ffmpeg 编码为输出格式 → 写文件
- 用完释放纹理

**局限**: 只支持 1 个主图 + N 个静态叠加层，不支持视频源

### 4. `export_video()` — 视频导出

```
输入: ffmpeg路径 / ffprobe路径 / 源视频路径 / 输出路径 / 尺寸 / 帧率 / 硬件编码 / 叠加层
流程: 
  1. probe_video() 获取视频信息（宽高、帧率、时长）
  2. 创建 ffmpeg decode pipe（逐帧输出 RGBA rawvideo）
  3. 创建 ffmpeg encode pipe（接收 RGBA 帧，编码为 H.264）
  4. 循环:
     dout.read_exact() → c.update_texture() → c.render() → ein.write_all()
  5. 关闭 pipe，清理纹理
```

**关键设计**:
- **双管道并行**: ffmpeg decode → wgpu render → ffmpeg encode，解码和编码解耦
- **逐帧流式**: 不缓存全部帧，保持 GPU 纹理复用，内存 O(1)
- **硬件编码**: macOS → `h264_videotoolbox`，Windows → `h264_nvenc`，其他 → `libx264`
- **码率固定**: `-b:v 12M`，H.264 yuv420p
- **渲染分辨率独立**: 视频解码按原始尺寸，渲染输出按 `canvas_w x canvas_h`（可缩放）
- 每 30 帧输出速度日志

### 5. 辅助函数

| 函数 | 作用 |
|------|------|
| `probe_video()` | ffprobe 探测视频宽高/帧率/时长，结果缓存 |
| `decode_image()` | ffmpeg 解码单张图片为 RGBA（原始尺寸，不做缩放） |
| `load_static_layers()` | 遍历 StaticLayer 列表，逐个 decode + upload wgpu |
| `encode_to_file()` | ffmpeg 编码单帧 RGBA 到图片文件 |
| `choose_encoder()` | 根据平台选择 H.264 硬件编码器 |

---

## 与预览共享的算法

所有导出函数的核心渲染步骤都调用了同一个方法：

```rust
c.render(canvas_width, canvas_height, &layers)
```

即 `Compositor::render()` — 它包含：
- wgpu render pipeline（顶点/片元着色器）
- 纹理采样（线性过滤）
- Alpha 混合（PREMULTIPLIED_ALPHA_BLENDING）
- 逐层渲染（按 z_index 排序）

**预览和导出的差异仅在于**：
| 维度 | 预览 | 导出 |
|------|------|------|
| 分辨率 | ≤ 1440px（受 MAX_RENDER_PX 限制） | 原始媒体分辨率 |
| 输出 | RGBA → JS → canvas | 编码为 JPEG/PNG/H.264 → 磁盘 |
| 加载 | 预览尺度（maxSize=1920） | 原始尺寸 |

---

## 新增导出的步骤（模板）

需要添加新的导出方式时（例如逐帧推送编码）：

1. 在 `export.rs` 实现 `pub fn new_export(...)` 函数
2. 在 `lib.rs` 添加 `#[napi] pub fn export_xxx(...)` 导出
3. 在 `electron/lunaRenderCore.ts` 添加桥接方法
4. 在 `electron/ipcLunaRenderCore.ts` 注册 IPC handler
5. 在 `electron/preload.ts` 的 `lunaRenderCoreApi` 添加方法
