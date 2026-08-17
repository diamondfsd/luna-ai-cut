# WebGPU 渲染迁移计划

## 目标

将 Luna AI Cut 中由 Rust `wgpu` 承担的画面渲染能力逐步迁移到 Electron Renderer 中的 WebGPU：

- WebGPU 负责预览、图层合成、调色、LUT、遮罩、文字、特效、转场和图片/视频导出渲染。
- Rust 保留 AI worker、ONNX 推理、inpaint、语音及其他仍然需要原生能力的模块。
- FFmpeg 保留媒体探测、兼容格式转换、音频处理和元数据处理；画面像素处理统一交给 WebGPU。
- 预览和导出共用同一套 layer 输入、shader 参数和渲染结果规则。
- 迁移完成后，Rust/wgpu 不再承担任何画面渲染职责，原生预览 surface 和对应 IPC 一并删除。

WebGPU 不代表必然比 wgpu 更省资源。两者在不同平台可能仍使用相同的 Metal、D3D12 或 Vulkan 后端。本迁移的主要收益目标是减少 Rust 原生渲染、平台 surface、跨边界同步和 Windows/macOS GPU 互操作复杂度；每个里程碑都必须用实际数据确认卡顿、内存和兼容性是否改善。

## 当前起点

已存在的 WebGPU 样板：

- `src/pages/WebGpuColorGradeTestPage.tsx`
- `src/lib/webgpu-color-grade.ts`
- `src/lib/webgpu-color-export.ts`

样板已经覆盖单图片/单视频输入、`copyExternalImageToTexture`、基础调色 shader、PNG 输出和 WebCodecs/Mediabunny 视频编码，但尚未覆盖 Luna 的多图层输入、项目资源路径、LUT、遮罩、文字、时间线、导出队列和 Electron 文件保存协议。

仓库中的 `packages/freecut-editor/src/infrastructure/gpu-*` 已包含 WebGPU compositor、media、effects、masks、shapes、text、transitions 和 texture pool。进入对应阶段时优先通过适配层复用这些实现，不复制出第二套相同的 GPU 基础设施。

## 阶段与验收

### M0：基线和能力矩阵

状态：基线采集入口已完成，待多设备矩阵采集

记录当前 Rust/wgpu 与 WebGPU 的可比较指标：首次画面、seek 到首帧、播放掉帧、4K 预览、图片导出、视频导出、CPU、GPU、内存和设备丢失恢复。

覆盖 macOS Apple Silicon、macOS Intel、Windows Intel/NVIDIA/AMD 实际设备，并探测：

- `navigator.gpu`、Adapter、Device 创建
- 最大纹理尺寸、3D texture、可用纹理格式
- `VideoFrame`、WebCodecs 编解码器
- Worker、OffscreenCanvas、Worker WebGPU
- Device lost、uncaptured error、shader 编译错误

验收：形成设备矩阵和指标快照，明确完整编辑、基础预览和不支持三种状态。

### M1：WebGPU 基础运行时

状态：代码已完成，待 Electron 实机验收

新增可复用的 WebGPU runtime，统一管理：

- 一个 Renderer 共用的 `GPUDevice`
- Adapter 和设备能力
- preferred canvas format
- Device lost
- uncaptured error
- 设备销毁和重复初始化
- WebGPU 常量和资源生命周期

验收：调色测试页已经改用统一 runtime；主项目 TypeScript 和变更范围 lint 已通过，完整 Electron 构建仍需先修复工作区已有的 FreeCut 缺失模块。

### M2：静态图片预览和图片导出

状态：第一步代码已完成，待工作台 Electron 实机验收

实现 `WebGpuCompositionRenderer` 的最小版本，先支持单图片、透明度、缩放、裁切、旋转、翻转、基础调色和 PNG/JPEG 导出。

输入继续使用现有 `PreviewLayer`/`CompositionInput` 适配后的结构，不创建只服务测试页的新协议。

当前实现：`WebGpuCompositionRenderer` 已支持纯静态 media 图层、图层排序、sourceRect、cover/contain/stretch、opacity、基础 blend、旋转/翻转和基础调色；`PreviewStage` 通过实验性 GPU 预览开关接入，复杂图层自动保留旧路径。

图片导出已经接入现有导出任务和分块写入协议。第一步只打开能够完整保留参数的静态媒体层；LUT、蒙版、裁剪、平移、曲线、高级调色、水印定位等能力列入后续 WebGPU 阶段，不以旧渲染器作为 WebGPU 失败回退。Live Photo 合并使用写入器返回的实际图片路径。

