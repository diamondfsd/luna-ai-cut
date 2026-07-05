# Workspace Render PD

## 目标

将工作台调色预览切换到 `src/components/PreviewStage.tsx`，并把调色、旋转、翻转、裁切等渲染参数作为 `PreviewLayer` 的一部分传入 Rust/wgpu 渲染核心统一处理。

本次迁移不再使用当前 LUT 方案，也不在前端预烘焙调色结果。前端只负责把工作台的 `EditPipeline` 转换为 layer 上的结构化数据，实际像素处理、几何变换、裁切和合成都由 Rust/wgpu 完成。

## 核心原则

1. 调色参数直接进入 layer。
2. 旋转、翻转、裁切参数直接进入 layer。
3. `PreviewStage` 只负责构建预览图层和布局，不负责调色算法、像素变换或裁切渲染。
4. Rust/wgpu 作为唯一渲染执行层，预览和导出必须复用同一套 layer 输入。
5. 主媒体 layer 默认带调色和 transform 参数，水印、贴纸等额外 layer 默认不继承主媒体调色和裁切。
6. 不继续扩展 `bakeAndGetLut`、`colorLutKey`、WebGL LUT shader、WebGL transform shader 等旧链路。
7. 编辑工作台旧渲染链路必须删除，不保留兼容入口。包括 `ImagePreview`、编辑侧 WebGL renderer、编辑侧 LUT 预烘焙链路和编辑侧 native canvas 过渡封装。
8. 创意空间暂不纳入本次迁移和清理范围。创意空间仍可保留现状，本次只处理编辑工作台调色、旋转、裁切预览与导出一致性。
9. layer 数据模型必须是通用渲染图层模型，不能只为当前单图编辑定制。后续多视频编辑、多布局、多轨道、贴纸、水印、字幕等都应复用同一套 layer 描述。

## 通用 Layer 模型

`PreviewLayer` 要表达“一个可渲染图层”，而不是“当前工作台主图”。模型按职责拆分：

- source：图层源，当前用 `filePath` / `isVideo` / `videoTime` 表达，后续可扩展为多源类型。
- frame：图层在输出画布中的位置和尺寸，当前用 `dstX` / `dstY` / `dstW` / `dstH` 表达。
- crop/sourceRect：源内容采样区域，当前用 `srcX` / `srcY` / `srcW` / `srcH` 和 `transform.crop` 表达。
- transform：图层几何变换，包括裁切、方向旋转、微调旋转、翻转、缩放。
- adjustments：图层视觉调整，包括调色、锐化、降噪等。
- composite：图层合成属性，包括透明度、层级，后续可扩展混合模式、遮罩等。

当前为了减少迁移面，继续保留现有扁平字段：

```ts
filePath
isVideo
videoTime
dstX / dstY / dstW / dstH
srcX / srcY / srcW / srcH
opacity
zIndex
```

新增字段使用可扩展分组：

```ts
color?: RenderColorAdjustments
transform?: RenderLayerTransform
```

后续如果需要多视频布局，可以继续增加：

```ts
source?: RenderLayerSource
composite?: RenderLayerComposite
mask?: RenderLayerMask
audio?: RenderLayerAudio
keyframes?: RenderLayerKeyframe[]
```

不允许把多视频布局逻辑写死在工作台页面或 PreviewStage 中。页面只负责生成 layer 列表，Rust/wgpu 负责按 layer 描述渲染。

## 数据结构

在 `src/shared/types/render.ts` 中为 `PreviewLayer` 增加调色和 transform 字段。

```ts
export interface RenderCurvePoint {
  x: number
  y: number
}

export interface RenderToneCurveAdjust {
  rgb: RenderCurvePoint[]
  luminance: RenderCurvePoint[]
  red: RenderCurvePoint[]
  green: RenderCurvePoint[]
  blue: RenderCurvePoint[]
}

export interface RenderColorAdjustments {
  exposure: number
  black: number
  brightness: number
  contrast: number
  saturation: number
  vibrance: number
  temperature: number
  tint: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
  clarity: number
  texture: number
  sharpen: number
  denoise: number
  gradeShadowsHue: number
  gradeShadowsAmount: number
  gradeMidHue: number
  gradeMidAmount: number
  gradeHighlightsHue: number
  gradeHighlightsAmount: number
  curveLift: number
  curveContrast: number
  curve: RenderToneCurveAdjust
  levelsBlack: number
  levelsGray: number
  levelsWhite: number
  hue: number
  hslHue: number
  hslSat: number
  hslLum: number
}

export interface RenderCropRect {
  x: number
  y: number
  w: number
  h: number
}

export interface RenderLayerTransform {
  /**
   * 基于源媒体方向的 90 度旋转，取值建议归一化为 0 / 90 / 180 / 270。
   */
  orientation: number
  /**
   * 用户微调旋转角度，单位为度。
   */
  rotate: number
  flipH: boolean
  flipV: boolean
  /**
   * 源媒体归一化裁切区域。
   * null 表示不裁切，等价于 { x: 0, y: 0, w: 1, h: 1 }。
   */
  crop: RenderCropRect | null
}

export interface PreviewLayer {
  filePath: string
  isVideo?: boolean
  videoTime?: number
  dstX: number
  dstY: number
  dstW: number
  dstH: number
  srcX: number
  srcY: number
  srcW: number
  srcH: number
  opacity: number
  zIndex: number
  fit?: 'fill' | 'contain'
  color?: RenderColorAdjustments
  transform?: RenderLayerTransform
}
```

