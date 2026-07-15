# 美颜功能开发交接文档

更新时间：2026-07-15

工作区：`/Users/REDACTED/projects/luna-ai-cut/worktrees/feat-beauty`

分支：`feat-beauty`

## 1. 当前目标与用户最新要求

目标是实现接近像素蛋糕参考图的本地图片美颜，并将推理与后续美颜全部放到 Rust 中执行。

用户最新要求：

- 暂停检查 106 点和几何变形。
- 先把语义分割范围调准确。
- 调试画面只显示分割填充和分割边界，方便肉眼检查。
- 不启动 Electron 做算法测试；优先用 Node 直接调用原生模块。

当前最重要的回归图片：

```text
/Users/REDACTED/Pictures/LunaAI-Cut/localResources/IMG_20260620_182402_101.jpg
```

图片为 3840×2160 横图，人物位于右侧。

## 2. 当前原生推理流程

Web 端 MediaPipe/TFLite 推理已经移除。当前前端只调用：

```text
window.lunaRenderCore.analyzeBeauty(imagePath)
```

实际流程：

```text
Rust/ffmpeg 解码图片（最长边 2560）
→ YOLOX-Nano 检测人物
→ 只截取人物上半身近景框
→ BiSeNet 在人物近景框中提取 face-skin，生成可靠面部候选框
→ BiSeNet 在面部框中生成最终语义皮肤蒙版
→ 2d106det 生成 106 点（当前仍保留，但最新任务暂不调几何）
→ Rust/WGPU 执行磨皮、肤色和局部美颜
```

SCRFD 仍保留为“近景分割无法生成面部框”时的后备路径，不再对整张远景图运行。

主要文件：

- `luna-render-core/src/beauty_analysis.rs`：原生分析编排、SCRFD、106 点、最终蒙版。
- `luna-render-core/src/beauty_person.rs`：YOLOX-Nano 人物检测和人物上半身框。
- `luna-render-core/src/beauty_face_crop.rs`：从人物近景分割结果生成面部候选框。
- `luna-render-core/src/beauty.rs`：蒙版解码和关键点打包。
- `luna-render-core/src/shaders/beauty.wgsl`：磨皮、肤色和分割调试显示。
- `electron/ipcLunaRenderCore.ts`：IPC、模型路径和调用日志。
- `src/workspace/beauty/beautyAnalysis.ts`：前端原生分析入口和缓存版本。

## 3. ONNX 模型

模型目录：`luna-render-core/models/`

| 文件 | 用途 | SHA-256 |
| --- | --- | --- |
| `person-yolox-nano.onnx` | COCO 人物检测，约 3.5 MB | `c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d` |
| `scrfd-500m-kps.onnx` | 后备人脸检测和 5 点 | `5e4447f50245bbd7966bd6c0fa52938c61474a04ec7def48753668a9d8b4ea3a` |
| `face-landmarks-106.onnx` | 106 点面部结构 | `f001b856447c413801ef5c42091ed0cd516fcd21f2d6b79635b1e733a7109dbf` |
| `face-parsing-resnet18.onnx` | 19 类面部分割 | `0d9bd318e46987c3bdbfacae9e2c0f461cae1c6ac6ea6d43bbe541a91727e33f` |

许可证注意：

- YOLOX 代码为 Apache-2.0。
- UniFace/SCRFD 相关代码为 MIT。
- `face-parsing-resnet18.onnx` 使用 CelebAMask-HQ 训练，当前只能按非商业研究/教育使用。用户已明确当前为非商业用途。
- 模型来源和限制也记录在 `luna-render-core/models/README.md`。

## 4. 已确认解决的问题

### 4.1 “已识别皮肤，未找到清晰面部”误报

旧实现即使没有任何有效像素，也会返回一张全黑蒙版的 Base64 字符串。界面只判断字符串非空，所以误报已识别皮肤。

现已改为：蒙版没有非零像素时返回空字符串，宽高返回 0。

### 4.2 远景人脸无法识别

整图缩到 640 后，指定照片的人脸置信度过低。现使用 YOLOX-Nano 先找人物，再分析人物上半身近景。

### 4.3 SCRFD 在指定横图上产生异常高分假框

实际日志曾出现大量 `score=1.0000` 假候选。不能只取置信度最高的前三个。

当前处理：

- 不再在整张远景图上运行 SCRFD。
- 人物近景优先用 BiSeNet 的 face-skin 区域生成面部框。
- SCRFD 仅作为近景分割失败后的后备。
- SCRFD 后备结果增加 5 点几何合理性校验。

## 5. 指定图片的最后一次成功结果

使用 v12 Release 原生模块，直接通过 Node 调用，没有启动 Electron。

关键日志：

```text
[Beauty] YOLOX max_score=0.8646 people=1
[Beauty] person-crop parsing face_pixels=26104 box=(1449,248)-(1917,946) accepted=true
[Beauty] parsing face score=0.8646 skin_ratio=0.1272 features=12 accepted=true
[Beauty] analyze done faces=1 skin_pixels=840
```

结果：

```text
faces=1
mask=512 之前的版本为 128×128
analysisVersion=12
首次推理约 1.47 秒
```

注意：日志中的 `skin_pixels=840` 来自当时的 128×128 最终蒙版。v13 已把最终蒙版改为 512×512，但尚未完成 Release 回归。

## 6. 当前源码状态：v13 分割调试改动尚未完整验证

最新源码已将 `ANALYSIS_VERSION` / `BEAUTY_ANALYSIS_VERSION` 升到 13，并做了以下修改：

1. 最终语义蒙版从 128×128 提升到 512×512，避免放回 3840×2160 后边界每格跨约 30 个原图像素。
2. `beauty.wgsl` 的调试画面暂时只显示：
   - 粉色半透明填充：语义分割区域。
   - 青色高对比线：通过蒙版邻域差值生成的分割边界。