验收：待在完整 Electron 构建可用后验证工作台静态图片预览和图片导出；完成所有图层能力后删除 Rust/wgpu 画面渲染入口。

### M3：单视频 WebGPU 预览

状态：基础单视频路径代码已完成，待 Electron 实机验收

新增 `WebGpuVideoPreview`，使用 HTML video 上传到 WebGPU canvas，支持单视频播放、暂停、seek、视频切换、首帧和设备错误上报。当前仅打开单媒体层和基础调色，复杂图层仍待后续 WebGPU 阶段接入。

验收：单视频基础调色和变换在工作台稳定播放，使用 Playwright Electron 用例验证关键行为；不以旧渲染器作为 WebGPU 运行失败时的切换路径。

### M4：多图层合成

状态：基础代码已完成，待 Electron 实机验收

已完成第一步：图片图层、视频图层、图层排序、fit/cover/contain、opacity、基础 blend mode、图层时间区间、多视频源元素、合成时间同步和图片/视频纹理缓存已接入统一 WebGPU composition renderer。视频源使用稳定 key，避免同一路径不同时间点复用错误纹理；主视频继续提供工作台播放控制，其余视频按主视频合成时间同步。

仍待迁移：蒙版、文字/形状、完整调色和创意效果；这些能力存在时当前能力矩阵不会选择第一版 WebGPU 合成器。

验收：`PreviewStage` 只负责生成 layer 描述，WebGPU renderer 负责合成，预览与静态帧渲染使用同一输入。

### M5：调色、LUT 和遮罩

状态：完整调色链路、LUT 和蒙版代码已完成，待 Electron 工作台实机验收

迁移基础调色、曲线、色轮、`.cube` 3D LUT、LUT 强度、mask texture、反转、羽化、mask transform、local color 和 mask timeline。

当前实现：WebGPU Composition renderer 已接入 3D LUT texture、identity LUT、`.cube` 重采样、技术还原 LUT、创意 LUT 和 LUT 强度；静态图片预览、视频预览和图片导出共用同一套 LUT shader。主进程通过受限 IPC 读取当前 LUT 目录或应用内置 LUT 目录中的 `.cube` 文件，Renderer 不获得任意文件读取能力。

当前实现：WebGPU Composition renderer 已接入基础色调、细节/光晕、levels、曲线 LUT、三向色轮、8 个标准 HSL 通道和最多 4 个自定义 HSL 通道；曲线 LUT 按参数缓存，并由预览和后续导出共用。完整调色参数存在时，能力矩阵不再因为调色参数切回旧路径。

当前实现：蒙版 PGM 通过受限工作区接口加载，WebGPU 生成正向/反向距离通道并缓存纹理，支持反转、透明度、羽化、蒙版追踪和时间线采样。局部调色的 `precomposeGroup` 输入层先在 WebGPU 临时纹理中顺序合成，再参与主画布合成；静态预览、视频预览和图片导出共用这套路径。

验收：使用参考图做允许误差的像素对比，验证预览、图片导出和视频导出的结果一致。

### M6：文字、形状、水印和装饰

状态：基础形状与文字代码已完成，待真实工作台验收

当前实现：形状、圆角矩形、圆形、直线、填充和描边会先栅格化为透明纹理，再进入统一 WebGPU 合成；文字支持多行、对齐、垂直对齐、字体粗细、系统字体和可加载字体资源。logo/装饰图层支持图片源或文字回退。调色、透明度、混合、蒙版和预合成仍复用同一套 GPU 图层管线。

仍待迁移：字体资源的完整跨平台路径验证、文字阴影、文字动画、装饰图层专用图形以及工作台所有文字/水印入口的逐项验收。

验收：工作台及导出覆盖现有文字、水印和装饰图层。

### M7：创意效果和转场

状态：待开始

先迁移 blur、sharpen、vignette、grayscale、invert、sepia、RGB split、pixelate，再迁移 pixel stretch、pixel flow、glow、distortion、color reveal、only your color 和转场。

每类效果独立 pipeline，使用纹理池复用中间结果，不将所有效果堆进单个 fragment shader。

验收：每个效果有纯参数测试或参考帧测试，复杂效果有取消、过期帧和设备丢失处理。

### M8：WebGPU 图片导出

状态：待开始

使用 offscreen render target 渲染，再通过 `copyTextureToBuffer` 或 `convertToBlob` 输出。主进程继续负责路径、文件写入和元数据，不再调用 Rust/wgpu 生成像素。

验收：格式、质量、输出分辨率、透明背景、水印、元数据和导出取消均可用。

