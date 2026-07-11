基于你当前的多层合成结构，**不要把“边框”做成图片层上的一个巨大配置对象**。更合适的方式是：

> 一个边框预设，本质上是一组普通渲染层：背景层 + 主图层 + 装饰层 + Logo 层 + 文本层。

这样你现在的多层排序、预览、导出流程都可以继续复用，后续做拍立得、胶片、模糊背景、摄影参数、Logo、标题，也不需要不停修改图片层结构。

---

# 一、建议统一成可判别的 Layer 结构

你当前的 `PreviewLayer` 和 `CompositionLayer` 主要只能描述图片、视频，建议扩展为以下几种层：

```typescript
type LayerType =
  | 'media'
  | 'shape'
  | 'text'
  | 'logo'
  | 'decoration'
  | 'group'
```

其中：

* `media`：图片或视频
* `shape`：纯色、渐变、半透明底板、描边
* `text`：标题、日期、地点、拍摄参数
* `logo`：品牌 Logo、用户 Logo、相机品牌标志
* `decoration`：胶片孔、编号、分割线、角标
* `group`：对一个边框预设的多个层进行分组

---

# 二、统一的基础层结构

建议先抽出所有层共有字段：

```typescript
interface BaseLayer {
  id: string

  type:
    | 'media'
    | 'shape'
    | 'text'
    | 'logo'
    | 'decoration'
    | 'group'

  // 归一化 0-1，相对于最终输出画布
  rect: {
    x: number
    y: number
    w: number
    h: number
  }

  opacity?: number
  zIndex: number
  visible?: boolean

  // 用于边框预设的层级组织
  parentId?: string
  groupId?: string

  transform?: {
    rotation?: number
    scaleX?: number
    scaleY?: number
    anchorX?: number
    anchorY?: number
  }

  // 通用混合模式，第一版可只支持 normal
  blendMode?: 'normal' | 'multiply' | 'screen' | 'overlay'
}
```

`rect` 仍然使用你当前的归一化体系，不需要改变现有布局机制。

---

# 三、媒体层扩展

你原来的 `CompositionLayer` 可以升级为：

```typescript
interface MediaLayer extends BaseLayer {
  type: 'media'

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

  crop?: {
    x: number
    y: number
    w: number
    h: number
  }

  fit?: 'contain' | 'cover' | 'stretch' | 'cover-scale'

  lutId?: string
  lutIntensity?: number

  effects?: {
    blur?: number
    brightness?: number
    saturation?: number

    cornerRadius?: number

    stroke?: {
      width: number
      color: string
      opacity?: number
      position?: 'inside' | 'center' | 'outside'
    }

    shadow?: {
      enabled: boolean
      color?: string
      opacity?: number
      blur?: number
      offsetX?: number
      offsetY?: number
    }
  }
}
```

这里最重要的是增加：

```typescript
effects.blur
effects.cornerRadius
effects.stroke
effects.shadow
```

因为这些效果会被大量边框预设使用。

例如模糊背景边框，本质上就是同一张图片出现两次：

```text
media-background：铺满画布，cover，blur=30
media-main：居中显示，contain，带阴影
```

---

# 四、纯色和渐变 Shape 层

边框背景、底部信息栏、分割线，都可以使用 `shape` 层：

```typescript
interface ShapeLayer extends BaseLayer {
  type: 'shape'

  shape: 'rectangle' | 'rounded-rectangle' | 'line' | 'circle'

  fill?: {
    type: 'solid' | 'linear-gradient' | 'radial-gradient'

    color?: string

    gradient?: {
      angle?: number
      stops: Array<{
        offset: number
        color: string
      }>
    }
  }

  cornerRadius?: number

  stroke?: {
    width: number
    color: string
    opacity?: number
  }

  shadow?: {
    enabled: boolean
    color?: string
    opacity?: number
    blur?: number
    offsetX?: number
    offsetY?: number
  }
}
```

例如一个白色画布背景：

```json
{
  "id": "frame-background",
  "type": "shape",
  "shape": "rectangle",
  "rect": {
    "x": 0,
    "y": 0,
    "w": 1,
    "h": 1
  },
  "fill": {
    "type": "solid",
    "color": "#F8F7F3"
  },
  "zIndex": 0
}
```

---

# 五、文本层

拍摄参数、标题、地点、日期都应该做成独立文本层：

