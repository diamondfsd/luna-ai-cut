# Agent 自主选择流程规范

先读 [目录索引](README.md)，继承 [领域扩展规则](../AGENTS.md)。

- 全局面板发送原始需求，任务初始 `purpose=auto`；不在 UI、协调器或本领域用关键词分类，不要求用户选择功能。
- Agent 通过 list_agent_skills/get_agent_skill 读取实时描述、可选 workflow 和全文，根据需求自行选择。无 workflow 的应用级技能直接执行，auto 可保持 auto；不为记忆或只读发现选择剪辑。发现和读取归 agent-skills，公共会话指引位于 agentTaskGuidance.ts；新增技能不向 RPC 或提示词追加分支。
- `select_task_workflow` 必须校验已领取会话、sessionId、当前 revision、取消/当前执行与待确认状态；选择仅能从 auto 转入受支持流程，同流程重试幂等，禁止静默切换已选流程。
- auto 任务领取不打开编辑器；未选择时禁止剪辑、音乐与导演计划写入。只读发现可用于判断。服务端隔离不依赖提示词。
- `update_task_request` 只记录外部对话中用户实际提供的新要求，不能替用户改写意图。检查会话和 revision；成功后 Agent 必须 get_edit_request，旧导出确认须失效。首次原始存档保持不变。
- 新指引使用安全且唯一的 skill id；`index` 保留给统一索引，不能覆盖。声明技能不等于授予写入权限。
- 目前可选执行流程为 editing 和 director-plan；未来新增执行流程需同步公共契约、会话、策略和本领域工具 schema，不能新增用户功能下拉。
- 选择流程后的结果引导直接执行已读技能，不强制重新查清单；缺失工具/技能时诚实报告能力不足，不改写用户目标、猜路径、调用未列出的工具或反复等待。/skill.md 保持全应用范围。

回归：`scripts/test-luna-tool-modules.mjs`、`scripts/test-agent-conversations.mjs`。不启动 UI 验收或构建。
