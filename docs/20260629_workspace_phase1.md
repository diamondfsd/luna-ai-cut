# 工作台 Phase 1 产品设计

> 日期：2026-06-29
> 分支：`feature/workspace`
> 定位：工作台首版可交付版本，聚焦核心编辑流水线 + 基础交互

---

## 一、Phase 1 交付清单

| # | 模块 | 交付物 | 依赖 | 预估 |
|---|------|--------|------|------|
| 1 | 项目骨架 | `src/workspace/` 目录结构 + `src/shared/editPipeline.ts` | 无 | 0.5天 |
| 2 | 路由与导航 | `/workspace` 路由 + 导航栏 + 素材传入 IPC | AppNav, AppRoutes | 0.5天 |
| 3 | 工作台页面 | `WorkspacePage.tsx` 三栏布局框架 | 路由 | 1天 |
| 4 | 多级缓存 | `imageCache.ts` + OffscreenCanvas Worker 降采样 | sharp | 1天 |
| 5 | WebGL 渲染器 | `webglRenderer.ts` + 基础 shader（pipeline, transform, color, effects） | 缓存 | 2天 |
| 6 | 几何变换 UI | `TransformPanel.tsx` + `CropOverlay.tsx`（旋转/翻转/裁剪拖拽） | 渲染器 | 1.5天 |
| 7 | 调色面板 UI | `ColorPanel.tsx`（曝光/对比度/饱和度/色温/高光/阴影等滑块） | 渲染器 | 1.5天 |
| 8 | 交互优化 | 撤销/重做（editHistory.ts）+ requestAnimationFrame 防抖 | 无 | 1天 |
| 9 | 导出管线 | `electron/imageProcessor.ts` + sharp 导出 + 水印叠加 | sharp(npm) | 1.5天 |
| 10 | 水印扩展 | 自定义水印上传 + 透明度控制 | 现有水印系统 | 1天 |
| **合计** | | | | **~11天** |

---

## 二、目录结构

```
src/
├── pages/WorkspacePage.tsx          # 工作台页面框架（三栏布局）
├── workspace/                       # 工作台模块（新建）
│   ├── index.ts                     # 统一导出
│   ├── shared/                      # 共享模块
│   │   ├── editPipeline.ts          # EditPipeline 类型 + 默认值 + 序列化
│   │   ├── editHistory.ts           # 撤销/重做快照栈
│   │   └── imageCache.ts           # 多级图片缓存管理
│   ├── renderer/                    # 渲染引擎
│   │   ├── webglRenderer.ts        # WebGL 渲染管线（核心类）
│   │   ├── glUtils.ts              # WebGL 工具函数（创建 program, texture, buffer 等）
│   │   ├── webglCheck.ts           # GPU 可用性检测
│   │   └── shaders/                # GLSL shader 源码
│   │       ├── pipeline.glsl        # 主管线（串联三阶段）
│   │       ├── transform.glsl       # 几何变换
│   │       ├── color.glsl           # 颜色调整
│   │       └── effects.glsl         # 效果
│   ├── transform/                   # 几何变换工具
│   │   ├── TransformPanel.tsx       # 旋转/翻转/缩放滑块 + 按钮
│   │   └── CropOverlay.tsx         # 裁剪拖拽覆盖层（支持 UV 坐标控制）
│   ├── color/                       # 颜色调整工具
│   │   └── ColorPanel.tsx          # 调色参数面板（滑块组）
│   ├── effects/                     # 效果工具
│   │   └── EffectsPanel.tsx        # 效果参数面板（预留）
│   └── export/                      # 导出
│       └── ExportDialog.tsx        # 导出对话框（格式/质量/水印选项）
├── styles/
│   └── workspace.css                # 工作台页面样式（新建）

electron/
├── imageProcessor.ts               # 新建 — sharp 图片处理（缓存 + 导出）
├── appMain.ts                      # 修改 — 新增工作台 IPC
└── preload.ts                      # 修改 — 暴露新 IPC
```

---

## 三、组件树与数据流