```typescript
interface TextLayer extends BaseLayer {
  type: 'text'

  content: string

  // 支持 EXIF 或业务数据变量
  template?: boolean

  style: {
    fontFamily: string
    fontSize: number
    fontWeight?: number
    fontStyle?: 'normal' | 'italic'

    color: string

    align?: 'left' | 'center' | 'right'
    verticalAlign?: 'top' | 'middle' | 'bottom'

    letterSpacing?: number
    lineHeight?: number

    uppercase?: boolean

    shadow?: {
      color?: string
      opacity?: number
      blur?: number
      offsetX?: number
      offsetY?: number
    }
  }

  overflow?: 'clip' | 'ellipsis' | 'shrink'
}
```

支持模板变量：

```text
{{camera}}
{{lens}}
{{focalLength}}
{{aperture}}
{{shutter}}
{{iso}}
{{date}}
{{location}}
{{title}}
{{sequence}}
```

例如：

```json
{
  "content": "{{camera}} · {{focalLength}} · {{aperture}} · {{shutter}} · ISO {{iso}}",
  "template": true
}
```

渲染前由前端或 Rust 替换成：

```text
Luna Ultra · 24mm · f/2.8 · 1/500s · ISO 100
```

建议最终由 Rust 负责模板解析，保证预览与导出一致。

---

# 六、Logo 层

Logo 不建议强行塞到文本层里，单独做 `logo`：

```typescript
interface LogoLayer extends BaseLayer {
  type: 'logo'

  source?: {
    path?: string
    dataBase64?: string
    format?: 'png' | 'svg'
  }

  // 没有图片 Logo 时，可使用文字 Logo
  fallbackText?: string

  tint?: {
    color: string
    opacity?: number
  }

  fit?: 'contain' | 'cover'

  preserveAspectRatio?: boolean
}
```

例如：

```json
{
  "id": "brand-logo",
  "type": "logo",
  "rect": {
    "x": 0.065,
    "y": 0.855,
    "w": 0.12,
    "h": 0.035
  },
  "fallbackText": "LUNA FRAME",
  "tint": {
    "color": "#222222",
    "opacity": 1
  },
  "fit": "contain",
  "zIndex": 20
}
```

Logo 最好同时支持：

* 内置 Logo
* 用户上传 Logo
* 文字品牌名
* SVG
* PNG 透明图

---

# 七、装饰层

胶片孔、角标、编号、细分割线可以使用 `decoration`：

```typescript
interface DecorationLayer extends BaseLayer {
  type: 'decoration'

  decorationType:
    | 'film-holes'
    | 'divider'
    | 'corner-mark'
    | 'frame-number'
    | 'texture'
    | 'custom-image'

  source?: {
    path?: string
    dataBase64?: string
  }

  color?: string
  repeat?: 'none' | 'x' | 'y'
}
```

实际上第一版中，大部分分割线都可以直接用 `ShapeLayer`，只有胶片孔和特殊纹理需要 `DecorationLayer`。

---

# 八、最终统一类型

```typescript
type CompositionLayer =
  | MediaLayer
  | ShapeLayer
  | TextLayer
  | LogoLayer
  | DecorationLayer
  | GroupLayer
```

分组层：

```typescript
interface GroupLayer extends BaseLayer {
  type: 'group'

  name?: string

  metadata?: {
    presetId?: string
    presetName?: string
    presetCategory?: string
  }
}
```

Rust 侧可以使用 `serde` 的 tagged enum：

```rust
#[serde(tag = "type")]
enum CompositionLayer {
    #[serde(rename = "media")]
    Media(MediaLayer),

    #[serde(rename = "shape")]
    Shape(ShapeLayer),

    #[serde(rename = "text")]
    Text(TextLayer),

    #[serde(rename = "logo")]
    Logo(LogoLayer),

    #[serde(rename = "decoration")]
    Decoration(DecorationLayer),

    #[serde(rename = "group")]
    Group(GroupLayer),
}
```

---

# 九、PreviewLayer 不建议继续单独扩展

目前你有：

* `PreviewLayer`
* `CompositionLayer`

这两个结构如果继续分别维护，后面会非常容易不一致。

推荐改成：

```typescript
type PreviewLayer = CompositionLayer
```

预览时额外传递一个上下文：

```typescript
interface PreviewRenderRequest {
  canvas: {
    width: number
    height: number
  }

  layers: CompositionLayer[]

  preview?: {
    maxWidth?: number
    maxHeight?: number
    quality?: 'low' | 'medium' | 'high'
  }

  variables?: Record<string, string | number>
}
```

