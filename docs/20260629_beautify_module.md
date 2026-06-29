# 美颜模块设计方案

> 日期：2026-06-29
> 关联文档：[20260629_feature_plan.md](./20260629_feature_plan.md) — 工作台功能规划
> 定位：作为工作台 `EditPipeline` 的 Beautify Stage 独立子模块

---

## 一、架构总览

美颜采用 **三步流水线：人脸检测 → 关键点 → 语义分割**，输出 mask 后传入 GPU Shader 做实时预览，OpenCV/libvips 做导出。

```
          原图 / Preview 图
                │
                ▼
     ┌─────────────────────┐
     │  ① SCRFD            │  ONNX Runtime (CPU)
     │  人脸检测             │
     └─────────┬───────────┘
               │ 人脸框 (Bounding Box)
               ▼
     ┌─────────────────────┐
     │  ② 106 Landmark     │  ONNX Runtime (CPU)
     │  人脸关键点           │
     └─────────┬───────────┘
               │ 106 个关键点坐标
               ▼
     ┌─────────────────────┐
     │  ③ BiSeNet          │  ONNX Runtime (CPU/GPU)
     │  Face Parsing       │
     └─────────┬───────────┘
               │ 像素级 Label Map (512×512)
               ▼
     ┌─────────────────────┐
     │  Mask 生成            │
     │  ├── Skin Mask       │  磨皮、美白、肤色
     │  ├── Hair Mask       │  换发色（二期）
     │  └── Lip Mask        │  口红（二期）
     └─────────┬───────────┘
               │  maskTexture（单通道灰度图，与 Preview UV 对齐）
               ▼
     ┌─────────────────────┐
     │  WebGL Shader       │  实时预览（一次 pass blend）
     │  ← Color Stage      │
     │  → Beautify blend   │  mix(color, beautified, mask * intensity)
     │  → Effects Stage    │
     └─────────┬───────────┘
               │
        ┌──────┴──────┐
        ▼              ▼
   实时预览          导出
  (WebGL)     (WebGL readPixels / Canvas 混合)
```

---

## 二、三步 AI 模型详解

### ① SCRFD — 人脸检测

**作用**：在整张图片中定位人脸位置，输出人脸边界框。

**输入**：整张 Preview 图（长边 1500px）

**输出**：

```
Face 1: { x, y, width, height, score }
Face 2: { x, y, width, height, score }
...
```

**模型选型**：

| 模型 | 体积 | 精度 | 速度（CPU） | 推荐 |
|------|------|------|------------|------|
| SCRFD_500M | ~0.5MB | ★★★ | 极快 | 不推荐，精度偏低 |
| **SCRFD_2.5G** | ~2MB | ★★★★ | 快 | **推荐**，平衡最佳 |
| SCRFD_10G | ~8MB | ★★★★★ | 中 | 可选，追求极致精度 |

**推荐**：`SCRFD_2.5G`（ONNX 格式），桌面端 CPU 推理约 20-50ms。

---

### ② 106 Landmark — 人脸关键点

**作用**：在检测到的人脸区域内定位 106 个关键点，提供人脸几何信息。

**输入**：人脸框裁剪区域（SCRFD 输出）

**输出**：106 个 `{ x, y }` 坐标

```
左眼轮廓:    点 33-45
右眼轮廓:    点 72-84
鼻梁/鼻尖:   点 48-59
上嘴唇:      点 92-97
下嘴唇:      点 97-105
下巴轮廓:    点 0-16
左眉:        点 17-25
右眉:        点 26-32
```

**模型**：`2d106det.onnx`（InsightFace），体积约 3MB，CPU 推理约 10-20ms。

**用途**：

| 应用 | 依赖的关键点 |
|------|-------------|
| 瘦脸 | 下巴轮廓 0-16 |
| 大眼 | 眼睛轮廓 33-45, 72-84 |
| 鼻梁 | 鼻梁 48-55 |
| 微笑 | 嘴角 92, 105 |

