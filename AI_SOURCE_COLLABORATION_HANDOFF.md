# DeepSeek Harness 源码协同交接

更新时间：2026-08-14

## 目标

在剪辑详情页右侧嵌入 DeepSeek Harness。Harness 负责会话、上下文、模型请求、工具调用循环以及何时结束；FreeCut 只负责提供受约束的工程源码能力和展示事件，模型与凭据设置由 Harness 原生设置页管理。

FreeCut 不维护第二套 Agent loop，也不根据用户或模型的自然语言判断意图、确认、执行或完成。项目级工具说明和剪辑流程提示词由 FreeCut Harness 插件注入 Harness 的 system prompt，最终仍由模型决定何时读取、规划、编辑和收尾。

## 当前结构

| 层 | 职责 | 关键文件 |
| --- | --- | --- |
| Harness runtime | 启动官方 `dsh web`、创建会话、调用 OpenAI 兼容模型、继续工具循环、提供官方 Web UI | electron/deepseekHarnessService.ts、scripts/build-deepseek-harness-web.mjs |
| FreeCut 插件 | 注册工程源码工具并把执行权交给宿主 capability | scripts/deepseek-harness-freecut-plugin.mjs |
| Renderer capability | 校验参数、通过时间轴 Store 执行结构化编辑、保存并回读工程源码 | packages/freecut-editor/src/features/project-source/project-source-tools.ts、project-source-ai-tools.ts |
| Electron bridge | 启动 Harness、转发事件和源码工具请求 | electron/deepseekHarnessService.ts、electron/ipcDeepSeekHarness.ts |
| 右侧面板 | 独立可调宽度的 iframe 面板，复用 Harness 官方对话区；工具栏设置按钮打开 Harness 原生模型设置页 | packages/freecut-editor/src/features/editor/components/deepseek-harness-dock.tsx、packages/freecut-editor/src/features/editor/components/deepseek-harness-panel.tsx |

## 已注册工具

- source.tree
- source.read
- source.search
- source.check
- source.diff
- media.list
- media.read
- media.analyze
- media.search_transcript
- project.inspect
- timeline.inspect_context
- timeline.trim / timeline.split / timeline.move / timeline.remove
- timeline.set_properties / timeline.set_transform / timeline.set_audio
- timeline.add_text / timeline.add_keyframe / timeline.add_transition

工具结果会回传 Harness，由 Harness 决定下一次模型请求或最终答复。宿主不会在工具成功后自行宣布完成。

插件的工具渲染器会把每次成功工具调用的完整 `{ ok, message, data }` 结果以 JSON 文本回传模型；`message` 只用于简短说明，`data` 才是素材清单、时间轴轨道和片段、源码文件列表或文件内容等实际结果。项目级剪辑提示词要求模型优先读取这些 `data` 字段，并按“盘点素材和时间轴 → 补充画面/口播证据 → 规划最小修改 → 调用 timeline 工具 → 校验结果”的顺序工作。

AI 剪辑不暴露原始源码写入工具，所有编辑都经过现有时间轴动作和保存入口：

- 时间和持续时间统一使用秒，工具层转换为时间轴帧。
- 删除、切分、转场和关键帧复用编辑器已有级联与修复逻辑。
- 每次编辑保存后回读工程源码，并再次检查时间轴引用完整性。
- source.* 仅用于只读诊断和查看源码差异，模型不能借此绕过时间轴工具改 JSON。
- media.list 只读取当前项目已关联素材的元数据；media.read 读取已生成的本地画面理解和带时间点字幕；media.analyze 显式触发本地口播识别或视频抽帧理解。它们不向模型返回本地路径、文件句柄或原始素材内容。

## Harness 设置

右侧 AI 面板的设置按钮会打开 Harness 原生的“模型”设置页。Base URL、API Key、模型目录和模型容量都由 Harness 写入自己的 `settings.yaml` 与凭据存储，FreeCut 不再维护第二套连接配置或复制 API Key。

## 运行时构建

vendored Harness 的 host runtime 在应用构建后生成：

    pnpm run build:harness-runtime

pnpm run build:app、pnpm run build 和 debug 构建都会自动执行这一步。runtime 输出为 `dist/deepseek-harness/`，生产包通过 `extraResources` 复制到 `resources/deepseek-harness/`。

开发模式下，Electron 主进程使用外部 Node.js 22 启动官方 CLI：

    node apps/cli/lib/bin.js web --host 127.0.0.1 --port 0

子进程的工作目录是 `freecut-workspace/projects/<projectId>/editing-source`，所以 Harness 的基础目录就是当前项目源码目录。FreeCut 只把官方返回的 loopback URL 放进 iframe，不维护另一套聊天 UI 或 Agent loop。开发环境可通过 `LUNA_HARNESS_NODE_PATH` 指定 Node.js 22；pnpm 启动时默认继承 `npm_node_execpath`。

这等价于在 Harness 仓库目录执行 `pnpm dsh web`，但由 Electron 主进程按当前项目按需启动，使用随机 loopback 端口，并负责插件参数注入、配置重载和退出回收。不要在 `pnpm dev` 旁边再固定启动一个独立的 `dsh web` 进程，否则它无法稳定绑定当前项目的源码目录和 FreeCut 插件通道，也容易产生端口与生命周期残留。

生产包需要在 `resources/node-runtime/` 携带 Node.js 22 runtime，因为 Electron 30 自带的 Node.js 20 不满足 Harness 的运行要求。打包命令会通过 `scripts/prepare-node-runtime.mjs` 下载官方 Node.js `v22.22.2` 并只保留可执行文件和许可证；开发环境仍使用外部 Node.js 22。

## 验证

    pnpm exec tsc --noEmit
    pnpm run build:app
    pnpm --dir packages/freecut-editor exec vitest run \
      src/features/project-source/project-source-tools.test.ts \
      src/features/project-source/project-source-codec.test.ts \
      src/features/project-source/project-source-write-ownership.test.ts

Electron 行为测试需要使用仓库统一的 Playwright Electron fixture，覆盖会话创建、用户原文传递、工具结果回传模型、取消和配置重载。不要为业务文案新增意图分类测试。
