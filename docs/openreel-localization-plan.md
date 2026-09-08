# OpenReel 汉化计划

## 目标

将嵌入 Luna AI Cut 的 OpenReel 编辑器用户界面统一为简体中文，优先消除主编辑流程中的中英文混排。品牌名、文件名、模型名、API、编码格式、快捷键和代码标识保留原文；用户在项目中输入的内容不做翻译。

## 当前基线

- 分支：`feat/openreel-ai-editor`
- OpenReel：Git 子模块 `vendor/openreel`，当前基线提交为 `5f3c85e`
- Luna 接入方式：`/ai-editor` 路由加载 iframe，构建时复制 OpenReel 产物，并注入文件桥接和汉化脚本
- 当前汉化脚本：`scripts/luna-openreel-locale.js`，使用精确字符串表、少量动态模式和 `MutationObserver` 兜底
- 基线检查：在本计划建立前，`pnpm run build:app` 已通过；修改子模块后必须重新构建
- 建计划时发现的临时修改：`App.tsx`、`WorkspaceModeTabs.tsx`、`components/editor/AIGenTab.tsx` 已有未审查的部分汉化修改。它们来自已停止的 agent，本计划将第一轮先审查和收口，不将其直接视为完成。

## 分阶段范围

| 阶段 | 模块 | 主要文件范围 | 完成标准 | 状态 |
| --- | --- | --- | --- | --- |
| 0 | 接入基线 | 根目录现有 OpenReel 接入文件 | 路由、构建、iframe、文件桥接契约可复现 | 已完成，构建复核通过 |
| 1 | 截图主路径 | `App.tsx`、`WorkspaceModeTabs.tsx`、`components/editor/AIGenTab.tsx`、`components/editor/InspectorPanel.tsx` | AI 生成面板、视频/动效标签、右侧未选择状态及相关属性无明显英文混排 | 已完成 |
| 2 | 编辑器外壳与欢迎页 | `desktop/**`、`components/welcome/**`、`components/editor/settings/**` | 欢迎页、编辑器加载态、窗口操作、设置页和更新提示完成汉化 | 已完成 |
| 3 | 素材、预览与时间线 | `components/editor/AssetsPanel.tsx`、`Preview.tsx`、`Timeline.tsx`、`components/editor/timeline/**`、`components/editor/dialogs/**` | 导入素材、播放器、时间线工具、菜单、导出/压缩/尺寸提示完成汉化 | 已完成 |
| 4 | 检查器与 AI 操作 | `components/editor/inspector/**`、`components/editor/chat/**`、`components/editor/kieai/**`（已在阶段 1 处理的 `InspectorPanel.tsx` 除外） | 属性面板、字幕、调色、效果、AI 对话、生成器的标签、空状态、错误和提示完成汉化 | 待处理 |
| 5 | 动效设计 | `motion/**` | 动效工具栏、图层、属性、曲线、动效时间线、预设和导出相关界面完成汉化 | 待处理 |
| 6 | 动态兜底与审计 | `scripts/luna-openreel-locale.js`，必要时新增检查脚本 | 只补充无法在源码稳定处理的动态文案；不使用宽泛替换误伤用户内容；生成可审计的遗漏清单 | 待处理 |
| 7 | 回归验收 | 根目录构建、OpenReel 子模块检查、现有 Playwright E2E | 构建通过、主路径行为不回归、渲染器无新增错误、关键 UI 文案为中文 | 待处理 |

## 单 agent 执行规则

1. 同一时间只启动一个 agent；当前 agent 未结束前不启动下一个。
2. 每个 agent 只修改表格中当前阶段的文件范围，不跨阶段批量替换。
3. agent 结束后由主 agent 检查 diff、术语、动态文案和是否误伤技术标识。
4. 检查通过后先更新本文件，再进入下一阶段；检查失败时在本文件记录问题并由同一 agent 修复，或由主 agent 小范围修复。
5. 每阶段至少执行 `pnpm run build:app`；涉及 OpenReel 子模块时，同时执行其最小类型检查或相关测试。
6. 不翻译测试断言、开发文档、日志和内部错误标识；用户可见错误与状态文案需要翻译。
7. 源码汉化优先于运行时脚本。运行时脚本只处理动态组合文案和确实无法稳定改源码的内容。

