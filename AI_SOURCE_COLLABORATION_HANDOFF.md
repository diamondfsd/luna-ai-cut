# DeepSeek Harness 源码协同交接

更新时间：2026-08-14

## 目标

在剪辑详情页右侧嵌入 DeepSeek Harness。Harness 负责会话、上下文、模型请求、工具调用循环以及何时结束；FreeCut 只负责提供受约束的工程源码能力、保存模型连接配置和展示事件。

FreeCut 不维护第二套 Agent loop，不维护自己的业务提示词，不根据用户或模型的自然语言判断意图、确认、执行或完成。

## 当前结构

| 层 | 职责 | 关键文件 |
| --- | --- | --- |
| Harness runtime | 启动官方 `dsh web`、创建会话、调用 OpenAI 兼容模型、继续工具循环、提供官方 Web UI | electron/deepseekHarnessService.ts、scripts/build-deepseek-harness-web.mjs |
| FreeCut 插件 | 注册工程源码工具并把执行权交给宿主 capability | scripts/deepseek-harness-freecut-plugin.mjs |
| Renderer capability | 校验参数、读写工程源码、校验时间轴、重新加载编辑器 | packages/freecut-editor/src/features/project-source/project-source-tools.ts |
| Electron bridge | 保存连接配置、转发 Harness 事件和源码工具请求 | electron/deepseekHarnessConfig.ts、electron/ipcDeepSeekHarness.ts |
| 右侧面板 | 独立可调宽度的 iframe 面板，复用 Harness 官方对话区；FreeCut 只提供连接配置弹窗 | packages/freecut-editor/src/features/editor/components/deepseek-harness-dock.tsx、packages/freecut-editor/src/features/editor/components/deepseek-harness-panel.tsx |

## 已注册工具

- source.tree
- source.read
- source.search
- source.apply_changes
- source.check
- source.diff

工具结果会回传 Harness，由 Harness 决定下一次模型请求或最终答复。宿主不会在工具成功后自行宣布完成。

源码写入仍受以下确定性约束保护：

- 路径、参数、扩展名和大小限制。
- expectedContent 并发保护。
- 批量写入后重新解析源码；校验失败时回滚。
- 成功后通过现有时间轴加载入口刷新编辑器。
- 写入期间使用源码写入所有权，避免与人工写入并发。

## 连接配置

右侧 AI 面板支持：

- Base URL
- API Key
- Model
- Context Window

API Key 只保存在 Electron 主进程的本地配置文件中，Renderer 只能读取 hasApiKey。Base URL 只允许 HTTPS；本机调试服务允许 HTTP。

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
