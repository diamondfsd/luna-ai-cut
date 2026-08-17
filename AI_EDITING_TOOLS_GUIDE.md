# Luna AI Cut AI 剪辑工具体系

Luna AI Cut 的模型编辑入口只有 `edit.run_script`。模型负责理解用户目标、写出脚本、读取结构化结果并决定下一步；Harness 负责脚本执行、能力转发、取消、超时和轮次边界。

## 数据流

```text
用户消息原文
  -> Harness 模型循环
  -> edit.run_script(code)
  -> luna.* SDK
  -> FreeCut Store / 媒体服务
  -> project.json
```

项目持久化唯一使用工作区中的 `projects/{id}/project.json`。AI 不直接读取、拼接或修改 JSON；需要读取项目、素材和时间轴时，必须调用脚本 SDK。

## 脚本运行环境

脚本是 ESM 模块，导出 `default async function main(luna)`。运行环境支持 Node.js JavaScript 的变量、循环、判断、函数、数组、对象、Promise、`async/await` 和标准库。脚本可以把一次分析的结果保存在变量中，在本地循环筛选，再通过批量能力提交剪辑。

脚本 SDK 命名空间包括：

- `luna.memory`：读取和维护跨项目用户偏好。
- `luna.media`：列出素材、读取已有证据、触发内容分析、搜索字幕。
- `luna.project`：查看项目和修改画布。
- `luna.timeline`：检查、添加、裁剪、切分、移动、删除片段，设置画面/音频/文字/关键帧/转场，并执行批量编辑。
- `luna.audio`：提交配音或音乐后台任务，以及查询任务状态。

## 长任务

音频生成和模型分析可能持续较长时间。提交任务返回 `taskId` 不代表已经生成媒体；脚本应等待一段时间后循环查询状态。只有状态为 `completed` 且返回有效 `mediaId` 时，才把结果加入时间轴；`failed` 时读取结构化错误并返回给模型。

## 编辑原则

- 开始规划时先读取 `media.list` 和 `project.inspect` 的结构化数据。
- 没有画面或字幕证据时，不要假设素材内容。
- 时间轴位置和持续时间统一使用秒；画面位置和尺寸使用 SDK 约定的归一化单位。
- 长视频优先批量分析、在脚本内循环筛选，再批量添加或修改片段。
- 每个阶段读取 SDK 返回的 `data`，检查片段 ID、时间范围和结果状态。
- 完成一组编辑后再次调用 `project.inspect` 或 `timeline.inspect_context` 复核整体结果。
- 能力结果必须返回模型；宿主不能根据脚本文案猜测用户意图、任务类型或完成状态。

## 相关实现

- `scripts/deepseek-harness-freecut-plugin.mjs`：注册唯一模型工具并生成 SDK 说明。
- `scripts/deepseek-harness-script-runtime.mjs`：隔离执行脚本、转发 SDK 请求和处理脚本生命周期。
- `packages/freecut-editor/src/features/project-source/project-source-tools.ts`：能力注册、参数校验和执行入口。
- `packages/freecut-editor/src/features/project-source/project-source-media-tools.ts`：素材证据能力。
- `packages/freecut-editor/src/features/project-source/project-source-ai-tools.ts`：项目和时间轴能力。
- `packages/freecut-editor/src/features/project-source/project-source-audio-tasks.ts`：异步音频任务能力。
- `packages/freecut-editor/src/infrastructure/storage/workspace-fs/projects.ts`：`project.json` 持久化。