调色字段按当前工作台 `EditPipeline.color` 展开，复杂结构也必须属于 layer 数据本身。曲线按五通道传入，每通道最多 12 个点，避免后续多视频、多布局时调色状态只能绑定单一页面。

## 调色算法

工作台调色算法参考 `/Users/REDACTED/projects/darktable/webgl-color-lab/src/colorEngine/shaders` 的模块顺序和核心公式，但不直接运行 GLSL。Rust/wgpu 使用 WGSL 重写并在同一个 layer shader 中执行：

1. detail 采样：邻域 blur、detail、denoise、local contrast、sharpen。
2. exposure：`(c - black) * exp2(exposure)`。
3. white balance：temperature/tint RGB 系数。
4. tone equalizer：shadows/highlights/whites/blacks 按亮度 mask 处理。
5. levels：black/gray/white 和 gamma。
6. color balance RGB：三路色轮、contrast、saturation、vibrance。
7. curve：rgb、luminance、red、green、blue 五通道曲线。
8. HSL：全局 hue 和目标色带 sat/lum。

所有调色、裁切、旋转、缩放、翻转都在 Rust/wgpu 层完成。前端不再生成 LUT，也不再用 WebGL shader 预览编辑结果。

WGSL 不使用运行时 include。Rust 侧通过 `include_str!` 和 `concat!` 在编译期拼接 shader 文件：

```rust
const SHADER: &str = concat!(
    include_str!("shaders/vertex.wgsl"),
    include_str!("shaders/params.wgsl"),
    include_str!("shaders/common.wgsl"),
    include_str!("shaders/detail.wgsl"),
    include_str!("shaders/curve.wgsl"),
    include_str!("shaders/color.wgsl"),
    include_str!("shaders/fragment.wgsl"),
);
```

文件职责：

- `vertex.wgsl`：全屏 quad 顶点入口。
- `params.wgsl`：layer uniform、纹理和 sampler 绑定。
- `common.wgsl`：亮度、clamp、HSL、色轮等公共函数。
- `detail.wgsl`：邻域采样、blur、detail 基础函数。
- `curve.wgsl`：五通道曲线求值。
- `color.wgsl`：调色算法主链路。
- `fragment.wgsl`：图层命中、裁切、旋转、翻转、缩放和最终采样。

## Pipeline 到 Layer 的转换

新增工具文件：

`src/workspace/shared/renderLayerPipeline.ts`

职责：

```ts
import type { EditPipeline } from './editPipeline'
import type { RenderColorAdjustments, RenderLayerTransform } from '../../shared/types'

export function pipelineColorToRenderColor(
  color: EditPipeline['color'],
): RenderColorAdjustments {
  return {
    exposure: color.exposure,
    brightness: color.brightness,
    contrast: color.contrast,
    saturation: color.saturation,
    vibrance: color.vibrance,
    temperature: color.temperature,
    tint: color.tint,
    highlights: color.highlights,
    shadows: color.shadows,
    whites: color.whites,
    blacks: color.blacks,
    clarity: color.clarity,
    texture: color.texture,
    sharpen: color.sharpen,
    denoise: color.denoise,
  }
}

export function pipelineTransformToRenderTransform(
  transform: EditPipeline['transform'],
): RenderLayerTransform {
  return {
    orientation: transform.orientation,
    rotate: transform.rotate,
    flipH: transform.flipH,
    flipV: transform.flipV,
    crop: transform.crop,
  }
}
```

该工具只做字段映射和必要归一化，不做 LUT、不做像素算法，不在前端裁切像素。

## PreviewStage 改造

文件：

`src/components/PreviewStage.tsx`

新增 prop：

