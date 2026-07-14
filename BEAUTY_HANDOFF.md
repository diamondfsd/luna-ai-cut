# 美颜功能开发交接文档

更新时间：2026-07-14  
工作区：`/Users/REDACTED/projects/luna-ai-cut/worktrees/feat-beauty`  
分支：`feat-beauty`  
当前 HEAD：`a83427e feat: fixed test`

## 1. 当前状态

工作区在编写本文档前是干净的。美颜主体功能已经提交，最新几次相关提交如下：

| 提交 | 实际内容 |
| --- | --- |
| `ca5d8ad` | 完整美颜能力、全身皮肤蒙版、478 点网格、Metal 参数与六类 UI 面板 |
| `b03b551` | 原生 beauty 模块拆分、美颜分类改为紧凑 `ButtonGroup` |
| `362a86c` | 眼嘴从椭圆改为关键点多边形，并增加边缘羽化 |
| `a83427e` | 最高精度眼嘴点位、零参数短路、主体 ROI 检测流程、分析版本升级到 v5 |

已经集成的能力包括：

- 肤质：磨皮、美白、美肤、冷暖、红润、质感、法令纹。
- 脸型：瘦脸、削脸、小脸、下巴、额头。
- 眼部：大眼、眼距、眼角、卧蚕、眼袋、亮眼。
- 鼻部：瘦鼻、鼻翼、鼻长。
- 嘴部：嘴型、美牙。
- 美妆：口红、腮红。
- 全身语义皮肤蒙版：脸、耳、颈、手臂和手可以统一美白；磨皮仍限制在脸部。

## 2. 当前识别流程

入口是 `src/workspace/beauty/beautyAnalysis.ts`，当前 `BEAUTY_ANALYSIS_VERSION = 5`。

分析流程为：

1. `skinSegmenter.ts` 在最长边 512px 的图上运行 `selfie_multiclass_256x256`。
2. 合并 `body-skin + face-skin`，生成 128×128 皮肤蒙版。
3. 使用 `1 - background` 做连通域，提取最多 6 个人物候选区域。
4. `faceLandmarker.ts` 优先裁剪人物上半身，运行 MediaPipe Face Landmarker。
5. 上半身识别失败后尝试完整人物区域，仍失败时回退全图。
6. 将裁剪区域内的 478 点坐标映射回原图并缓存。

相关关键参数：

- 主体分割输入最长边：512。
- 人脸 ROI 输入最长边：2560。
- 最多人脸：3。
- 人物连通域阈值：前景置信度 0.38。
- 人物候选数量：6。
- 眼睑：每只眼 16 点。
- 嘴唇：外唇 20 点 + 内唇 20 点。
- Metal 每张脸打包 80 个关键点，三张脸共 `120 × vec4<f32>`。

## 3. 缓存行为和已知缺陷

识别结果保存在 `pipeline.beauty` 中。满足以下条件时不会重新分析：

```ts
beauty.analyzed && beauty.analysisVersion >= BEAUTY_ANALYSIS_VERSION
```

因此需要特别注意：

- v4 及更早的结果会在当前代码中自动升级到 v5。
- 如果某张图已经用 v5 分析过，即使 `faces` 为空，也会缓存空结果。
- 后续修改 v5 算法后，旧的 v5 空结果不会自动失效。调试时应将版本升到 v6，或手动把 `analysisVersion/analyzed` 重置。
- `BeautyPanel` 目前只要存在 `skinMask` 就显示“已识别皮肤区域”。即使 `faces.length === 0`，也不会显示“重新识别”按钮。这会让“只有皮肤、没有面部结构”的情况难以手动恢复，建议补一个始终可用的重新识别操作或拆分皮肤/人脸状态。

## 4. 当前阻塞问题

指定测试图：

`/Users/REDACTED/Pictures/LunaAI-Cut/localResources/IMG_20260620_190544_123.jpg`

图片信息：3840×2160，人物位于画面右侧，脸部在全图中占比较小。用户在软件中的实际结果是：

- 能识别皮肤区域。
- 没有识别出面部结构。