导出请求：

```typescript
interface ExportRenderRequest {
  canvas: {
    width: number
    height: number
    fps?: number
    duration?: number
  }

  layers: CompositionLayer[]

  variables?: Record<string, string | number>
}
```

这样预览和导出的差别只有：

* 输出尺寸
* 视频时间
* 预览质量

层数据完全相同。

---

# 十、边框预设整体数据

一个边框预设可以定义为：

```typescript
interface FramePreset {
  id: string
  name: string
  category:
    | 'minimal'
    | 'film'
    | 'blur'
    | 'gallery'
    | 'polaroid'
    | 'magazine'

  thumbnail?: string

  canvas: {
    aspectRatio: 'original' | '1:1' | '4:3' | '3:2' | '16:9'
    backgroundColor?: string
  }

  layers: CompositionLayer[]

  variables?: {
    key: string
    label: string
    type: 'text' | 'number' | 'color' | 'boolean'
    defaultValue?: string | number | boolean
  }[]
}
```

应用预设时：

1. 克隆预设的所有层。
2. 将 `{{sourcePath}}` 替换成当前素材路径。
3. 读取 EXIF。
4. 填充拍摄参数。
5. 生成最终 Composition。

---

# 十一、四套视觉边框对应的层数据

以下以一个 **16:9 原始素材**为例。

---

## 方案一：经典大厂白边

布局：

```text
背景：米白色
主图：上方大图
底部左侧：Logo
底部中间：地点 + 日期
底部右侧：拍摄参数
```

```json
{
  "id": "frame-white-premium",
  "name": "经典白边",
  "category": "minimal",
  "canvas": {
    "aspectRatio": "4:3",
    "backgroundColor": "#F7F6F2"
  },
  "layers": [
    {
      "id": "frame-group",
      "type": "group",
      "rect": { "x": 0, "y": 0, "w": 1, "h": 1 },
      "zIndex": 0,
      "metadata": {
        "presetId": "frame-white-premium",
        "presetName": "经典白边"
      }
    },
    {
      "id": "background",
      "type": "shape",
      "parentId": "frame-group",
      "shape": "rectangle",
      "rect": { "x": 0, "y": 0, "w": 1, "h": 1 },
      "fill": {
        "type": "solid",
        "color": "#F7F6F2"
      },
      "zIndex": 0
    },
    {
      "id": "main-image",
      "type": "media",
      "parentId": "frame-group",
      "source": {
        "path": "{{sourcePath}}",
        "sourceType": "image"
      },
      "rect": {
        "x": 0.055,
        "y": 0.055,
        "w": 0.89,
        "h": 0.75
      },
      "crop": {
        "x": 0,
        "y": 0,
        "w": 1,
        "h": 1
      },
      "fit": "cover",
      "effects": {
        "cornerRadius": 0,
        "shadow": {
          "enabled": false
        }
      },
      "zIndex": 10
    },
    {
      "id": "logo",
      "type": "logo",
      "parentId": "frame-group",
      "rect": {
        "x": 0.06,
        "y": 0.855,
        "w": 0.14,
        "h": 0.035
      },
      "fallbackText": "LUNA FRAME",
      "tint": {
        "color": "#202020"
      },
      "zIndex": 20
    },
    {
      "id": "location-date",
      "type": "text",
      "parentId": "frame-group",
      "rect": {
        "x": 0.35,
        "y": 0.85,
        "w": 0.3,
        "h": 0.05
      },
      "content": "{{location}} · {{date}}",
      "template": true,
      "style": {
        "fontFamily": "Inter",
        "fontSize": 18,
        "fontWeight": 400,
        "color": "#555555",
        "align": "center",
        "verticalAlign": "middle",
        "letterSpacing": 0.04
      },
      "zIndex": 20
    },
    {
      "id": "camera-meta",
      "type": "text",
      "parentId": "frame-group",
      "rect": {
        "x": 0.66,
        "y": 0.85,
        "w": 0.285,
        "h": 0.05
      },
      "content": "{{camera}} {{focalLength}} | {{aperture}} | {{shutter}} | ISO {{iso}}",
      "template": true,
      "style": {
        "fontFamily": "Inter",
        "fontSize": 16,
        "fontWeight": 400,
        "color": "#444444",
        "align": "right",
        "verticalAlign": "middle"
      },
      "overflow": "shrink",
      "zIndex": 20
    }
  ]
}
```