### 3.1 组件树

```
AppRoutes
 └── WorkspacePage                      # 页面框架，管理 EditPipeline 状态
      ├── WorkspaceSidebar              # 左侧：素材缩略图列表
      │    └── WorkspaceThumbnail[]     # 缩略图项
      ├── WorkspaceCanvas               # 中央：WebGL Canvas 预览
      │    └── WebGLRenderer            # WebGL 渲染引擎（非 React 组件，纯 class）
      ├── WorkspaceToolbar              # 底部：撤销/重置/对比/保存/导出
      └── WorkspaceParams               # 右侧：参数面板（可滚动）
           ├── Accordion: Transform      # 折叠组：几何变换
           │    ├── CropSection          # 裁剪（拖拽框选）
           │    ├── RotateSlider         # 旋转
           │    ├── FlipButtons          # 翻转 H/V
           │    └── ScaleSlider          # 缩放
           ├── Accordion: Color          # 折叠组：颜色调整（默认展开）
           │    ├── ExposureSlider
           │    ├── ContrastSlider
           │    ├── SaturationSlider
           │    ├── TemperatureSlider
           │    ├── TintSlider
           │    ├── HighlightsSlider
           │    ├── ShadowsSlider
           │    ├── WhitesSlider
           │    └── BlacksSlider
           ├── Accordion: Effects        # 折叠组：效果（预留）
           └── Accordion: Watermark      # 折叠组：水印设置
```

### 3.2 数据流

```
                         ┌──────────────────┐
                         │   WorkspacePage   │
                         │  (状态管理器)      │
                         │                   │
                         │  editPipeline     │── 用户操作参数 → 更新状态
                         │  (EditPipeline)   │── 状态变化 → 触发渲染
                         └───────┬───────────┘
                                 │
                   ┌─────────────┼─────────────┐
                   │             │             │
                   ▼             ▼             ▼
           ┌───────────┐ ┌───────────┐ ┌───────────┐
           │ Sidebar   │ │ Canvas    │ │ Params    │
           │ (素材列表) │ │ (预览)    │ │ (参数面板) │
           └───────────┘ └─────┬─────┘ └───────────┘
                               │
                               ▼
                      ┌──────────────────┐
                      │  WebGLRenderer   │
                      │  (非 React)      │
                      │                  │
                      │  render(param)   │
                      │  → update uniform│
                      │  → gl.drawArrays │
                      └──────────────────┘
```

### 3.3 状态提升设计

`EditPipeline` 状态由 `WorkspacePage` 统一管理，通过 props 下发：

```tsx
// WorkspacePage 中的状态管理
function WorkspacePage() {
  const [editPipeline, setEditPipeline] = useState<EditPipeline>(defaultEditPipeline)
  const rendererRef = useRef<WebGLRenderer>(null)

  // 更新参数（由子组件调用）
  const updatePipeline = useCallback((patch: PartialDeep<EditPipeline>) => {
    setEditPipeline(prev => {
      const next = merge(prev, patch)
      rendererRef.current?.render(next)  // → 改 uniform → 重绘
      return next
    })
  }, [])

  return (
    <div className="workspace-layout">
      <WorkspaceSidebar onSelect={handleSelectMedia} />
      <WorkspaceCanvas ref={rendererRef} pipeline={editPipeline} />
      <WorkspaceParams pipeline={editPipeline} onChange={updatePipeline} />
      <WorkspaceToolbar onReset={handleReset} onExport={handleExport} />
    </div>
  )
}
```

---

## 四、路由与导航设计

### 4.1 路由

```tsx
// src/routes/AppRoutes.tsx — 新增
const isWorkspaceActive = activePath === '/workspace'

// 新增 route section
<section className="route-panel" hidden={!isWorkspaceActive}>
  <WorkspacePage />
</section>
```

### 4.2 导航

```tsx
// src/components/AppNav.tsx — 新增导航项
<NavLink to="/workspace">工作台</NavLink>
```

导航顺序：`设备媒体库` → `本地资源` → `工作台` → `设置`