3. 调试模式不再叠加 106 点脸部轮廓、眼睛线和嘴部线。
4. `BeautyPanel` 的图例已改成只解释分割填充与边界。

重要：用户在构建过程中中断了上一轮命令。因此当前磁盘状态为：

- 源码是 v13。
- `luna-render-core/luna-render-core.node` 最后确认成功构建的是 v12；v13 Release 是否覆盖成功不能假定。
- v13 的 `cargo check`、`pnpm run build:app` 和 WGSL 运行时创建尚未获得完整成功输出。
- 下一位接手者必须先完成第 7 节的验证，不要直接告诉用户 v13 已可用。

## 7. 接手后的第一组命令

不要启动 Electron。先执行：

```bash
cargo check --manifest-path luna-render-core/Cargo.toml
pnpm run build:rust
pnpm run build:app
git diff --check
```

然后直接调用原生模块测试指定照片。可参考下面的 Node 调用方式：

```js
import { createRequire } from 'node:module'

const root = '/Users/REDACTED/projects/luna-ai-cut/worktrees/feat-beauty'
const require = createRequire(`${root}/package.json`)
const native = require(`${root}/luna-render-core/luna-render-core.node`)

const result = await native.analyzeBeautyAsync(
  require('ffmpeg-static'),
  require('ffprobe-static').path,
  '/Users/REDACTED/Pictures/LunaAI-Cut/localResources/IMG_20260620_182402_101.jpg',
  `${root}/luna-render-core/models`,
)

console.log({
  version: result.analysisVersion,
  faces: result.faces.length,
  maskWidth: result.skinMaskWidth,
  maskHeight: result.skinMaskHeight,
  maskLength: result.skinMask.length,
})
```

预期 v13：

```text
analysisVersion=13
faces=1
skinMaskWidth=512
skinMaskHeight=512
skinMask 非空
```

之后必须做一次原生 WGPU 调试渲染，以验证 `textureDimensions(beauty_skin_mask)` 的 WGSL 写法可以被当前 wgpu/naga 接受，并查看粉色区域与青色边界是否贴合脸、耳和颈部。

## 8. 分割范围的当前定义

BiSeNet/CelebAMask-HQ 的标签中，最终蒙版当前合并：

```text
1  = face skin
7  = left ear
8  = right ear
10 = nose
14 = neck
```

面部候选框只使用标签 `1`（face skin），避免颈部把面部框向下拉长。

皮肤验证使用以下面部特征标签计数：

```text
4, 5       = eyes
11, 12, 13 = lips / mouth
```

当前模型是面部分割模型，不是完整人体皮肤模型。因此最终范围主要是脸、耳、鼻和颈部，不应宣称能可靠覆盖手臂和手。如果用户要求身体皮肤，需要再接入专门的人体解析/人体皮肤模型。

## 9. 下一步只处理分割，不处理几何

建议顺序：

1. 完成 v13 编译和原生调试渲染。
2. 将 512×512 蒙版叠加到指定原图，单独检查：发际线、双耳、下巴、颈部、眼睛和嘴唇孔洞。
3. 如果边界锯齿，优先在 Rust 中对二值蒙版做轻量闭运算和 1～2 像素羽化，不要先扩大整张脸框。
4. 如果发际线/脸缘漏掉，检查 BiSeNet 标签，不要用 106 点轮廓去掩盖分割错误。
5. 如果眼睛和嘴被填入皮肤蒙版，应明确从语义蒙版中扣除对应特征标签。
6. 用户确认分割范围后，再回头校准 106 点输入框和几何变形。

## 10. 日志位置与关键日志

Electron IPC 和 Rust 都会记录分析日志。开发环境通常位于：

```text
luna-render-core/luna-rc.log
```

关键字段：

```text
lrc:analyzeBeauty start image=... models=...
lrc:analyzeBeauty done version=... faces=... mask=... elapsed=...ms
[Beauty] decode path=... source=... analysis=...
[Beauty] YOLOX max_score=... people=...
[Beauty] person-crop parsing face_pixels=... box=... accepted=...
[Beauty] parsing face ... skin_ratio=... features=... accepted=...
[Beauty] analyze done faces=... skin_pixels=...
```

如果界面仍显示旧结果，先看 `done version`。版本不是 13 说明 Electron 仍加载旧 `.node` 或旧前端；必须完全退出应用后重启，热更新无法替换已加载的原生模块。

## 11. 构建、打包与文件约束

- ONNX 模型已加入 `electron-builder.json5` 和 `electron-builder-debug.json5` 的 `extraResources`。
- `@mediapipe/tasks-vision` 已从依赖中移除。
- `public/mediapipe` 模型和 wasm 资源已删除。
- `src/workspace/beauty/faceLandmarker.ts` 和 `skinSegmenter.ts` 已删除。
- `beauty_analysis.rs` 已拆分，相关单文件保持在 500 行以内。
- 不要修改或删除用户提供的 `image.png`。
- 当前工作区包含大量未提交改动；提交前先检查 `git status`，不要覆盖无关用户改动。

## 12. 临时测试产物

本轮产生过以下临时文件，可用于对照或重新生成：

```text
/tmp/beauty-reference-original.png
/tmp/beauty-reference-target.png
/tmp/beauty-reference-native-onnx.png
/tmp/person-head-crop.jpg
/tmp/native-beauty-actual-v12.json
/tmp/luna-beauty-debug-v12.log
```

`/tmp/person-head-crop.jpg` 是指定 3840×2160 原图中由 YOLOX 人物框推导出的上半身近景，可用于单独观察分割输入。
