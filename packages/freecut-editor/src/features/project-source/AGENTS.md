# AI Editing Capability Adapters

本目录提供 DeepSeek Harness 剪辑脚本调用的结构化能力适配器。它不是项目源码仓库，也不创建 Git 工作树。

## 唯一数据来源

- 编辑项目唯一持久化来源是工作区中的 `projects/{id}/project.json`。
- 时间轴 Store 负责编辑内存状态；保存时由 `saveTimeline()` 直接将规范化快照写回 `project.json`。
- 加载时先读取 `project.json`，再执行现有项目迁移和 Store hydration。
- AI 不直接读取、拼接或修改 `project.json`；所有项目读取和编辑必须通过结构化能力或 `edit.run_script` 中的 `luna.*` SDK。

## 能力边界

- `project-source-tools.ts` 提供编辑能力注册、参数校验和执行入口。
- `project-source-media-tools.ts` 提供素材清单、素材证据、内容分析和字幕检索。
- `project-source-ai-tools.ts` 提供项目、时间轴和批量编辑能力。
- `project-source-audio-tasks.ts` 提供配音、音乐后台任务提交与状态查询。
- 宿主只负责转发结构化能力请求、校验参数、执行和返回结果；不得根据自然语言猜测模型意图或自行宣告任务完成。

## 修改要求

1. 新增能力必须使用 Zod 参数校验，并限制返回结果大小。
2. 修改时间轴前读取当前 Store 状态；编辑完成后通过 `saveTimeline()` 持久化并返回结构化摘要。
3. 长任务必须返回可查询的任务标识和阶段状态，不能把排队或模型下载中的状态当作失败。
4. 不新增直接修改 JSON、文件树或 Git 工作树的接口。
5. 媒体路径、文件内容和运行时句柄只能在既有安全边界内使用，不得返回给模型。

## 验证

在修改本目录的能力或持久化契约后，至少运行相关 Vitest、`tsc --noEmit`、ESLint 和 `pnpm run build:app`。
