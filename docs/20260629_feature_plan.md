# 工作台功能规划

> 日期：2026-06-29
> 目标：为 Luna AI Cut 新增「工作台」模块，聚合所有图片/视频后期处理功能

---

## 一、背景

当前 Luna AI Cut 的核心流程是 **连接相机 → 浏览媒体 → 下载 → 导出（水印/转码）**，是一个纯媒体管理工具。

用户在使用过程中产生了对媒体文件进一步编辑处理的需求，包括调色、滤镜、美颜、模板合成等。这些功能不适合放在「浏览/下载」流程中，需要独立的工作台模块承载。

**工作台定位**：用户从媒体库选择素材后，在工作台中进行二次编辑处理，处理后导出或保存。

```
媒体库浏览 → 选择素材 → 工作台编辑 → 导出/保存
```

---

## 二、功能全景

| # | 功能 | 简要描述 | 难度 | 依赖 |
|---|------|---------|------|------|
| A | 更多设备水印 + 本地模板 | 扩展水印样式，支持用户上传自定义水印图片 | ★☆☆☆☆ | 无（基于现有水印系统） |
| B | 统一编辑流水线（Transform → Color → Effects） | 裁剪/旋转/翻转/缩放 + 调色 + 锐化/暗角 | ★★☆☆☆ | WebGL / Canvas / libvips |
| C | LUT 滤镜 | 加载 .cube LUT 文件，应用到图片和视频 | ★★★☆☆ | WebGL / ffmpeg |
| D | 更多照片模板 | 多图排版、边框、文字、背景合成 | ★★★★☆ | Canvas 合成引擎 |
| E | Live 图片多图拼接 | 多个 Live Photo 的视频轨道拼接成一段视频 | ★★★★☆ | ffmpeg concat |
| F | 人像美颜 | AI 皮肤分割 mask + shader 混合磨皮/美白 | ★★★★☆ | ONNX Runtime Web + WebGL |

---

## 三、难度排序（从易到难）

### 1. 🥇 更多设备水印 + 本地模板 \[A\]

**难度**：★☆☆☆☆

**工作内容**：

- **1.1 本地水印模板系统**
  - 在设置页增加「本地水印」配置区
  - 用户通过文件选择器上传 PNG 图片作为自定义水印
  - 将水印图片拷贝到应用数据目录（`userData/watermark-custom/`）
  - 支持上传后预览、删除、重命名
  - 导出时水印选择器中展示「本地模板」分组

- **1.2 更多设备水印**
  - 在 `deviceConfigs/` 中为 `luna-ultra.json` 添加更多水印样式配置
  - 设计 2-3 种新水印样式（如极简、复古、日期戳）
  - 增加水印透明度控制（目前只有大小和位置）

**涉及文件**：

| 文件 | 改动 |
|------|------|
| `electron/settingsService.ts` | 新增水印模板存储字段 |
| `electron/appMain.ts` | 新增自定义水印 IPC（上传、列表、删除） |
| `electron/preload.ts` | 暴露新 IPC |
| `electron/watermarkService.ts` | 加载自定义水印图片 |
| `src/components/WatermarkSettings.tsx` | 增加本地模板选择 + 透明度滑块 |
| `src/components/WatermarkOverlay.tsx` | 支持透明度渲染 |
| `src/shared/types.ts` | 新增自定义水印类型 |
| `src/pages/SettingsPage.tsx` | 水印管理面板 |

**预估工时**：2-3 天

---

### 2. 🥈 统一编辑流水线 — 图片编辑核心 \[B\]

**难度**：★★☆☆☆

这是工作台最核心的能力。不是做一个独立的「调色工具」，而是设计一套 **统一的非破坏性编辑流水线（Edit Pipeline）**，让裁剪、旋转、调色、LUT、水印都在同一套架构里，且图片和视频共享同一套参数模型。

---

#### 2.1 核心设计理念

```
非破坏性编辑（Non-destructive Editing）
  ├── 不修改原图
  ├── 不生成中间图片
  ├── 不重复压缩
  └── 只维护一个编辑状态对象
```

整个流水线按顺序固定为三个阶段：

```
原图（Original）→  Transform（几何变换）→  Color（颜色调整）→  Effects（效果）→  Beautify（美颜）→  Preview/Export
```

每个阶段在 WebGL shader 中串联为一次 GPU pass：