### 4.3 素材传入通道

从本地资源页面选中素材后，通过按钮进入工作台：

```tsx
// 方式：传入素材路径列表
// WorkspacePage 接收初始素材列表作为路由 state
navigate('/workspace', {
  state: {
    mediaPaths: string[]       // 选中素材的本地路径
    initialIndex: number       // 默认聚焦第几个
  }
})
```

**IPC 需求**：本地资源页面需要获取选中文件的本地路径（已有 `window.luna` 接口）

---

## 五、EditPipeline 类型系统

```ts
// src/shared/editPipeline.ts

export interface EditPipeline {
  transform: {
    crop: { x: number; y: number; w: number; h: number } | null
    rotate: number          // 度，0-360
    flipH: boolean
    flipV: boolean
    scale: number           // 0.1 - 10.0
  }

  color: {
    exposure: number        // -5.0 ~ +5.0
    contrast: number        // -100 ~ +100
    saturation: number      // -100 ~ +100
    vibrance: number        // -100 ~ +100
    temperature: number     // -100 ~ +100
    tint: number            // -100 ~ +100
    highlights: number      // -100 ~ +100
    shadows: number         // -100 ~ +100
    whites: number          // -100 ~ +100
    blacks: number          // -100 ~ +100
    clarity: number         // -100 ~ +100
    dehaze: number          // -100 ~ +100
  }

  effects: {
    sharpen: number         // 0 ~ 100
    vignette: number        // 0 ~ 100
  }

  watermark: {
    enabled: boolean
    styleId: string | null
    customImagePath: string | null
    opacity: number         // 0 ~ 100
    size: number            // 1 ~ 40（百分比）
    position: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'center'
  }
}

export const DEFAULT_PIPELINE: EditPipeline = {
  transform: {
    crop: null,
    rotate: 0,
    flipH: false,
    flipV: false,
    scale: 1.0,
  },
  color: {
    exposure: 0, contrast: 0, saturation: 0, vibrance: 0,
    temperature: 0, tint: 0, highlights: 0, shadows: 0,
    whites: 0, blacks: 0, clarity: 0, dehaze: 0,
  },
  effects: { sharpen: 0, vignette: 0 },
  watermark: {
    enabled: false, styleId: null,
    customImagePath: null, opacity: 100,
    size: 15, position: 'bottomRight',
  },
}

export function serializePipeline(p: EditPipeline): string {
  return JSON.stringify(p)
}

export function deserializePipeline(s: string): EditPipeline {
  return { ...DEFAULT_PIPELINE, ...JSON.parse(s) }
}
```

---

## 六、WebGL 渲染引擎设计

### 6.1 类设计

```ts
// src/workspace/renderer/webglRenderer.ts

class WebGLRenderer {
  private canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext
  private program: WebGLProgram
  private texture: WebGLTexture | null       // Preview 图纹理
  private maskTexture: WebGLTexture | null    // Beautify mask（Phase 2 使用）

  // uniform 位置缓存
  private uniforms: Map<string, WebGLUniformLocation>

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.gl = canvas.getContext('webgl2', { alpha: false, premultipliedAlpha: false })
    this.program = this.buildShaderProgram()
  }

  // 上传 Preview 图（素材切换时调用）
  async loadImage(previewData: ImageBitmap | HTMLImageElement): Promise<void> {
    // 创建/更新 texture
  }

  // 渲染帧（每次参数变化时调用）
  render(pipeline: EditPipeline): void {
    this.updateUniforms(pipeline)
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4)  // 全屏四边形
  }

  // 导出：读回像素数据
  readPixels(width: number, height: number): Uint8Array {
    // gl.readPixels 返回 RGBA 数据
  }

  // 重设 canvas 尺寸
  resize(width: number, height: number): void {
    this.canvas.width = width
    this.canvas.height = height
    this.gl.viewport(0, 0, width, height)
  }

  destroy(): void {
    // 清理 GPU 资源
  }

  private buildShaderProgram(): WebGLProgram { /* ... */ }
  private compileShader(type: number, source: string): WebGLShader { /* ... */ }
  private updateUniforms(pipeline: EditPipeline): void { /* ... */ }
}
```

