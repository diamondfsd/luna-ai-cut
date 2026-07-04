# Export 模块设计文档 V2

`export.rs` — Rust 内部完成全部加载 + 渲染 + 编码的统一导出入口。

## 设计原则

```text
FFmpeg 负责媒体 I/O（解码/编码/封装/音频）
wgpu 负责画面渲染（合成/缩放/旋转/透明度/水印/调色）
```

不要让 FFmpeg 做视觉逻辑，避免预览和导出两套算法。

---

## 总体架构

```text
JS / React
  │  IPC 调用，只传参数，不传像素
  ▼
Electron Main
  │
  ▼
Rust napi
  │
  ├─ render_layers_to_file()
  │     └─ 已有 GPU 纹理 → wgpu 渲染 → FFmpeg 编码图片
  │
  └─ export_file()
        ├─ export_image()   → FFmpeg 解码图片 → wgpu 渲染 → FFmpeg 编码图片
        └─ export_video()   → FFmpeg 逐帧解码 → wgpu 渲染 → FFmpeg 编码 + 音频封装
```

---

## 核心渲染方法

所有导出路径最终调用同一个合成方法：

```rust
Compositor::render(canvas_width, canvas_height, &layers)
```

| 维度   | 预览                  | 导出                    |
|-------|----------------------|------------------------|
| 渲染核心 | `Compositor::render()` | `Compositor::render()` |
| 输入   | 已加载 GPU 纹理          | 图片/视频解码后上传 GPU        |
| 输出   | RGBA → JS / Canvas   | RGBA → FFmpeg 编码 → 文件 |
| 分辨率  | 预览尺寸 (≤1440px)      | 导出尺寸 (原始分辨率)          |
| 目标   | 实时显示                 | 写入磁盘                  |

---

## 函数说明

### 1. `render_layers_to_file()` — 预览导出入口

GPU 纹理已由 JS 预加载，此函数不做任何文件加载，一次 IPC 完成全部工作。

```
已有 GPU 纹理
  ↓  Compositor::render()
渲染后 RGBA
  ↓  FFmpeg encode image
JPEG/PNG/WebP → 写入磁盘
```

### 2. `export_file()` → `export_image()` / `export_video()`

根据输入文件后缀自动分流。

### 3. `export_image()` — 图片导出

```
源图 → FFmpeg decode RGBA → upload wgpu → Compositor::render() → readback → FFmpeg encode → 文件
```

图片只需 readback 一次，性能压力小。

### 4. `export_video()` — 视频导出（V2 升级）

```
1. ffprobe 探测 → VideoInfo { 宽高/帧率/源码率/音频信息 }
2. detect_h264_encoders() 探测本机可用编码器
3. choose_bitrate() 按分辨率+帧率+源码率+质量预设计算码率
4. 创建 FFmpeg decode pipe（逐帧 RGBA rawvideo）
5. 创建 wgpu 动态纹理（每帧复用）
6. 创建 FFmpeg encode pipe（双输入：pipe:0 视频帧 + 源文件音频）
7. 逐帧循环：read → update_texture → render → write encode stdin
8. 关闭 pipe，检查退出码，清理纹理
```

**每帧处理**：
```rust
decode_pipe.read_exact(frame_rgba)
  → compositor.update_texture(video_texture, frame_rgba)
  → compositor.render(canvas_width, canvas_height, layers)
  → readback(output_rgba)
  → encode_pipe.write_all(output_rgba)
```

---

## V2 新增功能

### 编码器探测

运行时执行 `ffmpeg -hide_banner -encoders`，解析输出中是否包含硬件编码器。

优先级（按平台）：

| macOS | Windows | Linux |
|-------|---------|-------|
| h264_videotoolbox | h264_nvenc | h264_nvenc |
| libx264 | h264_qsv | h264_qsv |
| | h264_amf | h264_vaapi |
| | libx264 | libx264 |

### 码率策略

经验公式：`default_bitrate = (width × height × fps) / 10`，限幅 5Mbps–100Mbps。

质量预设：

| 预设 | 倍数 | 说明 |
|------|------|------|
| Small | default × 0.5 | 适合分享 |
| Standard | default × 1.0 | 平衡体积和画质 |
| High | default × 1.5 | 适合二次编辑 |
| OriginalLike | max(源码率, default) | 尽量接近原视频 |

### 音频处理

FFmpeg 命令使用双输入架构：

```bash
ffmpeg \
  -f rawvideo -pix_fmt rgba -s 1920x1080 -r 30 -i pipe:0 \
  -i input.mp4 \
  -map 0:v:0 -map 1:a:0? \
  -c:v h264_videotoolbox -b:v 20M \
  -pix_fmt yuv420p \
  -c:a copy \
  -shortest \
  output.mp4
```

关键参数：
- `-map 1:a:0?` — 尝试取第一个音频流，没有音频不报错
- `-c:a copy` — 直接复制音频，不重编码
- `-shortest` — 音视频取最短时长

---

## 辅助函数

| 函数 | 作用 |
|------|------|
| `probe_video()` | ffprobe 探测宽高/帧率/时长/码率/音频信息 |
| `detect_h264_encoders()` | 运行时探测可用 H.264 编码器 |
| `choose_encoder()` | 按平台优先级选择最佳可用编码器 |
| `choose_bitrate()` | 按分辨率/帧率/源码率/质量预设计算码率 |
| `default_bitrate()` | 像素 × 帧率经验公式估算码率 |
| `decode_image()` | ffmpeg 解码图片为 RGBA |
| `load_static_layers()` | 加载所有静态叠加层 |
| `encode_to_file()` | 单帧 RGBA → FFmpeg 编码图片 |

---

## 编码器特定参数

| 编码器 | 参数 |
|--------|------|
| libx264 | `-preset veryfast -crf 18` |
| h264_videotoolbox | 仅用 `-b:v` 控制码率 |
| h264_nvenc | `-preset p5 -rc vbr` |
| 其他 (qsv/amf/vaapi) | 无额外参数 |

---

## 第一版暂不做的功能

- 真正 GPU 零拷贝（metal texture → videotoolbox）
- 硬件解码 surface 直接接 wgpu
- 多视频源精确时间线同步
- VFR 时间戳精确保留
- 音频混音 / 多音轨
- 字幕轨
- 动效关键帧 / 转场
- GPU 异步多缓冲流水线
- 取消导出 / 进度回调（留 V3）
- 临时文件 rename 策略
