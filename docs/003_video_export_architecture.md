# 工作台视频导出架构说明

## 当前流程

```
渲染进程（WebGL）                           主进程（Node.js）
──────────────────────                     ──────────────────────

1. 创建隐藏 <video> 元素
   video.src = file://path/to/4K.mp4
  
2. 等待 loadedmetadata
   获取 width, height, duration

3. 通过 ffmpeg 获取帧率
   → IPC requestVideoFrameRate →          ffprobe 解析 r_frame_rate
   ← fps (59.94)

4. video.play()
   RAF 循环（60fps）捕获每帧：
   ┌─────────────────────────────────────┐
   │ renderer.render(pipeline)           │ ← WebGL shader 调色
   │ renderer.readPixelsInto(pixels)     │ ← 从 GPU 读 33MB 像素
   │ Y翻转 (3840×2160×4 → 33MB)          │
   │ sendVideoExportFrame(buf)           │
   │   → IPC invoke ──────────────────→ │ appendFile(.raw 文件)
   └─────────────────────────────────────┘
   视频播放结束 ≈ 捕获 95%+ 帧 (374帧)

5. Seek 补帧（少量漏帧）
   currentTime = frameIndex / fps
   waitForSeeked → render → IPC

6. sendVideoExportFrame                  → appendFile 累加写入
                                          .raw 文件 ≈ 12GB (374×33MB)

7. endVideoExport                        → spawn ffmpeg:
                                          -f rawvideo -pix_fmt rgba
                                          -s 3840x2160 -r 59.94
                                          -i .raw 文件
                                          -c:v h264_videotoolbox
                                          -y .mp4
                                        → 删除 .raw 临时文件
```

## 当前性能瓶颈

### 实测数据（4K 60fps，6秒，374帧）

| 阶段 | 时间 | 说明 |
|------|------|------|
| Phase 1 播放捕获 | ~6秒 | 实时播放速度，躲不开 |
| Phase 2 seek 补帧 | ~1-2秒 | 少量漏帧 |
| Phase 3 ffmpeg 编码 | ~15-30秒 | 12GB raw → H.264 |
| **总计** | **~22-38秒** | 目标是 3秒 |

### 瓶颈分解

```
每帧（播放捕获 + 无 seek）：
  render (WebGL shader)      ~2ms    ← GPU，很快
  readPixels (GPU→CPU)        ~5ms    ← 3840×2160×4=33MB，慢！
  Y 翻转 (JS for 循环)         ~3ms    ← 33MB JS 操作
  IPC invoke (33MB)           ~15-30ms ← Electron 序列化 + 传输
  appendFile (写磁盘)          ~0ms    ← 内核缓冲，几乎不计
  小计:                        ~25-40ms/帧

374帧 × 30ms = ~11秒 纯帧处理时间
6秒 播放时间 躲不开
15-30秒 ffmpeg 编码 12GB raw → mp4
```

## 核心问题

### 1. `readPixels` 太慢

WebGL 的 `gl.readPixels()` 是**同步阻塞**的。GPU 渲染完 → 中断 → 从显存拷回 CPU 内存 → 继续。4K 帧 33MB，这个 GPU→CPU 回读是固定的硬件开销。

**限速因素**：PCIe 带宽（~16GB/s on M系列 Mac）。33MB / 16GB/s ≈ 2ms（理论上限），但加上驱动开销 ≈ 5ms。

### 2. IPC 传输 33MB

每帧 33MB 通过 Electron 的 `ipcRenderer.invoke` 发送。结构化克隆序列化会拷贝数据。实测 ~15-30ms/帧。

**限速因素**：V8 序列化 + IPC 通道带宽。

### 3. temp raw 文件 12GB → H.264 编码

374 帧 × 33MB = 12GB。ffmpeg 从磁盘读 12GB → VideoToolbox 编码 → 写 mp4。