### 6.2 Shader 管线设计

```glsl
// pipeline.glsl — 主管线（vertex + fragment 核心逻辑）

// Vertex Shader
#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_uv;
uniform vec2 u_crop;           // crop: xy = offset, zw = size
uniform float u_rotate;
uniform vec2 u_flip;
uniform float u_scale;

void main() {
  // Transform 矩阵计算
  vec2 uv = a_texCoord;
  uv = applyCrop(uv, u_crop);
  uv = applyRotate(uv, u_rotate);
  uv = applyFlip(uv, u_flip);
  uv = applyScale(uv, u_scale);
  v_uv = uv;
  gl_Position = vec4(a_position, 0.0, 1.0);
}

// Fragment Shader
#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_texture;
// Color uniforms
uniform float u_exposure, u_contrast, u_saturation;
uniform float u_vibrance, u_temperature, u_tint;
uniform float u_highlights, u_shadows, u_whites, u_blacks;
uniform float u_clarity, u_dehaze;
// Effects uniforms
uniform float u_sharpen, u_vignette;
// Watermark (future)

void main() {
  vec4 color = texture(u_texture, v_uv);

  // 1. Color Stage
  color.rgb = applyExposure(color.rgb, u_exposure);
  color.rgb = applyContrast(color.rgb, u_contrast);
  color.rgb = applySaturation(color.rgb, u_saturation);
  color.rgb = applyTemperature(color.rgb, u_temperature);
  color.rgb = applyTint(color.rgb, u_tint);
  color.rgb = applyLights(color.rgb, u_highlights, u_shadows, u_whites, u_blacks);

  // 2. Effects Stage
  color.rgb = applySharpen(color.rgb, u_sharpen, 1.0 / resolution);
  color.rgb = applyVignette(color.rgb, u_vignette, v_uv);

  fragColor = color;
}
```

**设计要点**：
- 所有 uniform 在 `render()` 时一次性更新，一次 draw call 完成
- Color 算法使用标准图像处理函数（sRGB 线性空间处理，预览时近似）
- 为避免 shader 过于庞大，Color 各算法放在 `color.glsl` 中 include（在 JS 侧拼接 GLSL 字符串）

### 6.3 WebGL 可用性检测

```ts
// src/workspace/renderer/webglCheck.ts

export function checkWebGLSupport(): { supported: boolean; message?: string } {
  // 通过 app.getGPUFeatureStatus() 检测（在 Electron 主进程）
  // 在渲染进程创建 canvas 检测是否支持 WebGL2
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2')
  if (!gl) return { supported: false, message: '当前浏览器不支持 WebGL2，无法使用工作台' }
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
  const renderer = debugInfo
    ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
    : 'unknown'
  gl.getExtension('WEBGL_lose_context')?.loseContext()
  return { supported: true, message: renderer }
}
```

---

## 七、多级缓存设计

```ts
// src/workspace/shared/imageCache.ts

export interface ImageCacheEntry {
  thumbnail: string          // dataURL (300px)
  preview: string            // dataURL (1500px)
  originalPath: string       // 本地文件路径
}

class ImageCache {
  // 生成三级缓存（在 Web Worker 中使用 OffscreenCanvas 降采样）
  async generate(
    filePath: string,
    options?: { maxPreviewPx?: number; maxThumbPx?: number }
  ): Promise<ImageCacheEntry> { /* ... */ }

  // 清理缓存
  clear(filePath?: string): void { /* ... */ }
}
```

**降采样工作流**：

```
读取原图 → decode ImageBitmap → 
  ├→ OffscreenCanvas(300px) → toDataURL → Thumbnail
  └→ OffscreenCanvas(1500px) → createImageBitmap → Preview 纹理
```

**IPC 调用方式**（通过主进程 sharp 加载图片，返回 ImageBitmap）：