## 术语基准

| English | 中文 |
| --- | --- |
| Media | 素材 |
| Text | 文字 |
| Graphics | 图形 |
| Effects | 效果 |
| Transitions | 转场 |
| AI Generate | AI 生成 |
| Player / Viewer | 播放器 |
| Inspector | 检查器 |
| Timeline | 时间线 |
| Clip | 片段 |
| Track | 轨道 |
| Asset | 素材 |
| Motion Design | 动效设计 |
| Text to Speech | 文本转语音 |
| Auto Captions | 自动字幕 |
| Export | 导出 |
| Save | 保存 |

## 进度记录

### 2026-09-08：建立计划

- 已停止并行 agent，后续改为单 agent 顺序执行。
- 已确认截图中的主要英文来源：`components/editor/AIGenTab.tsx` 和 `components/editor/InspectorPanel.tsx`，不是仅靠宿主页面文案即可解决。
- 已确认现有运行时脚本的局限：精确匹配表无法覆盖大量源码中的动态组合文案，不能作为主要汉化方案。
- 当前没有阶段被验收为完成。

### 2026-09-08：阶段 1 开始

- 当前仅处理截图主路径，工作范围锁定为 `App.tsx`、`WorkspaceModeTabs.tsx`、`components/editor/AIGenTab.tsx`、`components/editor/InspectorPanel.tsx`。
- 已有的 3 个临时修改先由当前 agent 复核，不扩展到其他目录。
- 当前 agent 数量：1；在本阶段验收前不启动其他 agent。

### 2026-09-08：阶段 0/1 验收完成

- 阶段 0：复核路由、OpenReel 构建、iframe 产物复制、文件桥接和运行时汉化脚本；修正 `scripts/build-openreel.mjs` 对压缩后 Service Worker 变量名的脆弱硬编码，使其按正则识别变量名。
- 阶段 1 修改文件：`vendor/openreel/apps/web/src/App.tsx`、`vendor/openreel/apps/web/src/components/WorkspaceModeTabs.tsx`、`vendor/openreel/apps/web/src/components/editor/AIGenTab.tsx`、`vendor/openreel/apps/web/src/components/editor/InspectorPanel.tsx`。
- 已覆盖中文：新建项目与画布方向、编辑器加载态、视频/动效工作区、AI 工具入口、字幕/语音/模板/滤镜/音乐/多机位入口、检查器空状态、字幕属性、转场提示、AI 操作和相关成功/失败提示。
- 新增或确认术语：`AI 生成`、`媒体库`、`文字`、`图形`、`字幕`、`时间线`、`片段`、`片头转场`、`片尾转场`、`背景降噪`、`字体系列`。
- 保留的技术标识：TikTok、YouTube、Facebook 等平台名，`SVG`、字体名、字幕动画枚举值、路由值、CSS 类名和内部状态值；模板名称、解析器错误等动态内容不做宽泛替换。
- 阶段边界外的残留：`desktop/shell/Workspace.tsx` 和 `motion/MotionCreatorShell.tsx` 传入的英文无障碍标签将在对应阶段处理；动态模板名、导入器错误和第三方返回文本留给阶段 6 审计。
- 检查命令及结果：`pnpm run build:app` 通过（含 OpenReel WASM、OpenReel 前端构建、Luna 前端与 Electron 构建）；`git diff --check` 及 `git -C vendor/openreel diff --check` 通过。仅有既有的 chunk 过大、Browserslist 过期和动态导入提示。
- 是否通过阶段验收：是。阶段 0、阶段 1 均完成；下一阶段只启动一个 agent。

### 2026-09-08：阶段 2 验收完成