---

### ③ BiSeNet Face Parsing — 人脸语义分割

**作用**：对每个像素分类，区分皮肤、头发、眼睛、嘴唇等区域。

**输入**：人脸框区域（缩放到 512×512）

**输出**：512×512 Label Map（每个像素一个类别 ID）

```
0  Background
1  Skin
2  Hair
3  Left Eye
4  Right Eye
5  Nose
6  Upper Lip
7  Lower Lip
8  Mouth Interior
9  Left Brow
10 Right Brow
```

**模型**：`bisenet_face_parsing.onnx`，体积约 5MB，CPU 推理约 50-100ms。

**用途**：

| 应用 | Label | 说明 |
|------|-------|------|
| 磨皮 | Skin (1) | 对皮肤区域做局部模糊 |
| 美白 | Skin (1) | 对皮肤区域提亮 |
| 口红 | Lip (6,7) | 改变嘴唇颜色（二期） |
| 换发色 | Hair (2) | 改变头发颜色（二期） |

#### Mask 生成流程

```
BiSeNet 输出 512×512 Label Map
        │
        ▼
提取 Skin Label → 缩放/对齐到 Preview UV → 单通道 maskTexture
        │
        ▼
mask 可选做边缘羽化（dilate + gaussian blur），避免边缘生硬
```

---

## 三、技术栈选型

| 模块 | 技术 | 运行位置 | 说明 |
|------|------|---------|------|
| AI 推理引擎 | **ONNX Runtime Web** | Web Worker (CPU) | 跨平台统一，CPU 推理足够快 |
| 人脸检测 | SCRFD_2.5G (.onnx) | Web Worker | <50ms/帧 |
| 人脸关键点 | 2d106det (.onnx) | Web Worker | <20ms/人脸 |
| 人脸分割 | BiSeNet (.onnx) | Web Worker | <100ms/人脸 |
| 几何变换（瘦脸） | **WebGL shader** 或 **Canvas 2D** | Renderer | GPU 实时 |
| 图像处理（磨皮） | **WebGL shader** | Renderer | 一次 pass blend |
| 导出处理 | **sharp** (libvips) / **Canvas** | Main Process | 全尺寸处理 |

### 为什么 AI 推理放在 CPU Worker？

- ONNX Runtime Web 支持 CPU（WebAssembly）和 GPU（WebGL）两种 backend
- 三个模型加起来单帧约 **100-170ms**（CPU），预览图切换时跑一次即可
- 推理在 Web Worker 中执行，完全不阻塞 UI
- GPU 推理虽然更快，但会增加 WebGL context 冲突风险，且首帧加载更慢
- **结论**：CPU Worker 推理已经够用，不需要增加 GPU 推理的复杂度

---

## 四、集成到工作台 EditPipeline

### 4.1 参数模型

```ts
// 在 shared/editPipeline.ts 中扩展
interface EditPipeline {
  // ... 已有字段 (transform, color, effects, lut)

  beautify: {
    enabled: boolean

    // 模型状态（只读，由系统维护）
    modelStatus: 'loading' | 'ready' | 'error'
    maskGenerated: boolean      // mask 是否已生成

    // 磨皮
    smooth: number              // 0 ~ 100  局部均值模糊强度
    // 美白
    whiten: number              // 0 ~ 100  肤色提亮强度
    // 肤色
    warmth: number              // -50 ~ +50 肤色冷暖偏移
    // 清晰度
    clarity: number             // 0 ~ 100  局部对比度增强

    // 几何美颜（二期）
    faceSlender: number         // 0 ~ 100  瘦脸
    eyeEnlarge: number          // 0 ~ 100  大眼
    noseThin: number            // 0 ~ 100  瘦鼻
    chinShorten: number         // 0 ~ 100  短下巴
  }
}
```

### 4.2 生命周期