```
Texture（预览图纹理）
   │
   ▼  Transform Stage（几何变换）
   ├── Crop          → UV 坐标裁剪（不生成新图）
   ├── Rotate        → 旋转矩阵（model matrix）
   ├── Flip H/V      → 翻转矩阵
   └── Scale         → 缩放矩阵
   │
   ▼  Color Stage（颜色调整）
   ├── Exposure      → shader uniform
   ├── Contrast      → shader uniform
   ├── Saturation    → shader uniform
   ├── Temperature   → shader uniform
   ├── Tint          → shader uniform
   ├── Highlights    → shader uniform
   ├── Shadows       → shader uniform
   ├── Vibrance      → shader uniform
   ├── Curve         → shader uniform（lut texture）
   └── LUT           → 3D LUT texture lookup
   │
   ▼  Effects Stage（效果）
   ├── Sharpen       → 卷积核 uniform
   ├── Vignette      → shader uniform
   └── Grain         → shader uniform
   │
   ▼  Beautify Stage（美颜）
   ├── 输入：maskTexture（皮肤分割图，Web Worker 异步生成）
   ├── Smooth        → 局部模糊，mask 内生效
   ├── Whiten        → 肤色提亮，mask 内生效
   ├── Clarity       → 局部对比度，mask 内生效
   └── blend = mix(original, beautified, mask * intensity)
   │
   ▼  Watermark Overlay（可选）
   │
   ▼  Preview（屏幕） / Export（文件）
```

**关键原则**：用户拖动任何一个参数，只改变 shader 中的一个 uniform 值，GPU 自动重绘，**不需要重新上传纹理、不需要生成中间图片**。

---

#### 2.2 编辑状态模型（EditPipeline）

图片和视频共享同一套编辑参数模型：

```ts
interface EditPipeline {
  // 几何变换
  transform: {
    crop: { x: number; y: number; width: number; height: number } | null  // 归一化 0-1
    rotate: number        // 角度，0-360
    flipH: boolean
    flipV: boolean
    scale: number         // 缩放比例，默认 1.0
  }

  // 颜色调整
  color: {
    exposure: number      // -5 ~ +5 EV
    contrast: number      // -100 ~ +100
    saturation: number    // -100 ~ +100
    vibrance: number      // -100 ~ +100（自然饱和度）
    temperature: number   // -100 ~ +100
    tint: number          // -100 ~ +100
    highlights: number    // -100 ~ +100
    shadows: number       // -100 ~ +100
    whites: number        // -100 ~ +100
    blacks: number        // -100 ~ +100
    clarity: number       // -100 ~ +100（清晰度）
    dehaze: number        // -100 ~ +100（去雾）
    curve: number[] | null // 色调曲线，二期
  }

  // 效果
  effects: {
    sharpen: number       // 0 ~ 100
    blur: number          // 0 ~ 100
    vignette: number      // 0 ~ 100（暗角）
    grain: number         // 0 ~ 100（颗粒）
  }

  // LUT
  lut: {
    enabled: boolean
    filePath: string | null   // .cube 文件路径
    intensity: number         // 0 ~ 100
  }

  // 美颜
  beautify: {
    enabled: boolean
    maskGenerated: boolean    // 是否已生成 skin mask（异步状态）
    smooth: number            // 0 ~ 100 磨皮强度
    whiten: number            // 0 ~ 100 美白强度
    clarity: number           // 0 ~ 100 清晰度增强
    warmth: number            // -50 ~ +50 肤色冷暖
  }

  // 水印（复用现有系统）
  watermark?: WatermarkConfig
}
```

> **图片 vs 视频**：同一套 `EditPipeline` 对象。图片导出时传给 `sharp`，视频导出时映射为 ffmpeg 滤镜链。UI 控件完全复用。

---

#### 2.3 多级缓存架构

导入素材时立即生成三级缓存：

```
原图 (Original)     ≈ 8000×6000     — 仅用于最终导出
  ↓ OffscreenCanvas (Worker) 降采样
Preview 图           ≈ 1500×1000    — 上传为 WebGL texture，全部实时编辑基于此
  ↓ OffscreenCanvas (Worker) 降采样
Thumbnail 缩略图      ≈ 300×200      — 素材列表、工具图标
```