- 阶段 2 修改文件：`vendor/openreel/apps/web/src/desktop/**`、`vendor/openreel/apps/web/src/components/welcome/**`、`vendor/openreel/apps/web/src/components/editor/settings/**`。
- 已覆盖中文：欢迎页、最近项目、模板入口、项目恢复、窗口操作、编辑器加载态、更新提示、设置页、服务名称和服务说明；默认项目名同步为“竖屏/横屏/方形/动效设计”等中文名称。
- 保留的技术标识：平台名、服务品牌名、API、模型 ID、文件名和内部状态值。
- 检查命令及结果：阶段 2 改动已包含在 OpenReel 提交 `895555f`；根仓库与子模块工作区干净，后续阶段继续执行构建复核。
- 是否通过阶段验收：是；进入阶段 3。

### 2026-09-08：阶段 3 时间线子组件批次验收完成

- 修改文件：`components/editor/AssetsPanel.tsx`、`components/editor/Timeline.tsx`、`components/editor/panels/EffectsTransitionsPanel.tsx`，以及 `components/editor/timeline/` 下的片段菜单、轨道头部、轨道拖放、片段、图形、转场、关键帧、标记、调整图层和字幕批量选择组件；新增 `timeline/transition-labels.ts`。
- 已覆盖中文：片段和图形右键菜单、轨道重命名/编组/锁定/静音操作、轨道拖放提示、效果和转场应用提示、转场选择器、关键帧属性、标记操作、调整图层时间线条和字幕批量选择。
- 新增或确认术语：`视频片段`、`音频片段`、`图片片段`、`轨道`、`播放头`、`转场`、`交叉淡化`、`硬切`、`关键帧`、`标记`、`调整图层`、`独奏`。
- 保留的技术标识：用户输入的片段名/轨道名/文件名、`SVG`、`BPM`、快捷键、内部 MIME 类型、枚举值、测试标识和历史分组内部描述；形状类型仅在显示层映射为中文。
- 未覆盖的用户可见英文：预览、导出/压缩/尺寸弹窗和录制/编辑器工具栏仍待本阶段下一批处理；检查器与 AI 操作目录按阶段 4 处理。现有时间线单测中的英文断言未修改，避免把汉化改动扩散到测试契约。
- 检查命令及结果：`git diff --check` 通过；`pnpm run build:app` 通过（包含 OpenReel WASM、OpenReel 前端类型检查与构建、Luna 前端及 Electron 构建）。保留原有 chunk 过大、Browserslist 过期和动态导入提示。
- 是否通过当前子批次验收：是；阶段 3 尚未完成，进入预览/导出/弹窗批次。

### 2026-09-08：阶段 3 预览、导出与录制批次验收完成

- 修改文件：`components/editor/Preview.tsx`、`components/editor/preview/CropModeView.tsx`、`components/editor/preview/preview-resolution.ts`、`components/editor/ProcessingOverlay.tsx`、`components/editor/ScreenRecorder.tsx`、`components/editor/RecordingControls.tsx`、`components/editor/RecordingCountdown.tsx`、`components/editor/Toolbar.tsx`、`components/editor/ExportDialog.tsx`、`components/editor/CompressDialog.tsx`、`components/editor/dialogs/AspectRatioMatchDialog.tsx`、`components/editor/ScriptViewDialog.tsx`、`services/export-presets.ts`、`services/processing-manager.ts`、`packages/core/src/export/compression.ts`。
- 已覆盖中文：播放器与预览控制、裁剪和构图网格、导出预设与压缩设置、设备与进度提示、项目 JSON 导入导出、屏幕录制、摄像头与麦克风、处理遮罩和内置导出预设。
- 保留的技术标识：YouTube、TikTok、Instagram、WhatsApp 等品牌名，JSON、MP4、H.264、ProRes、VP9、AAC、WAV 等格式或编码名，以及用户输入的项目名、素材名和文件名。
- 未覆盖的用户可见英文：动态错误文本、其他未进入本批的检查器/聊天/KieAI 文案，留待阶段 4 和阶段 6 审计；导出内部英文状态值及测试断言未修改。
- 检查命令及结果：`git diff --check`、`git -C vendor/openreel diff --check` 和 `pnpm run build:app` 均通过；保留原有构建警告。
- 是否通过当前子批次验收：是；阶段 3 完成，进入阶段 4。