这张图是当前最重要的回归用例。主体 ROI 代码已在 `a83427e` 中实现并通过 TypeScript 构建，但本轮在交接前没有完成 MediaPipe 运行时实测，不能认定问题已经解决。

优先排查项：

1. 确认该图当前保存的是不是 v5 空人脸缓存。先强制重新分析。
2. 在 `detectBodySkinMask` 临时记录 `personRegions`，确认右侧主体是否进入前 6 个连通域。
3. 将人物框和上半身 ROI 输出成调试图，确认裁剪没有截掉头部。
4. 分别记录 `headFaces`、完整人物区域和全图回退的检测数量。
5. 如果主体框未找到，检查 `1 - background >= 0.38` 是否被建筑背景误触发；可能需要按人体类别置信度求和，而不是简单使用背景补集。
6. 如果主体框正确但仍无脸，尝试从人物框顶部生成多个尺度的头部候选，例如 35%、50%、70% 高度，而不是只用固定 62%。
7. 如果 Face Landmarker 自带检测器仍无法识别小脸，增加专用轻量人脸检测器或 BlazeFace，在检测框上再运行 478 点模型。

## 5. 眼嘴边缘问题

之前的问题是眼睛和嘴巴使用椭圆，100 强度下会出现明显安全区和多边形色块。目前实现为：

- 美白/磨皮保护区使用向外渐隐的精细轮廓。
- 亮眼、口红和美牙使用只向轮廓内部羽化的蒙版。
- 口红增加了原始像素唇色置信度，减少皮肤误染。
- 未开启的局部效果会跳过对应多边形和双边滤波计算。

五项同时为 100 的测试组合是：磨皮、美白、美肤、红润、质感。

测试输出：

- `/Users/REDACTED/Pictures/LunaAI-Cut/export/IMG_20260712_112756_284_1784017545547_beauty-five-100-no-lipstick.jpg`
- `/Users/REDACTED/Pictures/LunaAI-Cut/export/IMG_20260712_112756_284_1784017545547_beauty-five-100-lipstick-23.jpg`

这两张 1620×2160 图片使用 Apple Metal 实际导出，总耗时约 0.77 秒。它们没有复现软件截图中的嘴角暗块，因此后续应优先核对软件当前缓存的网格和完整参数，不要只继续扩大羽化。

## 6. 已完成验证

最近一次确认通过：

- `pnpm run build:app`：通过，约 4.9 秒。
- `pnpm run build:rust`：通过，Release 约 28 秒。
- `cargo check`：通过。
- `pnpm exec tsc --noEmit`：通过。
- `git diff --check`：通过。
- Apple M5 / Metal：高精度关键点缓冲区创建成功，五项 100 实际导出成功。

未通过但与本轮无关的历史问题：

- `pnpm run test:workspace` 引用了不存在的 `src/workspace/renderer/shaders/pipeline.glsl`，会报 `ENOENT`。

## 7. 测试工具和临时文件

本轮用于原生导出的临时脚本和数据：

- `/tmp/luna-render-beauty-test.mjs`
- `/tmp/luna-face-mesh.json`
- `/tmp/luna-body-skin-mask.json`
- `/tmp/luna-render-core-test.node`

直接加载仓库内 `luna-render-core.node` 曾出现退出码 137，原因是运行中的 Electron 已占用同一路径，而 Release 构建又覆盖了文件。测试时将 `target/release/libluna_render_core.dylib` 复制为独立 `/tmp/*.node` 后可正常运行。不要因此误判为 WGSL 或 Metal 崩溃。

## 8. 建议接手顺序

1. 先处理 v5 空结果缓存和手动重新识别入口。
2. 对 `IMG_20260620_190544_123.jpg` 输出人物框、头部 ROI 和检测数量。
3. 修正 ROI 候选生成，直到该图能稳定返回 478 点面部网格。
4. 用人物占比大、中、小三组照片验证，包含多人和人物相互遮挡。
5. 再检查五项 100、口红 100 和调试轮廓，确认 ROI 坐标回映没有偏移。
6. 完成后升级分析版本，确保用户已有空缓存自动失效。