```ts
// electron/appMain.ts — 新增 IPC
ipcMain.handle('workspace:loadImage', async (_, filePath: string) => {
  // 使用 sharp 读取图片
  const buffer = await sharp(filePath).resize(1500, null, { fit: 'inside' }).toBuffer()
  // 返回 Buffer
})
```

> Phase 1 简化：使用 `new Image()` + Canvas 在 Renderer 进程直接降采样。
> 后续优化：迁移到 Worker + OffscreenCanvas 避免阻塞 UI。

---

## 八、Transform 交互设计

### 8.1 裁剪交互

```
用户行为：
  点击裁剪按钮 → 预览图上出现半透明裁剪框
  拖拽框的边/角 → 调整裁剪区域
  双击区域   → 确认裁剪
  按 ESC    → 取消裁剪

实现：
  CropOverlay.tsx 组件覆盖在 WebGL Canvas 之上
  拖拽操作修改 EditPipeline.transform.crop（归一化 UV 坐标）
  裁剪框不会裁切图片，只改变 UV 采样范围
```

```tsx
// CropOverlay.tsx 核心逻辑
function CropOverlay({ crop, onCropChange, onConfirm, onCancel }) {
  // 四个角 + 四条边的拖拽手柄
  // 拖拽时实时更新 crop（归一化 0-1 坐标）
  // 确认后：crop 写入 EditPipeline → shader 更新 UV

  return (
    <div className="crop-overlay">
      <div className="crop-mask" />  {/* 暗色遮罩 */}
      <div className="crop-box" style={{
        left: `${crop.x * 100}%`, top: `${crop.y * 100}%`,
        width: `${crop.w * 100}%`, height: `${crop.h * 100}%`,
      }}>
        <div className="crop-handle tl" />  {/* 左上 */}
        <div className="crop-handle tr" />  {/* 右上 */}
        <div className="crop-handle bl" />  {/* 左下 */}
        <div className="crop-handle br" />  {/* 右下 */}
      </div>
    </div>
  )
}
```

### 8.2 旋转/翻转/缩放

```
旋转：滑块 -180° ~ +180°，步进 1°（快速定位可 15° 吸附）
翻转：两个独立按钮 ↕（垂直）↔（水平）
缩放：滑块 0.1x ~ 10x，步进 0.1x
重置：一键清除 transform 所有参数
```

---

## 九、调色面板 UI 设计

### 9.1 布局

```
┌─ Color ──────────────────────┐  ← 折叠组标题
│                               │
│  曝光          ────●────      │  滑块组件
│  对比度        ──●──────      │
│  饱和度        ─────────●─    │
│                               │
│  ── 光影 ──                  │  分组标签
│  高光          ──●──────      │
│  阴影          ──────●──     │
│  白色          ────●────      │
│  黑色          ─────●───      │
│                               │
│  ── 色彩 ──                  │
│  色温          ────●────      │
│  色调          ──●──────      │
│  自然饱和度    ──────●──     │
│                               │
│  [重置]                      │  小按钮
└───────────────────────────────┘
```

### 9.2 滑块组件

```tsx
// 通用滑块（响应式，支持键盘微调）
interface ParamSliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  onReset?: () => void           // 双击滑块重置
  formatValue?: (v: number) => string  // 展示格式
}
```

**交互细节**：
- 滑块值显示在右侧，如 `+0.6`、`-12`
- 双击滑块数值自动重置为 0
- 拖动时 requestAnimationFrame 节流（~16ms）
- 滑块轨道渐变：左负右正，中间 O 点标记
- 鼠标悬停滑块显示 **滚轮微调**（1 格 = 1 单位）

---

## 十、导出管线设计

### 10.1 IPC 接口

```ts
// preload.ts — 暴露
interface LunaAPI {
  // ... 已有接口

  // 工作台
  workspace: {
    // 加载图片（返回 ImageBitmap 或 Buffer）
    loadPreview: (filePath: string) => Promise<ArrayBuffer>
    // 导出
    exportImage: (params: ExportParams) => Promise<{ outputPath: string }>
    // 获取 cache 目录
    getCacheDir: () => Promise<string>
  }
}
```