---

## 方案二：黑金胶片边框

```text
黑色纹理背景
顶部左侧品牌
顶部右侧编号
主图带细金色描边
底部地点和拍摄参数
```

```json
{
  "id": "frame-black-film",
  "name": "黑金胶片",
  "category": "film",
  "canvas": {
    "aspectRatio": "4:3",
    "backgroundColor": "#111111"
  },
  "layers": [
    {
      "id": "black-background",
      "type": "shape",
      "shape": "rectangle",
      "rect": { "x": 0, "y": 0, "w": 1, "h": 1 },
      "fill": {
        "type": "solid",
        "color": "#111111"
      },
      "zIndex": 0
    },
    {
      "id": "main-image",
      "type": "media",
      "source": {
        "path": "{{sourcePath}}",
        "sourceType": "image"
      },
      "rect": {
        "x": 0.07,
        "y": 0.13,
        "w": 0.86,
        "h": 0.69
      },
      "fit": "cover",
      "effects": {
        "stroke": {
          "width": 1.5,
          "color": "#B99A62",
          "opacity": 0.9,
          "position": "outside"
        }
      },
      "zIndex": 10
    },
    {
      "id": "film-brand",
      "type": "text",
      "rect": {
        "x": 0.07,
        "y": 0.05,
        "w": 0.25,
        "h": 0.04
      },
      "content": "LUNA FILM",
      "style": {
        "fontFamily": "Cormorant Garamond",
        "fontSize": 18,
        "fontWeight": 500,
        "color": "#C7AA77",
        "align": "left",
        "letterSpacing": 0.28
      },
      "zIndex": 20
    },
    {
      "id": "frame-number",
      "type": "text",
      "rect": {
        "x": 0.75,
        "y": 0.05,
        "w": 0.18,
        "h": 0.04
      },
      "content": "No. {{sequence}}",
      "template": true,
      "style": {
        "fontFamily": "Cormorant Garamond",
        "fontSize": 18,
        "fontWeight": 400,
        "color": "#C7AA77",
        "align": "right"
      },
      "zIndex": 20
    },
    {
      "id": "film-location",
      "type": "text",
      "rect": {
        "x": 0.07,
        "y": 0.86,
        "w": 0.38,
        "h": 0.05
      },
      "content": "{{location}} · {{date}}",
      "template": true,
      "style": {
        "fontFamily": "Cormorant Garamond",
        "fontSize": 20,
        "fontWeight": 500,
        "color": "#C7AA77",
        "align": "left",
        "letterSpacing": 0.06
      },
      "zIndex": 20
    },
    {
      "id": "film-meta",
      "type": "text",
      "rect": {
        "x": 0.52,
        "y": 0.86,
        "w": 0.41,
        "h": 0.05
      },
      "content": "{{focalLength}} | {{aperture}} | {{shutter}} | ISO {{iso}}",
      "template": true,
      "style": {
        "fontFamily": "Cormorant Garamond",
        "fontSize": 20,
        "fontWeight": 500,
        "color": "#C7AA77",
        "align": "right",
        "letterSpacing": 0.04
      },
      "zIndex": 20
    }
  ]
}
```

---

## 方案三：模糊背景 + 玻璃参数栏

核心是重复使用同一素材：

```text
第 1 层：图片放大铺满，模糊
第 2 层：半透明暗色遮罩
第 3 层：清晰主图
第 4 层：底部半透明玻璃信息栏
第 5 层：Logo 和参数
```