- Preview 图固定 **长边 1500px**（~0.7MP），确保 GPU 纹理上传和 shader 计算都在毫秒级
- 降采样在 Web Worker 中用 OffscreenCanvas 完成，不阻塞主线程
- 缓存写入 IndexedDB 或应用 cache 目录，下次打开直接复用

---

#### 2.4 WebGL 渲染管线

```
Preview 图 → WebGLTexture → 一次 pass（Transform → Color → Effects）→ Display
```

- Preview 图上传为 `WebGLTexture`
- Transform = model matrix 变化，geometry 重绘
- Color + Effects = fragment shader uniform 变化
- **所有阶段一次 pass**：`texture → transform → color → effects → output`
- requestAnimationFrame 驱动，天然限在 60fps

**GPU 可用性检测**（工作台启动时检测一次，不支持则禁用编辑功能）：

```ts
const { webgl, gpu_compositing } = app.getGPUFeatureStatus()
const webglAvailable = webgl === 'enabled' && gpu_compositing === 'enabled'
// webglAvailable === false → 提示"当前设备不支持 GPU 渲染，无法使用工作台"
```

> **为什么不做回退？** Chromium 在 99% 设备上 GPU 渲染都是 enabled 状态。余下 1%（远程桌面、老旧驱动、企业策略禁用）直接提示用户当前环境不支持工作台功能，避免维护三条渲染路径的复杂度和测试成本。

---

#### 2.5 交互优化

| 机制 | 实现 |
|------|------|
| **拖动防抖** | requestAnimationFrame 节流，~16ms/帧（60fps） |
| **原图对比** | 按住空格键/触摸长按 → 临时移除所有参数 → 显示原图 |
| **稳定重算** | 停止拖动 300ms 后触发高质量 Preview 图重渲染 |
| **撤销/重做** | `EditPipeline` 快照栈（最多 50 步），每次参数变化压栈 |
| **重置** | 清除 `EditPipeline` 全部字段为默认值 |

---

#### 2.6 导出管线（统一后端）

```
图片导出                                      视频导出
Original + EditPipeline                       Original Video + EditPipeline
       │                                              │
       ▼                                              ▼
   sharp (libvips)                               ffmpeg
   ├── crop + rotate + flip                      ├── crop (crop filter)
   ├── exposure + contrast + ...                 ├── exposure (eq filter)
   ├── sharpen + vignette                        ├── sharpen (unsharp filter)
   ├── LUT 3D                                    ├── lut3d filter
   ├── watermark overlay                         ├── watermark (overlay filter)
   └── JPEG/PNG/TIFF                             └── H.264/H.265/ProRes
```

- **图片**：导出使用主进程 `sharp`，加载原图 + `EditPipeline` 参数一次性处理
  - 不经过 WebGL，避免精度损失
  - 支持叠加水印（复用 `watermarkService.ts`）
  - 可选保留 EXIF 数据
- **视频**：导出使用 ffmpeg，将 `EditPipeline` 映射为 ffmpeg 滤镜链
  - 复用现有 `videoPipelineService.ts` + 新增滤镜模块
  - 支持硬件编码加速（已有）

---

#### 2.7 涉及文件

| 文件 | 改动 |
|------|------|
| `src/shared/editPipeline.ts` | **新建** — `EditPipeline` 类型定义 + 默认值 + 序列化 |
| `src/pages/WorkspacePage.tsx` | 新建 — 工作台页面框架 |
| `src/workspace/shared/` | 新建 — 工作台共享模块（缓存、历史栈、GPU 检测） |
| `src/workspace/renderer/` | **新建** — WebGL 渲染引擎 |
| `src/workspace/renderer/webglRenderer.ts` | WebGL 渲染管线（纹理上传 → shader → 显示） |
| `src/workspace/renderer/shaders/` | fragment shader：transform.glsl, color.glsl, effects.glsl, pipeline.glsl |
| `src/workspace/transform/` | 新建 — 几何变换工具面板 + 裁剪交互组件 |
| `src/workspace/color/` | 新建 — 颜色调整面板 + 参数控件 |
| `src/workspace/effects/` | 新建 — 效果面板 |
| `src/lib/imageCache.ts` | 新建 — 多级图片缓存管理 |
| `electron/imageProcessor.ts` | **新建** — 服务端图片处理（接收 EditPipeline + 原图 → sharp 导出） |
| `electron/appMain.ts` | 新增 IPC（图片处理、缓存管理等） |
| `electron/preload.ts` | 暴露新 IPC |
| `src/routes/AppRoutes.tsx` | 新增 `/workspace` 路由 |
| `src/components/AppNav.tsx` | 新增「工作台」导航项 |
| `src/components/MediaLibraryToolbar.tsx` | 新增「发送到工作台」按钮 |