### 10.2 导出参数

```ts
interface ExportParams {
  originalPath: string           // 原图路径
  pipeline: EditPipeline         // 全部编辑参数
  format: 'jpeg' | 'png' | 'tiff'
  quality: number                // 1-100 (jpeg/tiff)
  outputDir: string              // 输出目录
  fileName: string               // 文件名（不含后缀）
  watermark?: {
    imagePath: string
    opacity: number
    size: number
    position: string
  }
}
```

### 10.3 sharp 处理流程

```ts
// electron/imageProcessor.ts
import sharp from 'sharp'

export async function exportImage(params: ExportParams): Promise<string> {
  let pipeline = sharp(params.originalPath)

  // 1. Transform（锐化里做旋转和裁剪）
  if (params.pipeline.transform.rotate % 90 === 0) {
    pipeline = pipeline.rotate(params.pipeline.transform.rotate)
  }
  // 非 90° 倍数的旋转比较复杂，使用 affine
  if (params.pipeline.transform.flipH) pipeline = pipeline.flop()
  if (params.pipeline.transform.flipV) pipeline = pipeline.flip()
  if (params.pipeline.transform.crop) {
    pipeline = pipeline.extract({
      left: Math.round(params.pipeline.transform.crop.x * width),
      top: Math.round(params.pipeline.transform.crop.y * height),
      width: Math.round(params.pipeline.transform.crop.w * width),
      height: Math.round(params.pipeline.transform.crop.h * height),
    })
  }

  // 2. Color（sharp 支持部分调色参数）
  if (params.pipeline.color.exposure !== 0) {
    pipeline = pipeline.modulate({ brightness: 1 + params.pipeline.color.exposure / 5 })
  }
  // ... 其他 color 参数映射到 sharp 操作

  // 3. Watermark（复用现有 watermarkService）
  if (params.watermark) {
    // 调用 watermarkService.applyWatermarkToImage
  }

  // 4. 编码输出
  const outputPath = path.join(params.outputDir, `${params.fileName}.${params.format}`)
  switch (params.format) {
    case 'jpeg': await pipeline.jpeg({ quality: params.quality }).toFile(outputPath); break
    case 'png': await pipeline.png().toFile(outputPath); break
    case 'tiff': await pipeline.tiff({ quality: params.quality }).toFile(outputPath); break
  }

  return outputPath
}
```

> **注意**：sharp 不支持所有的调色参数（如高光/阴影等），不支持的参数需要通过 WebGL readPixels 或者 Canvas 导出。

---

## 十一、水印扩展

### 11.1 本地水印模板

在设置页新增「水印模板」区域，用户上传自定义 PNG 图片：

```ts
// IPC 新增
ipcMain.handle('watermark:uploadCustom', async (_, filePaths: string[]) => {
  // 将选中的 PNG 文件复制到 userData/watermark-custom/
  // 返回 [{ name, path, thumbnail }]
})

ipcMain.handle('watermark:listCustom', async () => {
  // 列出 userData/watermark-custom/ 下所有 PNG
})

ipcMain.handle('watermark:deleteCustom', async (_, name: string) => {
  // 删除指定自定义水印
})
```

### 11.2 透明度控制

在 `WatermarkSettings.tsx` 增加滑块：

```
水印透明度  ──────────●────  100%
```

---

## 十二、样式与交互规范

### 12.1 工作台布局样式

```css
/* src/styles/workspace.css */

.workspace-layout {
  display: grid;
  grid-template-columns: 200px 1fr 280px;
  grid-template-rows: 1fr 44px;
  height: 100%;
  gap: 1px;
  background: var(--border, #e5e5e5);
}

.workspace-sidebar {
  grid-row: 1 / 3;
  background: var(--bg-primary, #fff);
  overflow-y: auto;
}

.workspace-canvas {
  grid-column: 2;
  grid-row: 1;
  background: var(--bg-canvas, #1a1a1a);
  position: relative;
  overflow: hidden;
}

.workspace-params {
  grid-column: 3;
  grid-row: 1 / 3;
  background: var(--bg-primary, #fff);
  overflow-y: auto;
  padding: 12px;
}

.workspace-toolbar {
  grid-column: 2;
  grid-row: 2;
  background: var(--bg-primary, #fff);
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 8px;
}
```

