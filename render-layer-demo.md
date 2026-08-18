# 渲染层结构参考

## 基本概念

WebGPU Composition renderer 将每一层视为一张**平面纹理**，合成到输出画布上。层可以是视频帧、静态图片，或 base64 编码的图片数据。

---

## 层数据格式（TypeScript）

### 1. `PreviewLayer` — 前端传给 WebGPU renderer 的层描述

```typescript
interface PreviewLayer {
  // ── 源数据（三选一） ──
  filePath: string           // 本地文件路径，如 "/path/to/photo.jpg"
  imageDataBase64?: string   // base64 PNG 数据（优先于 filePath）

  // ── 视频（仅视频层需要） ──
  isVideo?: boolean          // true = 视频层，false/undefined = 静态图
  videoTime?: number         // 视频时间点（秒）

  // ── 显示区域（归一化 0-1，相对于输出画布） ──
  dstX: number   // 左上角 X
  dstY: number   // 左上角 Y
  dstW: number   // 宽度
  dstH: number   // 高度

  // ── 源裁切（归一化 0-1，相对于图片/视频） ──
  srcX: number   // 裁切起始 X
  srcY: number   // 裁切起始 Y
  srcW: number   // 裁切宽度
  srcH: number   // 裁切高度

  // ── 混合 ──
  opacity: number  // 不透明度 0-1
  zIndex: number   // 层级（越大越靠上）

  // ── 适配方式 ──
  fit?: 'cover' | 'cover-scale'

  // ── LUT 滤镜 ──
  lutId?: string      // .cube 文件路径
  lutIntensity?: number  // LUT 强度 0-100
}
```

### 2. `CompositionLayer` — 导出/合成输入

```typescript
interface CompositionLayer {
  id?: string
  source: {
    path: string
    sourceType?: 'auto' | 'image' | 'video'
    time?: {
      offset?: number
      start?: number
      duration?: number
      loopEnabled?: boolean
    }
  }
  rect: { x: number; y: number; w: number; h: number }  // 归一化 0-1
  fit?: string
  opacity?: number
  zIndex?: number
  lutId?: string
  lutIntensity?: number
  imageDataBase64?: string  // 优先于 source.path
}
```

---

## 典型 demo：三层合成

```typescript
const layers: PreviewLayer[] = [
  // 第 0 层：主画面（底层）
  {
    filePath: '/path/to/photo.jpg',
    dstX: 0, dstY: 0, dstW: 1, dstH: 1,
    srcX: 0, srcY: 0, srcW: 1, srcH: 1,
    opacity: 1,
    zIndex: 0,
  },
  // 第 1 层：水印（左下角）
  {
    filePath: '/path/to/watermark.png',
    dstX: 0.033, dstY: 0.059, dstW: 0.191, dstH: 0.1,
    srcX: 0, srcY: 0, srcW: 1, srcH: 1,
    opacity: 0.8,
    zIndex: 1,
    positioning: {                      // 自动定位
      anchor: 'bottom-left',
      targetWidth: 0.22,
      marginX: 0.033,
      marginY: 0.059,
    },
  },
  // 第 2 层：边框（底部信息条）
  {
    filePath: '',                       // base64 数据，filePath 留空
    imageDataBase64: 'iVBORw0KGgo...',  // Canvas 绘制的边框 PNG（base64）
    dstX: 0, dstY: 0.92, dstW: 1, dstH: 0.08,
    srcX: 0, srcY: 0, srcW: 1, srcH: 1,
    opacity: 1,
    zIndex: 10,
  },
]
```

输出画布尺寸：`{ width: 3840, height: 2160 }`

```
┌────────────────────────────────────────────────┐
│                                                │
│                 主画面（zIndex=0）                │
│                  photo.jpg                     │
│                                                │
│                                                │
│                                                │
│                                                │
│                                                │
│  ┌──────┐                              ┌────┐ │
│  │水印  │                              │边框 │ │
│  │z=1   │                              │z=10│ │
│  └──────┘                              └────┘ │
└────────────────────────────────────────────────┘
```

---

## 层合成规则

1. **按 zIndex 升序合成**，大的在上层
2. **坐标归一化** 0-1，renderer 内部按输出分辨率换算像素
3. **适配方式** `fit: 'cover'`：源图等比缩放填满 dst 区域，多余裁切
4. **视频层**：renderer 从媒体元素或解码帧读取对应时间点，逐帧更新纹理
5. **base64 层**：ffmpeg pipe:0 解码 → GPU 纹理，每帧重新加载（不缓存）
6. **positioning**：自动锚点定位，水印按画布比例保持不变形

---

## WebGPU Composition renderer 对应结构（简化）

```typescript
struct PreviewLayerInput {
    file_path: String,
    is_video: bool,
    video_time: f64,
    fit: String,
    dst_x: f64, dst_y: f64, dst_w: f64, dst_h: f64,
    src_x: f64, src_y: f64, src_w: f64, src_h: f64,
    opacity: f64,
    z_index: i32,
    positioning: Option<LayerPositioning>,
    lut_id: Option<String>,
    lut_intensity: Option<f64>,
    image_data_base64: Option<String>,
    // 调色相关字段已省略
}
```