**预估工时**：6-8 天（含 WebGL shader 开发 + 裁剪交互 + 缓存 + sharp 导出）

---

#### 2.8 完整架构总览

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Renderer Process                              │
│                                                                      │
│  ┌──────────┐   ┌──────────────────────────────────────────────┐    │
│  │ 素材列表   │   │                 WebGL Canvas                   │    │
│  │ ┌──────┐ │   │                                               │    │
│  │ │缩略图 │ │   │  Texture (Preview 图)                         │    │
│  │ ├──────┤ │   │     │                                          │    │
│  │ │缩略图 │ │   │     ▼ Fragment Shader (一次 pass)              │    │
│  │ └──────┘ │   │  ┌─────────────────────────────────┐          │    │
│  └──────────┘   │  │ Transform → Color → Effects     │          │    │
│                 │  │ (model matrix + uniforms)        │          │    │
│  ┌──────────┐   │  └─────────────────────────────────┘          │    │
│  │ 参数面板  │   │     │                                          │    │
│  │ 裁剪旋转  │   │     ▼ Display                                  │    │
│  │ 曝光     │   │                                               │    │
│  │ 对比度   │   │  EditPipeline 对象 ←── 用户操作修改参数           │    │
│  │ LUT     │   │  { transform, color, effects, lut }            │    │
│  └──────────┘   └──────────────────────────────────────────────┘    │
└──────────────────────────┬───────────────────────────────────────────┘
                           │ IPC: EditPipeline + 操作信号
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         Main Process                                  │
│                                                                      │
│  ┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐    │
│  │ ImageCache   │    │ imageProcessor   │    │ videoPipeline    │    │
│  │ (sharp       │    │ (sharp +         │    │ (ffmpeg +        │    │
│  │  降采样)     │    │  EditPipeline)   │    │  EditPipeline)   │    │
│  └──────────────┘    └──────────────────┘    └──────────────────┘    │
│                            │                          │              │
│                            ▼                          ▼              │
│                     JPEG/PNG/TIFF              MP4/MOV/ProRes        │
└──────────────────────────────────────────────────────────────────────┘
```

---

### 3. 🥉 LUT 滤镜功能 \[C\]

**难度**：★★★☆☆

LUT 作为统一 `EditPipeline` 的 `lut` 字段接入，与调色共享同一套渲染管线。

**工作内容**：

- **3.1 LUT 文件管理**
  - 支持 `.cube` 格式（1D 和 3D LUT）的解析
  - 内建一组预设 LUT（5-10 个经典风格：胶片、暖阳、冷调、黑白、复古等）
  - 用户可导入自定义 `.cube` 文件
  - 在 `userData/luts/` 目录存储用户自定义 LUT

- **3.2 LUT 渲染集成**
  - LUT 作为 WebGL fragment shader 中的 3D LUT texture lookup，与 Color 阶段串联：
    ```
    ... → color stage → 3D LUT lookup → effects stage → ...
    ```
  - 回退方案：Canvas ImageData 逐像素查表
  - 在 `EditPipeline.lut` 中控制 `enabled`、`filePath`、`intensity`

- **3.3 视频 LUT**
  - ffmpeg `lut3d` 滤镜接入 `videoPipelineService.ts`
  - 导出时将 `EditPipeline.lut` 映射为 ffmpeg 参数

**涉及文件**：

| 文件 | 改动 |
|------|------|
| `src/workspace/renderer/shaders/lut.glsl` | 新建 — 3D LUT lookup shader |
| `src/lib/lutParser.ts` | 新建 — .cube 文件解析器 |
| `src/workspace/lut/LutSelector.tsx` | 新建 — LUT 选择面板 |
| `src/assets/luts/` | 新建 — 内建 LUT 文件目录 |
| `electron/appMain.ts` | 新增 LUT 管理 IPC |
| `electron/preload.ts` | 暴露 LUT IPC |
| `electron/ffmpeg/lut.ts` | 新建 — ffmpeg LUT 模块 |

**预估工时**：4-5 天

---

### 4. 更多照片模板支持 \[D\]

**难度**：★★★★☆

**工作内容**：

- **4.1 模板格式定义**
  - 设计基于 JSON 的模板描述文件格式：
    - 画布尺寸（宽 x 高）
    - 图层列表（图片层、文字层、形状层、背景层）
    - 每层位置、大小、旋转、混合模式
    - 预设滤镜/调色参数
    - 文字层：字体、颜色、对齐、阴影

- **4.2 模板渲染引擎**
  - 使用 Canvas 合成多图层
  - 支持：缩放裁剪（cover/contain）、圆角、边框、阴影
  - 支持文字渲染（英文 + 中文）
  - 模板预览缩略图生成

- **4.3 内建模板集**
  - 设计 5-8 个通用照片模板（旅行、拼图、生日、节日等）

- **4.4 模板管理 UI**
  - 模板选择器（网格展示缩略图）
  - 模板编辑（替换图片槽位、编辑文字内容）
  - 导出合成结果

**涉及文件**：

| 文件 | 改动 |
|------|------|
| `src/shared/template/` | 新建 - 模板类型定义 |
| `src/lib/templateRenderer.ts` | 新建 - 模板渲染引擎 |
| `src/components/TemplateSelector.tsx` | 新建 - 模板选择器 |
| `src/components/TemplateEditor.tsx` | 新建 - 模板编辑面板 |
| `src/assets/templates/` | 新建 - 模板 JSON + 资源文件 |
| `electron/appMain.ts` | 新增模板资源加载 IPC |

**预估工时**：5-7 天

---

### 5. Live 图片多图拼接 \[E\]

**难度**：★★★★☆

**工作内容**：

- **5.1 Live Photo 视频提取**
  - 利用现有 `extractLivePhotoVideo()` 功能提取多个 Live Photo 的视频轨道
  - 将提取的视频暂存到临时目录

- **5.2 视频拼接**
  - 使用 ffmpeg concat demuxer 或 `concat` 滤镜拼接多个视频片段
  - 支持简单转场效果（交叉淡入淡出、溶解、滑动）
  - 可选：拼接后的视频重新与某个静态帧合并为新的 Live Photo

- **5.3 拼接 UI**
  - 选择多个 Live Photo 素材
  - 拖拽排序
  - 转场效果选择
  - 预览拼接结果
  - 导出为视频或 Live Photo

**涉及文件**：

| 文件 | 改动 |
|------|------|
| `src/components/LiveStitchPanel.tsx` | 新建 - 拼接工作面板 |
| `electron/ffmpeg/concat.ts` | 新建 - ffmpeg 拼接模块 |
| `electron/ffmpeg/transitions.ts` | 新建 - 转场效果模块 |
| `electron/appMain.ts` | 新增拼接 IPC |
| `electron/preload.ts` | 暴露拼接 IPC |

**预估工时**：5-6 天

---

### 6. 🥉 人像美颜功能 \[F\]（整合进 Pipeline）

**难度**：★★★★☆

> 详细设计见独立文档：[20260629_beautify_module.md](./20260629_beautify_module.md)

**一句话**：使用 **SCRFD（人脸检测）→ 106 Landmark（关键点）→ BiSeNet（语义分割）** 三步 AI 流水线生成皮肤 mask，在 WebGL shader 中做 mask-guided blend，整合进 EditPipeline 的 Beautify Stage。

**技术栈**：

| 环节 | 技术 |
|------|------|
| AI 推理 | ONNX Runtime Web（CPU Worker） |
| 人脸检测 | SCRFD_2.5G |
| 关键点 | InsightFace 2D106 Landmark |
| 语义分割 | BiSeNet Face Parsing |
| 实时预览 | WebGL fragment shader（mask blend） |
| 导出 | WebGL readPixels / Canvas 2D |

**工作流**：

```
Preview 图 → Web Worker → SCRFD(人脸框) → BiSeNet(Skin Mask) → maskTexture → GPU
                                                                         ↓
                                                              Beautify Shader: mix(color, beautified, mask * intensity)