```json
{
  "id": "frame-blur-glass",
  "name": "模糊玻璃",
  "category": "blur",
  "canvas": {
    "aspectRatio": "4:3"
  },
  "layers": [
    {
      "id": "blur-background",
      "type": "media",
      "source": {
        "path": "{{sourcePath}}",
        "sourceType": "image"
      },
      "rect": {
        "x": 0,
        "y": 0,
        "w": 1,
        "h": 1
      },
      "fit": "cover",
      "effects": {
        "blur": 32,
        "brightness": -0.08,
        "saturation": 0.85
      },
      "zIndex": 0
    },
    {
      "id": "background-overlay",
      "type": "shape",
      "shape": "rectangle",
      "rect": {
        "x": 0,
        "y": 0,
        "w": 1,
        "h": 1
      },
      "fill": {
        "type": "solid",
        "color": "#000000"
      },
      "opacity": 0.18,
      "zIndex": 1
    },
    {
      "id": "main-image",
      "type": "media",
      "source": {
        "path": "{{sourcePath}}",
        "sourceType": "image"
      },
      "rect": {
        "x": 0.07,
        "y": 0.09,
        "w": 0.86,
        "h": 0.69
      },
      "fit": "cover",
      "effects": {
        "cornerRadius": 0.012,
        "stroke": {
          "width": 1,
          "color": "#FFFFFF",
          "opacity": 0.42,
          "position": "inside"
        },
        "shadow": {
          "enabled": true,
          "color": "#000000",
          "opacity": 0.3,
          "blur": 0.025,
          "offsetY": 0.012
        }
      },
      "zIndex": 10
    },
    {
      "id": "glass-panel",
      "type": "shape",
      "shape": "rounded-rectangle",
      "rect": {
        "x": 0.07,
        "y": 0.78,
        "w": 0.86,
        "h": 0.13
      },
      "fill": {
        "type": "solid",
        "color": "#101010"
      },
      "opacity": 0.62,
      "cornerRadius": 0.012,
      "stroke": {
        "width": 1,
        "color": "#FFFFFF",
        "opacity": 0.28
      },
      "zIndex": 11
    },
    {
      "id": "glass-logo",
      "type": "logo",
      "rect": {
        "x": 0.1,
        "y": 0.815,
        "w": 0.13,
        "h": 0.04
      },
      "fallbackText": "LUNA",
      "tint": {
        "color": "#FFFFFF"
      },
      "zIndex": 20
    },
    {
      "id": "glass-divider",
      "type": "shape",
      "shape": "line",
      "rect": {
        "x": 0.255,
        "y": 0.805,
        "w": 0.001,
        "h": 0.07
      },
      "fill": {
        "type": "solid",
        "color": "#FFFFFF"
      },
      "opacity": 0.35,
      "zIndex": 20
    },
    {
      "id": "glass-meta-main",
      "type": "text",
      "rect": {
        "x": 0.3,
        "y": 0.8,
        "w": 0.55,
        "h": 0.045
      },
      "content": "{{camera}} · {{focalLength}} · {{shutter}} · ISO {{iso}}",
      "template": true,
      "style": {
        "fontFamily": "Inter",
        "fontSize": 21,
        "fontWeight": 500,
        "color": "#FFFFFF",
        "align": "left",
        "verticalAlign": "middle"
      },
      "zIndex": 20
    },
    {
      "id": "glass-meta-secondary",
      "type": "text",
      "rect": {
        "x": 0.3,
        "y": 0.85,
        "w": 0.55,
        "h": 0.035
      },
      "content": "{{location}} · {{title}}",
      "template": true,
      "style": {
        "fontFamily": "Inter",
        "fontSize": 16,
        "fontWeight": 400,
        "color": "#DADADA",
        "align": "left"
      },
      "zIndex": 20
    }
  ]
}
```

---

## 方案四：摄影展览边框

```text
米白纸张质感
多层细描边
底部大标题
左侧 Logo
下方拍摄参数
右侧 Edition
```