```ts
import type { EditPipeline } from '../workspace/shared/editPipeline'

interface PreviewStageProps {
  url: string | null
  pending?: boolean
  scaleMode?: ScaleMode
  extraLayers?: PreviewLayer[]
  exportOptions?: ExportOptions
  pipeline?: EditPipeline
}
```

在构建主媒体 layer 时挂载调色和 transform 数据：

```ts
const main = sourceUrl ? buildLayers(sourceUrl, scaleMode, layerResolution, canvas) : []

if (main[0] && pipeline) {
  main[0] = {
    ...main[0],
    color: pipelineColorToRenderColor(pipeline.color),
    transform: pipelineTransformToRenderTransform(pipeline.transform),
  }
}
```

额外 layer 的坐标仍按主媒体区域适配，但默认不继承主媒体调色、旋转和裁切：

```ts
const adjusted = extraLayers.map((layer) => ({
  ...layer,
  dstX: cX + layer.dstX * cW,
  dstY: cY + layer.dstY * cH,
  dstW: layer.dstW * cW,
  dstH: layer.dstH * cH,
}))
```

## WorkspacePage 改造

文件：

`src/pages/WorkspacePage.tsx`

移除：

```ts
import { ImagePreview } from '../workspace/components/ImagePreview'
import type { ImagePreviewHandle } from '../workspace/components/ImagePreview'
```

改为：

```ts
import { PreviewStage } from '../components/PreviewStage'
import type { PreviewStageHandle } from '../components/PreviewStage'
```

替换预览区域：

```tsx
<PreviewStage
  ref={previewRef}
  url={media.activeMedia?.path ?? null}
  pending={!media.activeMedia}
  scaleMode="contain"
  pipeline={displayPipeline}
/>
```

`displayPipeline` 已经包含对比模式逻辑：

```ts
const displayPipeline = edit.compareOriginal ? edit.comparePipeline : edit.previewPipeline
```

因此对比原图时，主媒体 layer 会收到默认调色参数。

裁切编辑态使用 `edit.previewPipeline` / `edit.activeTransform` 中的 draft 数据。只要 `displayPipeline` 包含当前 draft，`PreviewStage` 就把 draft transform 放到主媒体 layer，Rust/wgpu 输出与最终导出保持一致。

## IPC 和 Native Wrapper 改造

同步扩展以下文件中的 layer 类型：

- `electron/ipcLunaRenderCore.ts`
- `electron/lunaRenderCore.ts`
- `src/shared/types/render.ts`

需要增加以下字段：

```ts
color?: RenderColorAdjustments
transform?: RenderLayerTransform
```

覆盖类型：

- `PreviewLayerArg`
- `PreviewLayerInputForExport`
- `PreviewLayerInput`
- `PreviewNativeLayer`

`normalizePreviewLayer` 负责补默认值：

```ts
function normalizeColor(color?: Partial<RenderColorAdjustments>): RenderColorAdjustments {
  return {
    exposure: color?.exposure ?? 0,
    brightness: color?.brightness ?? 0,
    contrast: color?.contrast ?? 0,
    saturation: color?.saturation ?? 0,
    vibrance: color?.vibrance ?? 0,
    temperature: color?.temperature ?? 0,
    tint: color?.tint ?? 0,
    highlights: color?.highlights ?? 0,
    shadows: color?.shadows ?? 0,
    whites: color?.whites ?? 0,
    blacks: color?.blacks ?? 0,
    clarity: color?.clarity ?? 0,
    texture: color?.texture ?? 0,
    sharpen: color?.sharpen ?? 0,
    denoise: color?.denoise ?? 0,
  }
}
```

```ts
function normalizeTransform(transform?: Partial<RenderLayerTransform>): RenderLayerTransform {
  return {
    orientation: normalizeOrientation(transform?.orientation ?? 0),
    rotate: transform?.rotate ?? 0,
    flipH: Boolean(transform?.flipH),
    flipV: Boolean(transform?.flipV),
    crop: transform?.crop
      ? {
          x: transform.crop.x,
          y: transform.crop.y,
          w: transform.crop.w,
          h: transform.crop.h,
        }
      : null,
  }
}
```

对于没有调色或 transform 的 layer，可传默认值，或在 Rust 层用 `Option` 判断。推荐在 Electron wrapper 层补齐默认值，Rust 层拿到稳定结构。

## Rust/wgpu 改造

Rust 入参结构增加 `color` 和 `transform` 字段，与 TypeScript 的 `RenderColorAdjustments` / `RenderLayerTransform` 对齐。

wgpu 渲染阶段按 layer 处理：

