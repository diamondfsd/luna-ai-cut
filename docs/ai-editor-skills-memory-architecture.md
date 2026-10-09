# PC AI 导拍、素材标注、剪辑与记忆

PC 与 App 共用同一外部 Agent 发现入口和工作流名称。页面入口、领域数据及能力边界见 [AI 导拍与剪辑工作台](director-plan-ai-editing-workflow.md)。

## Agent 工作流

```text
全局 AI 助手
  → 本机任务/session 与技能发现
  → shooting / footage-creation / editing-workspace
  → 原生拍摄计划、素材标注或剪辑工程领域模块
  → Luna 主进程持久化与 luna-render-core 合成
```

- `shooting` 处理拍摄计划，不假设素材已经存在，也不把成片要求加到纯拍摄任务中。
- `footage-creation` 根据用户的真实标注选择素材并创建剪辑工程；评论是人工证据，不是视觉识别结果。
- `editing-workspace` 修改当前 `LunaEditProject`；剪辑计划与项目时间线是不同数据。
- `list_agent_skills/get_agent_skill` 返回实时技能；`select_task_workflow` 记录 Agent 的选择。页面不提供重复的功能选择下拉框。
- 写操作同时校验 sessionId、任务 revision 和工程 revision。素材 ID 与来源路径由主进程解析，不接受 Agent 传来的本地路径。

## 剪辑项目和素材标注

`LunaEditProject` 是可编辑工程的唯一数据模型，使用稳定 project/source/clip ID 和乐观 revision 存储。剪辑工具以一次批量操作更新工程，读回服务确认的最新 revision 后继续工作。

`FootageSelectionProject` 保存用户的整体决定、评论、标签、时间点和范围。点赞点和选段范围使用源素材时间；锁定范围必须原样保留。查询最近素材按素材拍摄时间筛选，不以评论时间或文件修改时间替代。

`luna-render-core` 保持桌面视频渲染合成职责。剪辑 UI 与 Agent 能力通过 preload、IPC 和领域服务访问本机资源；不把存储、工具调用或聊天历史塞进渲染器。

## 应用级记忆

记忆由 `electron/features/memory/` 提供，是跨拍摄、素材和剪辑任务的独立应用能力。它不声明业务 workflow，不依赖当前页面或剪辑工程。用户背景、偏好、项目决定和分析候选分别记录来源与适用范围；项目意见不能自动提升成全局偏好。

记忆仓储位于用户个人空间，工具适配器验证当前任务、范围和来源；历史、项目和渲染缓存都不作为记忆存储。实现及读取/更正/忘记规则见 [应用级记忆架构](app-memory-architecture.md)。

## 扩展规则

新能力在所属领域实现服务、schema 和 `LunaToolModule`，通过 `lunaAppToolModules.ts` 注册。技能正文描述真实可用工具，不写未注册能力。修改共享契约时同步更新 IPC/preload、Agent prompt、技能全文与对应目录文档。