### 12.2 滑块样式

```css
.param-slider {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
}

.param-slider label {
  width: 56px;
  font-size: 12px;
  color: var(--text-secondary);
  text-align: right;
  flex-shrink: 0;
}

.param-slider input[type="range"] {
  flex: 1;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: linear-gradient(to right, #0066cc 50%, #e0e0e0 50%);
  border-radius: 2px;
  outline: none;
}

.param-slider input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #0066cc;
  cursor: pointer;
  border: 2px solid #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}

.param-slider .value {
  width: 40px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: right;
  color: var(--text-primary);
}
```

### 12.3 裁剪覆盖层样式

```css
.crop-overlay {
  position: absolute;
  inset: 0;
  cursor: crosshair;
}

.crop-mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  /* 通过 clip-path 挖出裁剪区域 */
}

.crop-box {
  position: absolute;
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.3);
  cursor: move;
}

.crop-handle {
  position: absolute;
  width: 12px;
  height: 12px;
  background: #fff;
  border: 1px solid #0066cc;
  border-radius: 2px;
}

.crop-handle.tl { top: -6px; left: -6px; cursor: nw-resize; }
.crop-handle.tr { top: -6px; right: -6px; cursor: ne-resize; }
.crop-handle.bl { bottom: -6px; left: -6px; cursor: sw-resize; }
.crop-handle.br { bottom: -6px; right: -6px; cursor: se-resize; }
```

---

## 十三、IPC 完整清单

| IPC Channel | Direction | Payload | Response | 说明 |
|------------|-----------|---------|----------|------|
| `workspace:loadPreview` | renderer → main | `filePath: string` | `ArrayBuffer` | 加载 Preview 图（sharp resize 到 1500px） |
| `workspace:exportImage` | renderer → main | `ExportParams` | `{ outputPath }` | 导出处理后的图片 |
| `workspace:getCacheDir` | renderer → main | — | `string` | 获取 cache 目录路径 |
| `watermark:uploadCustom` | renderer → main | `filePaths: string[]` | `WatermarkEntry[]` | 上传自定义水印 |
| `watermark:listCustom` | renderer → main | — | `WatermarkEntry[]` | 列出自定义水印 |
| `watermark:deleteCustom` | renderer → main | `name: string` | `void` | 删除自定义水印 |

---

## 十四、依赖新增

| 包 | 版本 | 用途 | 安装命令 |
|---|------|------|---------|
| `sharp` | ^0.33 | 图片处理（缓存降采样 + 导出） | `npm install sharp` |
| `@electron/rebuild` | latest | 重新编译 sharp 原生绑定 | `npm install --save-dev @electron/rebuild` |

---

## 十五、Phase 1 开发步骤（按依赖顺序）

```
Step 1:  创建分支 + 目录结构 + editPipeline.ts
Step 2:  安装 sharp + @electron/rebuild + imageProcessor.ts
Step 3:  路由/导航/素材传入（AppRoutes.tsx, AppNav.tsx, preload.ts）
Step 4:  imageCache.ts + preview 加载 IPC
Step 5:  webglCheck.ts + GLSL shader 源码
Step 6:  WebGLRenderer class（核心）
Step 7:  WorkspacePage 三栏布局 + Canvas 挂载
Step 8:  TransformPanel + CropOverlay
Step 9:  ColorPanel（所有滑块）
Step 10: editHistory.ts 撤销/重做
Step 11: 导出 IPC + ExportDialog
Step 12: 水印扩展（上传 + 透明度）
Step 13: 样式完善 + 交互微调
Step 14: QA / 边界情况处理
```