1. 根据该 layer 的 `transform` 计算源纹理 UV。
2. 应用 `crop`，只采样裁切区域。
3. 应用 `orientation`、`rotate`、`flipH`、`flipV`。
4. 采样源纹理。
5. 应用该 layer 的 `color` 调色参数。
6. 应用透明度。
7. 按 zIndex 合成到目标画布。

transform 执行语义：

- `crop` 使用源媒体归一化坐标，`{ x: 0, y: 0, w: 1, h: 1 }` 表示完整源图。
- `orientation` 表示 90 度方向旋转，用于左旋/右旋按钮。
- `rotate` 表示用户微调旋转角度，单位为度。
- `flipH` / `flipV` 在同一套源 UV 变换中处理。
- 超出源图采样范围的区域由 Rust/wgpu 统一决定填充策略，默认使用透明或黑色背景，但预览和导出必须一致。

第一批调色建议实现：

- 曝光
- 亮度
- 对比度
- 饱和度
- 色温
- 色调

第二批：

- 高光
- 阴影
- 白色
- 黑色
- 鲜艳度

第三批：

- 清晰度
- 纹理
- 锐化
- 降噪

第四批：

- 曲线
- Levels
- HSL
- 色彩分级

每一批完成后都要确认预览和导出使用同一套 layer 数据。

## 删除旧组件

新链路跑通后删除：

`src/workspace/components/ImagePreview.tsx`

删除前扫描引用：

```bash
rg "ImagePreview|ImagePreviewHandle" src
```

确认没有引用后再删除。

编辑工作台旧 LUT、WebGL 和过渡渲染代码必须在本轮清理，不保留回退链路：

```bash
rg "ImagePreview|useCanvasEngine|useNativeCanvasEngine|workspace/renderer|bakeAndGetLut|colorLutKey" src electron
```

清理时注意：创意空间相关文件暂不处理，例如 `src/workspace/creative/**` 下仍在使用的 WebGL/LUT 代码可以保留。

## 分步实施顺序

### 第一步：PreviewStage 接入工作台

1. `WorkspacePage.tsx` 切换到 `PreviewStage`。
2. `PreviewStage` 增加 `pipeline` prop。
3. 主媒体 layer 挂载 `color` 字段。
4. 暂不删除旧 `ImagePreview`。

### 第二步：打通 layer.color 到 Electron

1. 扩展共享类型。
2. 扩展 `LrcRender` 调用链。
3. 扩展 `ipcLunaRenderCore.ts`。
4. 扩展 `lunaRenderCore.ts` 的 normalize 逻辑。

### 第三步：打通 layer.transform 到 Electron

1. 将 `pipeline.transform` 映射为 `layer.transform`。
2. 扩展 `LrcRender` 调用链。
3. 扩展 `ipcLunaRenderCore.ts`。
4. 扩展 `lunaRenderCore.ts` 的 normalize 逻辑。
5. 确认预览和导出都传同一份 transform 数据。

### 第四步：Rust/wgpu 实现基础 transform

1. Rust 输入 struct 增加调色字段。
2. Rust 输入 struct 增加 transform 字段。
3. wgpu shader 增加 per-layer transform 数据。
4. 实现 crop、orientation、rotate、flipH、flipV。
5. 对齐预览和导出。

### 第五步：Rust/wgpu 实现基础调色

1. wgpu shader 增加基础调色 uniform/storage 数据。
2. 实现第一批基础调色参数。
3. 对齐预览和导出。

### 第六步：清理旧预览组件

1. 确认工作台预览、视频、Live Photo、对比原图可用。
2. 删除 `src/workspace/components/ImagePreview.tsx`。
3. 扫描并移除残留引用。

### 第七步：逐批补齐高级调色

按批次补：

1. 高光/阴影/白色/黑色/鲜艳度。
2. 清晰度/纹理/锐化/降噪。
3. 曲线/Levels/HSL/色彩分级。

## 验证

构建：

```bash
pnpm run build:app
```

手动验证：

1. 工作台能显示当前素材。
2. 切换素材后预览刷新。
3. 调色滑块改变后，主媒体 layer 的 `color` 字段变化。
4. 裁切、90 度旋转、微调旋转、水平翻转、垂直翻转改变后，主媒体 layer 的 `transform` 字段变化。
5. Rust/wgpu 输出产生对应视觉和几何变化。
6. 按住空格或点击“对比”时恢复默认调色和默认 transform。
7. 图片、视频、Live Photo 至少不回退到 LUT 或 WebGL transform 链路。
8. 导出和预览使用相同 layer 调色和 transform 数据。