### M9：WebGPU 视频导出

状态：待开始

使用 Worker + OffscreenCanvas + WebGPU + WebCodecs/Mediabunny：

```text
Mediabunny/WebCodecs decode -> VideoFrame -> WebGPU render -> WebCodecs encode -> container
```

支持多图层、时间线帧求值、VFR、音频复制/编码、长视频、4K、导出取消、编码器不可用和内存控制。不得在 React 主线程逐帧执行长时间导出。

验收：导出任务状态、进度、取消、音画同步和输出文件均通过 Electron 行为测试及长视频压测。

### M10：替换原生预览和 IPC

状态：待开始

WebGPU 工作台预览稳定后，移除 `NativeGpuVideoPreview`、native preview session、macOS/Windows 原生 preview surface、位置同步和对应 Electron IPC。

验收：预览只依赖 HTML canvas 和 WebGPU，不再创建 Rust 原生画面 surface。

### M11：删除 Rust/wgpu

状态：待开始

确认所有画面渲染路径完成切换后，删除：

- `luna-render-core` 的 `wgpu` 依赖和 lockfile 依赖
- compositor 及其 GPU texture、LUT、mask、preview、render 模块
- macOS/Windows GPU 合成和原生预览模块
- Electron render IPC、preload render API 和仅服务渲染的 native 打包逻辑

保留仍被 AI、ONNX、inpaint 或其他原生功能使用的 Rust 模块。

验收：代码、构建脚本、测试和文档扫描不再存在可执行的 Rust/wgpu 画面渲染路径。

## 每阶段通用质量门

- `pnpm run build:app`
- 与变更直接相关的类型检查、纯逻辑测试和 Electron Playwright 测试
- 预览/导出参考帧对比
- WebGPU 设备丢失和错误日志断言
- CPU、GPU、内存、首帧和导出速度记录
- 不用自然语言猜测来决定渲染流程；能力选择只基于明确的设备能力和结构化配置

日常不穿插主观视觉测试；视觉截图、鼠标手感和多平台完整回归集中在里程碑或 RC 验收。

## 当前执行队列

- [x] 写入迁移总计划
- [x] 新增 WebGPU runtime 基础层
- [x] 调色测试页接入 runtime
- [x] 建立 M0 设备和性能基线采集入口（待多设备矩阵采集）
- [x] M2：图片 Composition renderer 和静态图片导出第一步代码（待 Electron 验收）
- [x] M3：单视频工作台预览基础路径（待 Electron 验收和复杂能力扩展）
- [x] M4：多图层合成基础路径（待 Electron 验收和复杂能力扩展）
- [x] M5：3D LUT 基础链路（待 Electron 实机验收）
- [x] M5：完整调色参数链路（曲线、色轮、levels、HSL、细节和光晕）代码
- [x] M5：蒙版纹理、羽化、变换和时间线代码（待 Electron 实机验收）
- [x] M6：基础形状与文字纹理栅格化（待真实工作台验收）
- [ ] M7：创意效果和转场
- [ ] 开始 M8-M9：图片和视频导出
- [ ] 开始 M10-M11：删除原生预览和 Rust/wgpu

## 当前验证记录

已通过：

- `pnpm exec tsc --noEmit`
- `pnpm run test:webgpu-color-grade`
- `pnpm run test:webgpu-mask`
- `pnpm run build:app`
- Electron 中直接实例化 WebGPU Composition renderer，普通蒙版和局部调色预合成均成功提交并生成 PNG；蒙版区域像素和非蒙版区域像素符合预期，未产生 uncaptured error
- Electron Playwright 验证页成功提交形状、圆角、圆形、描边和文字图层，画布生成非空 PNG，且无 renderer pageerror/error console
- Electron Playwright 验证页成功生成 WebGPU 能力与帧耗时 JSON 基线，包含适配器信息、限制、首帧、平均值、P95 和错误记录
- `git diff --check`

当前待验证：

- 在隔离的 Electron 用户数据目录中，用真实工作台项目验证完整调色预览、图片导出和视频预览的画面一致性。
- 在 macOS Apple Silicon、macOS Intel、Windows Intel/NVIDIA/AMD 上分别运行 M0 诊断页，收集设备矩阵和性能快照；当前 `pnpm dev` 已能启动迁移工作区的 Electron 窗口，5173 被占用时会自动使用下一个端口。
- 在隔离的真实工作台项目中验收调色、蒙版、相框文字/形状、图片导出和视频预览；M10 前不删除原生预览或 Rust/wgpu。
