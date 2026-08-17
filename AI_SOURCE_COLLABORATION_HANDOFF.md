# DeepSeek Harness 剪辑脚本交接

更新时间：2026-08-17

## 目标

DeepSeek Harness 负责会话、上下文、模型请求、脚本循环和最终答复。Luna AI Cut 只提供结构化剪辑能力，并把模型唯一可见的编辑入口限制为 `edit.run_script`。

```text
用户消息原文
  -> DeepSeek Harness
  -> edit.run_script
  -> luna.media / luna.project / luna.timeline / luna.audio
  -> FreeCut Store
  -> projects/{id}/project.json
```

## 当前结构

| 层 | 职责 | 关键文件 |
| --- | --- | --- |
| Harness runtime | 启动官方 `dsh web`、管理会话和模型循环 | `electron/deepseekHarnessService.ts` |
| FreeCut 插件 | 只注册 `edit.run_script`，注入脚本 SDK 说明 | `scripts/deepseek-harness-freecut-plugin.mjs`、`scripts/deepseek-harness-script-runtime.mjs` |
| Renderer capability | 校验参数、执行媒体/项目/时间轴/音频能力并返回结构化结果 | `packages/freecut-editor/src/features/project-source/` |
| Electron bridge | 转发结构化能力请求、响应和取消 | `electron/deepseekHarnessService.ts`、`electron/ipcDeepSeekHarness.ts` |
| 持久化 | 直接读写唯一的 `project.json` | `packages/freecut-editor/src/infrastructure/storage/workspace-fs/projects.ts`、`timeline-persistence.ts` |

## 能力边界

- 模型不能直接调用 `media.*`、`timeline.*` 或其他编辑能力；这些能力只能由脚本中的 `luna.*` SDK 调用。
- 脚本支持变量、循环、条件、函数、Promise 和 `async/await`，适合长视频抽帧结果筛选、批量剪辑和异步音频任务轮询。
- `audio.start_speech` 和 `audio.start_music` 只提交后台任务；脚本必须循环调用 `audio.get_task`，直到任务完成或失败。
- 时间轴编辑保存前执行结构校验；结果返回 Harness，由模型决定继续、修订还是结束，宿主不会根据文案自行宣告完成。
- AI 不读取或修改 `project.json` 原文，不创建项目源码树，也不使用 Git 工作树作为编辑格式。

## 运行时构建

```bash
pnpm run build:harness-runtime
pnpm run build:app
```

Harness 进程使用独立的 `deepseek-harness/sessions` 会话目录作为工作目录。项目文件不会作为 Harness 的工作树暴露；脚本通过 loopback 能力通道访问当前打开项目的 Store。

## 验证重点

- 用户消息保持原文传给模型。
- 只有 `edit.run_script` 出现在模型的编辑工具目录中。
- 脚本能力结果返回模型，模型决定下一步。
- 长任务的排队、模型下载和处理中状态不会被宿主当作失败。
- `project.json` 保存和加载都不依赖源码 Git 服务。
- 取消、项目切换、能力参数校验和工具超时仍由宿主的确定性协议处理。