```
打开素材（切换 Preview 图）
    │
    ▼
检测 GPU 可用 → 初始化 WebGL → 上传 Preview 纹理
    │
    ▼ (异步)
Web Worker 启动 ONNX Runtime
    │
    ├── 加载 SCRFD 模型   (~100ms)
    ├── 加载 Landmark 模型 (~60ms)
    ├── 加载 BiSeNet 模型   (~100ms)
    │
    ▼ (~260ms 首次加载)
模型就绪 (modelStatus = 'ready')
    │
    ▼
执行推理管线
    ├── SCRFD 检测人脸     (~30ms)
    ├── 对每张人脸：
    │   ├── 106 Landmark   (~15ms)
    │   └── BiSeNet Parsing (~70ms)
    └── 生成 Skin Mask     (~5ms)
    │
    ▼ (~120ms 推理)
maskGenerated = true → 上传 maskTexture → Shader 开始 blend
    │
    ▼
用户调节参数（smooth/whiten 等 → 只改 shader uniform → 实时预览）
```

### 4.3 Shader 集成

Beautify Stage 插入到 Color → Effects 之间：

```glsl
// beautify.glsl - 简化版本
uniform sampler2D inputTexture;
uniform sampler2D maskTexture;    // skin mask
uniform float u_smooth;
uniform float u_whiten;
uniform float u_warmth;
uniform float u_intensity;

vec3 beautify(vec3 color, float mask) {
    // 磨皮：局部均值模糊（用 3x3 采样近似）
    vec3 blurred = boxBlur(inputTexture, uv, 3);

    // 美白：HSV 空间提亮 V 通道
    vec3 whitened = whiten(color, u_whiten);

    // 肤色偏移
    vec3 warmed = colorShift(color, u_warmth);

    // 混合：mask 区域生效，非 mask 区域保持原样
    vec3 result = mix(color, blurred, mask * u_smooth * 0.01);
    result = mix(result, whitened, mask * u_whiten * 0.01);
    result = mix(result, warmed, mask * abs(u_warmth) * 0.01);

    return result;
}

void main() {
    vec4 texColor = texture2D(inputTexture, v_uv);
    float mask = texture2D(maskTexture, v_uv).r;

    vec3 final = beautify(texColor.rgb, mask);
    gl_FragColor = vec4(final, texColor.a);
}
```

### 4.4 无检测到人脸时的行为

- SCRFD 未检测到人脸 → 不生成 maskTexture → beautify 参数滑块可用但无效果
- UI 提示「未检测到人脸」或「美颜仅对人脸区域生效」
- 用户仍可调节参数，参数会保留，后续切换素材后自动重新推理

---

## 五、导出方案

### 图片导出

```
原图 (Original, ~8000×6000)
    │
    ▼
方案 A（推荐）：WebGL readPixels
  ├── 原图上传为 WebGL texture（可能受 max texture size 限制）
  ├── mask 缩放对齐
  ├── 一次 pass beautify → gl.readPixels → 编码 JPEG/PNG
  └── 优点：复用 shader，效果一致

方案 B（备选）：Canvas 2D + ImageData
  ├── 原图绘制到 offscreen Canvas
  ├── mask 拉伸覆盖
  ├── getImageData → 逐像素 blend → putImageData
  ├── 优点：无尺寸限制
  └── 缺点：大图较慢

方案 C：sharp 不支持 mask → 需在 renderer 侧完成
  └── 目前建议在 renderer 用方案 A/B 处理
```

### 视频导出

视频场景下逐帧推理 SCRFD + BiSeNet 性能不够（单帧 ~120ms × 30fps = 不现实）。

- **视频美颜暂不支持**，第一期只做图片美颜
- 后续可考虑：视频帧降采样 → 隔帧检测 + 跟踪 → 插值 mask

---

## 六、文件组织