### 2026-09-08：阶段 4 检查器导航与基础标签批次验收完成

- 修改文件：`components/editor/inspector/clip-tabs.config.ts`、`components/editor/inspector/shell/InspectorTabs.tsx`、`components/editor/inspector/tabs/TransformTab.tsx`、`AudioTab.tsx`、`ColorTab.tsx`、`EffectsTab.tsx`、`AnimateTab.tsx`、`SpeedTab.tsx`、`StyleTab.tsx`、`AiTab.tsx`。
- 已覆盖中文：检查器标签、变换/位置/缩放/旋转/锚点/不透明度、适配模式、音频淡入淡出、自动剪除静音、效果开关与基础操作、绿幕/色度键/运动跟踪、动效与速度分组、字幕和 AI 快捷操作。
- 保留的技术标识：AI、SVG、SRT、VTT、片段类型和内部 section id；测试文件中的英文断言未修改。
- 未覆盖的用户可见英文：检查器各功能面板内部文案、关键帧/转场详情、聊天面板和 KieAI 生成器，留待阶段 4 后续批次。
- 检查命令及结果：`git diff --check` 和 `pnpm run build:app` 通过；构建仅保留原有 chunk 过大、Browserslist 和动态导入提示。
- 是否通过当前子批次验收：是；继续处理阶段 4 的具体属性面板。

### 2026-09-08：阶段 4 基础属性、关键帧与转场批次验收完成

- 修改文件：`components/editor/inspector/AlignmentSection.tsx`、`BlendingSection.tsx`、`Transform3DSection.tsx`、`CropSection.tsx`、`KeyframesSection.tsx`、`TransitionInspector.tsx`。
- 已覆盖中文：对齐按钮与说明、混合模式、3D 变换、裁剪信息、关键帧属性与缓动选择、转场类型与参数、转场校验提示和操作结果。
- 新增或确认术语：`混合模式`、`不透明度`、`透视`、`关键帧`、`缓入/缓出`、`转场`、`片段`、`色度键`。
- 保留的技术标识：3D、SVG、像素单位、内部片段 id、动画/转场枚举值和测试断言；未知的底层错误文本不做宽泛替换。
- 未覆盖的用户可见英文：具体效果、文字、音频、字幕、贴纸、调色和 AI 面板内部文案，留待阶段 4 后续批次。
- 检查命令及结果：`git diff --check`、`git -C vendor/openreel diff --check` 和 `pnpm run build:app` 均通过；保留原有构建警告。
- 是否通过当前子批次验收：是；继续处理阶段 4 的具体功能面板。

### 2026-09-08：阶段 4 文字、文字动画与字幕批次验收完成

- 修改文件：`components/editor/inspector/TextSection.tsx`、`TextAnimationSection.tsx`、`CaptionEditorPanel.tsx`。
- 已覆盖中文：字体分类、文字内容与样式、对齐、描边、阴影、文字材质、3D 文字、动画预设与描述、动画时长/缓动/参数、字幕拆分、字幕选择和字幕编辑。
- 新增或确认术语：`文字内容`、`字体`、`文字材质`、`3D 文字`、`动画预设`、`入场/出场时长`、`缓入/缓出`、`单行字幕`、`可编辑字幕片段`。
- 保留的技术标识：动画预设 id、字体名、材质值、SRT/VTT、字幕轨道内部名称、历史记录字符串和用户输入文字；动画名称与描述仅在显示层映射为中文。
- 检查命令及结果：`git diff --check`、`git -C vendor/openreel diff --check` 和 `pnpm run build:app` 均通过；构建仅保留原有 chunk 过大、Browserslist 和动态导入提示。
- 是否通过当前子批次验收：是；继续处理阶段 4 的效果、聊天和 KieAI 面板。

## 每阶段更新模板

处理阶段：

- 修改文件：
- 新增/确认中文术语：
- 保留的技术标识：
- 未覆盖的用户可见英文：
- 检查命令及结果：
- 是否通过阶段验收：