```json
{
  "id": "frame-gallery",
  "name": "摄影展览",
  "category": "gallery",
  "canvas": {
    "aspectRatio": "4:3",
    "backgroundColor": "#F1EDE4"
  },
  "layers": [
    {
      "id": "gallery-background",
      "type": "shape",
      "shape": "rectangle",
      "rect": { "x": 0, "y": 0, "w": 1, "h": 1 },
      "fill": {
        "type": "solid",
        "color": "#F1EDE4"
      },
      "zIndex": 0
    },
    {
      "id": "gallery-inner-border",
      "type": "shape",
      "shape": "rectangle",
      "rect": {
        "x": 0.04,
        "y": 0.04,
        "w": 0.92,
        "h": 0.9
      },
      "fill": {
        "type": "solid",
        "color": "#00000000"
      },
      "stroke": {
        "width": 1,
        "color": "#BFB6A5",
        "opacity": 0.65
      },
      "zIndex": 1
    },
    {
      "id": "gallery-main-image",
      "type": "media",
      "source": {
        "path": "{{sourcePath}}",
        "sourceType": "image"
      },
      "rect": {
        "x": 0.07,
        "y": 0.07,
        "w": 0.86,
        "h": 0.67
      },
      "fit": "cover",
      "effects": {
        "stroke": {
          "width": 1,
          "color": "#D4CBBB",
          "opacity": 0.8,
          "position": "outside"
        }
      },
      "zIndex": 10
    },
    {
      "id": "gallery-logo",
      "type": "logo",
      "rect": {
        "x": 0.07,
        "y": 0.8,
        "w": 0.15,
        "h": 0.055
      },
      "fallbackText": "LUNA STUDIO",
      "tint": {
        "color": "#292720"
      },
      "zIndex": 20
    },
    {
      "id": "gallery-title",
      "type": "text",
      "rect": {
        "x": 0.29,
        "y": 0.77,
        "w": 0.42,
        "h": 0.07
      },
      "content": "{{title}}",
      "template": true,
      "style": {
        "fontFamily": "Playfair Display",
        "fontSize": 42,
        "fontWeight": 600,
        "color": "#23211D",
        "align": "center",
        "verticalAlign": "middle"
      },
      "overflow": "shrink",
      "zIndex": 20
    },
    {
      "id": "gallery-meta",
      "type": "text",
      "rect": {
        "x": 0.24,
        "y": 0.85,
        "w": 0.53,
        "h": 0.04
      },
      "content": "{{location}} · {{focalLength}} · {{aperture}} · {{shutter}} · ISO {{iso}} · {{date}}",
      "template": true,
      "style": {
        "fontFamily": "Inter",
        "fontSize": 16,
        "fontWeight": 400,
        "color": "#39362F",
        "align": "center"
      },
      "overflow": "shrink",
      "zIndex": 20
    },
    {
      "id": "gallery-edition",
      "type": "text",
      "rect": {
        "x": 0.8,
        "y": 0.84,
        "w": 0.13,
        "h": 0.04
      },
      "content": "Edition {{sequence}}",
      "template": true,
      "style": {
        "fontFamily": "Inter",
        "fontSize": 15,
        "fontWeight": 400,
        "color": "#A48855",
        "align": "right"
      },
      "zIndex": 20
    }
  ]
}
```

---

# 十二、UI 参数与层字段的映射

你的右侧边框面板不需要直接编辑所有层，而是通过 UI 参数修改预设里的指定字段。

例如：

```typescript
interface FrameEditorState {
  presetId: string

  frameSize: number
  backgroundColor: string

  imageCornerRadius: number
  imageShadow: number

  showLogo: boolean
  logoPath?: string

  showTitle: boolean
  title?: string

  showLocation: boolean
  location?: string

  showDate: boolean
  showCameraInfo: boolean

  textColor?: string
}
```

映射关系：

| UI 参数   | 修改的层                         |
| ------- | ---------------------------- |
| 边框大小    | 主图 `rect`                    |
| 背景颜色    | 背景 `ShapeLayer.fill`         |
| 模糊程度    | 背景 `MediaLayer.effects.blur` |
| 圆角      | 主图 `effects.cornerRadius`    |
| 阴影      | 主图 `effects.shadow`          |
| Logo 开关 | LogoLayer.visible            |
| Logo 图片 | LogoLayer.source             |
| 标题      | TextLayer.content            |
| 拍摄参数开关  | 参数 TextLayer.visible         |
| 字体颜色    | TextLayer.style.color        |
| 地点日期    | 对应 TextLayer.content         |

---

# 十三、Rust 渲染顺序

Rust 中按 `zIndex` 排序后：

```text
1. group 不直接渲染
2. shape
3. media
4. decoration
5. logo
6. text
```

实际依然严格按照 `zIndex` 绘制，不需要固定类型顺序。

```rust
layers.sort_by_key(|layer| layer.z_index());
```

每一类层调用不同渲染器：

```text
render_shape_layer()
render_media_layer()
render_text_layer()
render_logo_layer()
render_decoration_layer()
```

其中边框功能新增的核心实现只有：

* Shape 绘制
* Text 绘制
* Logo 绘制
* 阴影
* 圆角裁切
* 模糊
* 描边

主体图片和视频渲染逻辑仍然复用你现在的 `media` 渲染链路。

最终建议是：**把你现有的图片/视频层升级为 `MediaLayer`，再新增 Shape、Text、Logo、Decoration 四种层。边框预设只保存一组层，不单独侵入主素材层。**这样后面所有视觉边框都只是配置数据，而不是新增 Rust 特效代码。