```
src/workspace/beautify/
├── BeautifyPanel.tsx            # 美颜参数面板 UI
├── beautifyPipeline.ts          # 美颜管线编排（串联三步模型推理）
├── models/
│   ├── scrfd.ts                 # SCRFD 人脸检测封装
│   ├── landmark106.ts           # 106 Landmark 关键点封装
│   └── faceParsing.ts           # BiSeNet 人脸分割封装
├── skinMaskWorker.ts            # Web Worker 入口（装载 ONNX Runtime 运行三个模型）
├── maskUtils.ts                 # Mask 后处理（羽化、缩放、对齐 UV）
├── beautifyShaders.ts           # GLSL shader 源码 / 字符串模板
└── index.ts                     # 统一导出

public/models/                   # ONNX 模型文件（构建时复制到 dist）
├── scrfd_2.5g.onnx
├── 2d106det.onnx
└── bisenet_face_parsing.onnx
```

---

## 七、分阶段实施

### Phase 1 — 基础美颜（6-8 天）

| 步骤 | 内容 |
|------|------|
| 1.1 | ONNX Runtime Web 环境搭建 + Worker 通信框架 |
| 1.2 | SCRFD 人脸检测集成 + 多人脸支持 |
| 1.3 | BiSeNet Face Parsing 集成 |
| 1.4 | Skin Mask 生成 + 羽化 + 上传 GPU |
| 1.5 | beautify shader（smooth + whiten + warmth） |
| 1.6 | 导出方案（Canvas 2D / WebGL readPixels） |

### Phase 2 — 几何美颜（二期，4-5 天）

| 步骤 | 内容 |
|------|------|
| 2.1 | 106 Landmark 关键点集成 |
| 2.2 | 瘦脸（基于网格变形 / MLS） |
| 2.3 | 大眼、瘦鼻 |
| 2.4 | 几何变形在 shader 中的实现 |

### Phase 3 — 高级效果（三期，3-4 天）

| 步骤 | 内容 |
|------|------|
| 3.1 | 口红（Lip Mask → shader blend） |
| 3.2 | 腮红（cheek 区域检测） |
| 3.3 | 预设美颜套餐（"自然"、"甜美"、"复古"等） |

---

## 八、模型文件清单

| 文件 | 来源 | 体积 | 用途 |
|------|------|------|------|
| `scrfd_2.5g.onnx` | InsightFace | ~2MB | 人脸检测 |
| `2d106det.onnx` | InsightFace | ~3MB | 106 关键点 |
| `bisenet_face_parsing.onnx` | face-parsing | ~5MB | 人脸语义分割 |
| **合计** | | **~10MB** | |

> 模型托管策略：首次使用时从 CDN 下载到 `userData/models/` 缓存，不内置在安装包中。
> 或内置在 `public/models/` 中打包，安装包增加 ~10MB。

---

## 九、风险与注意事项

1. **多人脸性能**：每张人脸都需要独立运行 Landmark + BiSeNet，5 人合影约 500ms 推理。建议最多处理 5 张人脸，超出用最快的 3 张。

2. **Mask 边缘**：BiSeNet 输出的 label map 边缘较硬，需要做 dilate + gaussian blur 羽化，否则磨皮区域边缘会有明显断层。

3. **导出尺寸限制**：WebGL `maxTextureSize` 在多数 GPU 上是 16384，Insta360 原图 8000×6000 通常没问题。但如果超限，需分块渲染。

4. **模型加载时间**：首次加载三个模型约 260ms（CPU Worker），可在工作台页面打开时预加载，用户切换素材时直接推理。

5. **SCRFD + BiSeNet 不依赖 GPU**：ONNX Runtime Web 的 CPU(WASM) backend 足够快，不需要 WebGL backend，避免与渲染管线争抢 GPU 资源。

6. **Landmark 精度**：106 点对于瘦脸/大眼已经足够。如果追求更高精度，后续可升级到 468 点（MediaPipe Face Mesh）。