```

- 推理只在切换素材时跑一次（~120ms），后续调参只需改 shader uniform
- 嵌入 pipeline 位置：`Color → Beautify → Effects → Watermark`

**涉及文件**（详见独立文档）：

| 文件 | 说明 |
|------|------|
| `src/workspace/beautify/` | 美颜模块目录 |
| `src/workspace/beautify/skinMaskWorker.ts` | Web Worker 推理入口 |
| `src/workspace/renderer/shaders/beautify.glsl` | 美颜 shader |
| `public/models/*.onnx` | 三个 ONNX 模型文件（~10MB） |

**预估工时**：6-8 天

---

## 四、工作台页面布局设计

采用统一的三栏布局，所有编辑参数集成在同一个右侧面板中（不分 Tab 切换）：

```
┌──────────────────────────────────────────────────────┐
│  工作台  │  素材列表  │  导出   │  设置  │  ← 导航栏  │
├──────────┬────────────┬──────────────────────────────┤
│          │            │                              │
│ 素材缩略图│   WebGL    │      参数面板                │
│ 列表      │   Canvas   │  ┌────────────────────┐     │
│ ┌──────┐ │   (预览)   │  │  Transform          │     │
│ │      │ │            │  │  ├─ 裁剪 (拖拽框选)  │     │
│ │      │ │  一次 pass  │  │  ├─ 旋转 (滑块)     │     │
│ │      │ │  Transform │  │  ├─ 翻转 (按钮)     │     │
│ │      │ │  → Color   │  │  └─ 缩放            │     │
│ │      │ │  → Effects │  ├────────────────────┤     │
│ │      │ │  → Display │  │  Color              │     │
│ │      │ │            │  │  ├─ 曝光 +++++++++++│     │
│ │      │ │  对比视图  │  │  ├─ 对比度 +++++++++│     │
│ │      │ │  (空格键)  │  │  ├─ 饱和度 ++++++++ │     │
│ │      │ │            │  │  ├─ 色温 ++++++++   │     │
│ └──────┘ │            │  │  └─ ...             │     │
│          │            │  ├────────────────────┤     │
│          │            │  │  LUT / 效果 / 水印 │     │
│          │            │  └────────────────────┘     │
├──────────┴────────────┴──────────────────────────────┤
│  底部工具栏: [撤销↶] [重置] [原图对比] [保存] [导出]  │
└──────────────────────────────────────────────────────┘
```

**核心交互逻辑**：

- 左侧 **素材列表**：显示当前工作台中的素材缩略图，支持多选后批量处理
- 中央 **WebGL Canvas**：实时预览区域，所有编辑效果（Transform → Color → Effects → Watermark）在一次 GPU pass 中完成
- 右侧 **参数面板**：垂直滚动表单，按 Transform / Color / Effects / Beautify / LUT / 水印 分组，可折叠展开
- 底部 **工具栏**：撤销/重做（50步快照栈）、重置、原图对比（空格键按住）、保存修改、导出

> **设计决策：为什么不分 Tab 切换工具？**
> 因为所有参数都是 `EditPipeline` 的一部分，用户可能同时调整裁剪 + 曝光 + LUT，Tab 切换会让体验割裂。改为**参数面板垂直滚动 + 分组折叠**，所有参数一目了然，接近 Lightroom 的交互模式。

---

## 五、分阶段实施路线图

### Phase 1 — 基础建设（2-3 天）

| 步骤 | 内容 |
|------|------|
| 1.1 | 新建 `WorkspacePage` 页面框架 + 三栏布局 |
| 1.2 | 注册 `/workspace` 路由，添加到导航栏 |
| 1.3 | 在本地资源页面添加「发送到工作台」功能 |
| 1.4 | 素材选择 + 传入工作台的 IPC 通道 |

### Phase 2 — 编辑流水线 + 水印扩展（8-10 天）

| 步骤 | 内容 |
|------|------|
| 2.1 | `shared/editPipeline.ts` — EditPipeline 类型定义 + 默认值 + 序列化/反序列化 |
| 2.2 | 多级缓存系统 `imageCache.ts` — OffscreenCanvas Worker 降采样 |
| 2.3 | WebGL 渲染引擎 — texture 上传 + 一次 pass shader（transform→color→effects） |
| 2.4 | Canvas 2D / sharp 回退渲染器 |
| 2.5 | Transform 交互 — 裁剪拖拽框选、旋转滑块、翻转按钮、缩放 |
| 2.6 | Color 面板 — 所有调色滑块控件 + 原图对比 |
| 2.7 | 撤销/重做快照栈（50步） |
| 2.8 | sharp 导出管线 — Original + EditPipeline → JPEG/PNG/TIFF |
| 2.9 | 自定义水印上传管理 + 透明度控制 + 更多设备水印样式 |

### Phase 3 — LUT 滤镜（4-5 天）

| 步骤 | 内容 |
|------|------|
| 3.1 | `.cube` 文件解析器 + 内建 LUT 预设（5-10 个） |
| 3.2 | LUT 3D texture lookup shader（集成到渲染管线） |
| 3.3 | LUT 选择 UI + 用户导入管理 |
| 3.4 | ffmpeg lut3d 视频导出模块 |

### Phase 4 — 照片模板（5-7 天）

| 步骤 | 内容 |
|------|------|
| 4.1 | 模板格式定义 + 渲染引擎 |
| 4.2 | 内建模板制作 |
| 4.3 | 模板选择 + 编辑 UI |

### Phase 5 — Live 拼接（5-6 天）

| 步骤 | 内容 |
|------|------|
| 5.1 | Live Photo 视频提取 |
| 5.2 | ffmpeg 拼接 + 转场 |
| 5.3 | 拼接 UI + 预览 + 导出 |

### Phase 6 — 美颜（6-8 天）

| 步骤 | 内容 |
|------|------|
| 6.1 | 模型选型 + Worker 推理框架搭建 |
| 6.2 | mask 生成管线（ONNX Runtime Web + MediaPipe Selfie） |
| 6.3 | beautify shader + shader blend 集成 pipeline |
| 6.4 | 导出方案（WebGL readPixels / Canvas 混合） |

---

## 六、技术选型建议

### 图像处理方案对比

| 技术方案 | 适用场景 | 性能 | 精度 | 包体积 | 复杂度 |
|----------|---------|------|------|--------|--------|
| WebGL2 fragment shader | 调色/LUT 实时预览 | 极高（GPU 并行） | 高（浮点精度） | 0 | 中 |
| Canvas 2D ImageData | 调色回退/模板合成 | 中（CPU） | 高 | 0 | 低 |
| CSS filter | 快速预览 | 极高（GPU） | 低（只支持标准滤镜） | 0 | 极低 |
| Worker + sharp (libvips) | 导出/CPU 回退 | 高（C++ 原生） | 极高 | ~8MB（sharp 原生绑定） | 低（封装） |
| FFmpeg | 视频滤镜/LUT/拼接 | 高 | 高 | 已有 | 低（封装） |
| WebGL fragment shader | LUT 图片预览 | 极高 | 高 | 0 | 中 |
| TensorFlow.js | AI 美颜/分割 | 中（GPU） | 极高 | ~5-10MB | 高 |

### 推荐方案组合

```
图片导入:           OffscreenCanvas (Worker) 降采样 → 三级缓存
编辑预览:           WebGL2 fragment shader（一次 pass：Transform → Color → Effects）
GPU 检测:           app.getGPUFeatureStatus() — 不支持则提示不可用
图片导出:           sharp (libvips) + Original + EditPipeline → JPEG/PNG/TIFF
视频导出:           ffmpeg + EditPipeline 映射为滤镜链
LUT 预览/导出:      3D LUT texture lookup（集成到 shader pipeline）/ ffmpeg lut3d
照片模板:           Canvas 2D 多图层合成
视频拼接:           ffmpeg concat + transitions
美颜:               Canvas + Web Worker（降采样），可选 TensorFlow.js
撤销/重做:          EditPipeline 快照栈（50步）
```

### 新增依赖预估

| 功能 | 新增 npm 包 | 原因 |
|------|------------|------|
| 调色 | `sharp` ^0.33 | Electron 主进程图片处理引擎（libvips 绑定），用于导出 + CPU 回退 |
| LUT | 无 | WebGL shader 自研 + ffmpeg 复用 |
| 水印 | 无 | 现有系统扩展 |
| 模板 | 无 | Canvas 合成 + sharp 导出 |
| 拼接 | 无 | ffmpeg 封装 |
| 美颜 | 待定 | 取决于方案选型 |

> **关于 sharp**：sharp 是 Node.js 生态中最成熟的图片处理库，底层绑定 libvips C 库，
> 支持图片缩放、色彩空间转换、逐像素运算、格式转换等。在 Electron 项目中使用广泛，
> 包体积约 8MB（含 libvips 原生二进制），需要针对目标平台单独编译（electron-rebuild）。

---

## 七、风险和注意事项

1. **GPU 可用性检测**：几乎所有设备都有 GPU，但远程桌面、老旧驱动、企业安全策略可能禁用 GPU。启动工作台时应通过 `app.getGPUFeatureStatus()` 检测 webgl / gpu_compositing 状态，选择对应的渲染路径。检测结果缓存在内存中，无需每次操作都查询。

2. **不要处理原图**：Insta360 相机产出 8000 万像素照片（约 8000×6000），加载到 Canvas 内存占用 >180MB。所有实时编辑操作都作用于 Preview 图（长边 1500px，~0.7MP），只有导出时才加载原图。拖动滑块期间增加 requestAnimationFrame 防抖（~16ms 帧率控制），避免每 1px 移动都重算。

3. **sharp 原生编译**：sharp 依赖 libvips C++ 原生库，在 Electron 中需要使用 `@electron/rebuild` 重新编译。在 CI 打包时需注意平台架构匹配（macOS arm64 / macOS x64 / Windows x64）。如果不愿承担 native 依赖，可替换为纯 JS 方案（如 `jimp`），但性能差 10-50 倍。

4. **WebGL 精度**：WebGL fragment shader 中调色计算使用 `mediump` 精度即可满足预览需求。导出时不走 WebGL，而是将同一套参数传给 sharp 处理原图，保证效果一致性。

5. **美颜效果预期管理**：AI 美颜效果依赖模型质量。建议第一阶段实现基于传统图像处理的磨皮（双边滤波 + 高斯模糊），AI 美颜作为二期增强。

6. **模板格式兼容**：模板格式设计时考虑未来可扩展性，类似 Figma 的 JSON 描述结构。

7. **工作台与现有流程的衔接**：工作台不应打断「浏览 → 下载 → 导出」的主流程，作为可选功能存在。用户从本地资源页面对素材「右键 → 发送到工作台」进入。

8. **图片/视频参数统一**：`EditPipeline` 对象同时用于图片和视频。图片导出交给 `sharp`，视频导出映射为 ffmpeg 滤镜链。同一组参数在不同的输出媒介上效果一致，UI 控件完全复用，无需维护两套编辑逻辑。

9. **文件组织**：建议按功能模块 + 共享核心组织：

```
src/
├── pages/WorkspacePage.tsx            # 工作台页面框架
├── workspace/
│   ├── shared/                        # 工作台共享模块
│   │   ├── editPipeline.ts              # EditPipeline 类型 + 默认值 + 序列化
│   │   ├── editHistory.ts               # 撤销/重做快照栈
│   │   └── imageCache.ts                # 多级缓存管理
│   ├── renderer/                      # 渲染引擎
│   │   ├── webglRenderer.ts             # WebGL 渲染管线（核心）
│   │   └── shaders/                     # GLSL shader 源码
│   │       ├── pipeline.glsl              # 主管线（串联三阶段）
│   │       ├── transform.glsl             # 几何变换
│   │       ├── color.glsl                 # 颜色调整
│   │       ├── effects.glsl               # 效果
│   │       └── lut.glsl                   # 3D LUT lookup
│   ├── transform/                     # 几何变换工具
│   │   ├── TransformPanel.tsx
│   │   └── CropOverlay.tsx
│   ├── color/                         # 颜色调整工具
│   │   └── ColorPanel.tsx
│   ├── effects/                       # 效果工具
│   │   └── EffectsPanel.tsx
│   ├── lut/                           # LUT 工具
│   │   └── LutSelector.tsx
│   ├── beautify/                      # 美颜工具
│   │   └── BeautifyPanel.tsx
│   └── stitch/                        # Live 拼接工具
│       └── LiveStitchPanel.tsx
├── lib/
│   ├── lutParser.ts                   # .cube 文件解析（可被复用）
│   └── templateRenderer.ts           # 模板渲染
└── assets/
    └── luts/                          # 内建 LUT 文件
```

7. **图片/视频参数统一**：`EditPipeline` 对象同时用于图片和视频。图片导出交给 `sharp`，视频导出映射为 ffmpeg 滤镜链。同一组参数在不同的输出媒介上效果一致，UI 控件完全复用，无需维护两套编辑逻辑。

---

## 八、附件

- [DEV_01_plan.md](./DEV_01_plan.md) — 历史需求记录
- [smart-video-pd.md](./smart-video-pd.md) — AI 智能剪辑产品设计（与工作台互补，不冲突）