**限速因素**：
- 磁盘读写：12GB 连续读写 ≈ 1-2秒（NVMe SSD）
- VideoToolbox 编码器吞吐：4K 60fps ≈ 实际需要 1-2x 实时编码能力
- **更大问题**：rawvideo 是未压缩的，ffmpeg 要从 RGBA 转 YUV420P，再做编码

### 4. `playbackRate` 未利用

当前用 `video.play()` 以 1x 速度播放。如果设置 `video.playbackRate = 2`，播放时间从 6秒降到 3秒。但是 RAF 捕获可能跟不上。

## 优化方向（需评估）

### 方向 A：跳过 IPC 和 temp file，用进程间共享内存

在 Electron 中，主进程和渲染进程之间可以通过 **SharedArrayBuffer** 共享内存。渲染进程写 → 主进程读，零拷贝。

```
渲染进程写 SharedArrayBuffer（WebGL → readPixels → 共享内存）
主进程读 SharedArrayBuffer → ffmpeg 编码
```

**挑战**：
- Electron 需要设置 `crossOriginIsolated`（影响 CORS）
- SharedArrayBuffer 大小有限（Chrome 默认 2GB，12GB raw 需要分块）
- 需要同步机制（Atomics）

### 方向 B：使用 OffscreenCanvas + Worker

把 WebGL context **移到 Worker 线程**，`readPixels` 不会阻塞主线程 UI。

```
主线程：seek video → createImageBitmap(bitmap) → postMessage → Worker
Worker：WebGL shader → readPixels → postMessage → 主线程
主线程：IPC 发到主进程 → appendFile
```

**挑战**：
- `createImageBitmap(video)` 在 Worker 中有限制
- Worker 内的 WebGL context 创建需要 `OffscreenCanvas.transferControlToOffscreen`
- Worker 不能直接访问 DOM video 元素

### 方向 C：主进程直接用 ffmpeg 滤镜（回到 ffmpeg 方案）

主进程：
```
ffmpeg -i source.mp4
  -vf "eq=exposure=...:brightness=...:...,colorbalance=..."
  -c:v h264_videotoolbox
  -y output.mp4
```

**优势**：
- 全部在主进程，无需 IPC
- ffmpeg filter chain 经过多年优化
- 硬件解码 + 硬件编码一条龙
- 不产生 12GB temp file

**劣势**：
- 之前弃用是因为 ffmpeg 的调色算法和预览（darktable WebGL）不一致
- WebGL 预览效果和 ffmpeg 导出效果不一样

**重新评估**：如果放弃"预览必须等于导出"，或者未来统一到同一个数学公式层，可以用 ffmpeg 导出，速度最快。

### 方向 D：放弃 RGBA，改用更紧凑的像素格式

当前每帧 RGBA (4字节/像素)。如果可以：
- RGB (3字节/像素) → 25MB/帧，省 25%
- NV12 (1.5字节/像素) → 12.5MB/帧，省 62%
- 直接 GPU 编码器输入格式（如 Metal 的 CVPixelBuffer）

**挑战**：
- `readPixels` 只支持 RGBA
- 软件转格式比 IPC 传输还慢
- 需要直接操作 GPU 编码器管线

### 方向 E：Metal 直接编码（macOS 专用）

绕过 WebGL，直接用 Metal compute shader 做调色，然后直接传给 VideoToolbox 编码器。

```
Metal 调色 shader → CVPixelBuffer → VideoToolbox 编码 → .mp4
（全程 GPU，零 CPU 拷贝）
```

**挑战**：
- 需要原生 macOS 开发（Swift/ObjC），不能用 Web 技术栈
- 需要编写 Metal shader（当前是 GLSL）
- Electron 中集成需要 native addon

## 当前参数

- 视频：4K (3840×2160), 59.94fps, 6.24秒, 374帧
- 单帧大小：3840×2160×4 = 33,177,600 bytes (≈33MB)
- 原始帧格式：RGBA, UNSIGNED_BYTE
- 临时文件：~12GB raw → 编码为 H.264 mp4
- 编码器：`h264_videotoolbox`（macOS 硬件编码），`-realtime 1`
- 编码输出：yuv420p
- 帧率：59.94
