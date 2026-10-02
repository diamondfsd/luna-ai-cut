# OpenReel 上游同步与本地能力边界

2026-10-02：将上游 `main` 的 `2dac9a6bbfcf5c4d9883a839f981732ea6519d92` 合入 Luna vendored 副本。三方比较基线为 `5f3c85e5fc223c86060bf4b12e1b4dec58e9b8a9`，当前副本包含此前 fork 和 Luna 主仓库的本地修改。版本记录见 [UPSTREAM.json](../vendor/openreel/UPSTREAM.json)。

## 合并范围

同步 `apps/web`、`packages`、README 和锁文件，并补齐工作区已声明的两份上游 FFmpeg 补丁。未引入上游新增的 `apps/cloud`、基础设施或独立 Electron 宿主。保留 Luna 项目域、文件桥、原生导出、素材恢复和 Agent 工具服务。

处理了 App、Toolbar、AnimateTab、Workspace、DesktopStartScreen、Agent registry 和 action-validator 七处冲突。保留 Luna 项目初始化和返回项目列表操作，吸收上游时间线工具 schema、转场枚举、关键帧/音频校验、工具路由和撤销修复。独立 Motion Creator 工作区按上游 `MOTION_CREATOR_ENABLED = false` 关闭；主时间线关键帧、动画预设和转场保留。

## 已移除的浏览器模型清单

| 模型资源 | 原实现 | 原运行时 | 处理结果 |
| --- | --- | --- | --- |
| Silero VAD v6.2.1 / `silero_vad.onnx` | `packages/core/src/multicam/silero-vad.ts` | `onnxruntime-web` / WASM | 删除推理实现与依赖；多机位使用已有音量分析，不再执行语音概率推理或依赖该结果的串音校准 |
| MediaPipe Face Landmarker float16 v1 / `face_landmarker.task` | `apps/web/src/services/multicam-face-reactions.ts` | MediaPipe Tasks Vision / WASM + GPU | 删除实现及表情分析选项 |
| MediaPipe Selfie Multiclass 256×256 float32 / `selfie_multiclass_256x256.tflite` | `packages/core/src/ai/person-segmentation-worker.ts` | MediaPipe Tasks Vision / WASM | 删除 worker、模型地址和加载路径 |
| MediaPipe Selfie Segmenter float16 / `selfie_segmenter.tflite` | 同上，分割回退模型 | MediaPipe Tasks Vision / WASM | 同上；移除人像背景处理与主体后文字入口 |

`@mediapipe/tasks-vision` 和 `onnxruntime-web` 已从 web/core 包及锁文件移除。保留不执行推理的 person-segmentation 兼容边界，返回空遮罩，不创建 Worker、不请求模型。旧项目的主体后文字标记保持原样，预览和导出均显示普通文字，不再因等待遮罩而隐藏文字。未改写用户既有项目，也未删除磁盘上的用户模型或数据。

非模型 WASM 保留：FFmpeg 媒体处理、FFT、节拍检测、WAV 编码以及 creation geometry。自动重构图当前为像素启发式逻辑，不加载 AI 权重；绿幕抠像是颜色处理。Luna 自己的本地字幕、精彩片段、模型管理和原生推理服务未移除。

## 已移除的 OpenReel 云能力

- KieAI 文件上传、图像生成、结果下载、后台轮询、任务 store 和生成弹窗。
- 云端模板查询、读取、上传和删除；模板浏览与保存改为本地/内置模板。
- 在线分享页面、分享上传/下载和健康检查；旧 `#/share` 路由回到编辑器。
- PostHog 运行时与依赖；兼容 analytics hook 不采集或发送事件。
- Cloudflare API relay、Wrangler 依赖、配置及部署命令。
- 从 `mediashares.openreel.video` 下载的 vidstab 防抖运行时及其界面入口。保留只读空结果兼容边界和 core 中不依赖该下载的防抖算法。

现有用户自配的模型接口和 ElevenLabs 等服务访问仍由原有服务契约提供，但不再经过 OpenReel Cloudflare relay。这些不属于 OpenReel 云存储或托管服务；本次没有移除 Luna 自己的 AI 配置和全应用助手。

## 已移除的编辑器聊天页面

移除 `apps/web/src/components/editor/chat/`，包括 ChatPanel、消息、输入框、工具卡片、确认卡片、聊天历史、模型选择及其页面测试。EditorInterface 和桌面 EditPage 只显示素材详情；删除聊天标签、侧栏聊天按钮、桌面标题栏聊天按钮和助手模型配置页面。App 不再订阅激活事件来打开内嵌聊天。

仅移除页面：保留 `chat-store`、历史 store、工具注册/执行、LLM transport、MCP listener、宿主接口和旧 `agentChat` 持久化字段供新方案迁移。不会因为用户已有 `agentChat.visible = true` 而恢复旧页面。Luna 顶部的全应用 AI 助手保持不变。

`scripts/test-openreel-bridge.mjs` 是旧桥兼容测试，不作为新 AI 剪辑方案或已移除聊天页面的验收依据；本次没有改动其底层桥契约。删除只服务于旧聊天页面的测试，保留仍覆盖现行持久化、动作和服务契约的非界面用例。

## 模块边界审查

多机位原 1,296 行面板按职责拆为界面、组卡片、状态控制 hook 和自动剪辑 hook，避免把模型替代逻辑继续塞入页面。控制 hook 约 550 行，承担同一个相机组生命周期；进一步拆分会增加共享状态和回调的耦合，本次不扩大其职责。

上游 registry、动作验证器、视频引擎和 Preview 是已有大型 vendored 模块。评审保留上游结构：registry 同步上游工具定义，不新增 Luna 业务分支；视频引擎与 Preview 只增加模型可用性判断，两侧必须一致。将这些跨上游模块全面拆分会显著扩大这次合并及渲染回归范围，并增加后续同步冲突，应在独立重构中处理。Luna 新领域能力仍按应用架构注册领域工具，不继续向这些文件堆业务。

## 验证范围

独立 TypeScript 检查与变更范围 Lint；相关动作、工具、模型禁用、会话、项目恢复及 API 服务的非界面 Vitest 回归。不启动应用、不执行 UI 测试、全量 E2E、构建或打包。
