# Luna 全应用 Agent 扩展架构

目标：外部 Agent 使用同一个本机服务控制 Luna；新增功能在业务模块内提供工具和指引，不向 RPC、聊天面板或应用适配器追加工具名判断。

## 源码规范索引

本文件说明整体设计；实际修改时先读所属目录的 `AGENTS.md` 和索引。分层约束以目录规范为维护入口，不只保留在设计文档中。

- [本机服务与工具注册](../electron/mcp/README.md)
- [领域服务扩展](../electron/features/AGENTS.md)，现有领域：[导演计划](../electron/features/director-lab/AGENTS.md)、[音乐](../electron/features/music/AGENTS.md)
- [全应用技能查询与读取](../electron/features/agent-skills/README.md)
- [Agent 自主分流与统一技能索引](../electron/features/agent-workflows/README.md)
- [外部应用适配、任务交接与历史](../electron/features/external-agents/README.md)
- [IPC 装配](../electron/ipc/AGENTS.md)
- [全局 AI 助手](../src/components/agent-chat/README.md)
- [共享契约](../src/shared/types/AGENTS.md)
- [提示词与发现](../src/lib/AGENTS.md)

新增或迁移模块时同步更新其目录索引、根目录导航和本索引。

## 分层与依赖

```text
全局 AI 助手 → 主进程任务协调器 → 外部 Agent 应用适配器
                   ↓                  ↓
             任务会话与本地历史    外部 Agent 读取发现文件
                                      ↓
                               HTTP / MCP 协议入口
                                      ↓
                           工具注册表 → 领域模块 → 领域服务
```

- 协议层 `lunaMcpRpc.ts`：解析 MCP 请求、通用模块权限检查、路由、结果封装；不判断导演计划、音乐或剪辑工具名。
- 组合入口 `lunaAppToolModules.ts`：注册任务会话、音乐、导演计划模块，接收未来 `toolModules` 扩展。现有动态 iframe 工具以剪辑领域 fallback 接入，权限与执行逻辑在 `lunaEditorToolModule.ts`；这是旧桥接契约的兼容边界，后续领域不要放进 fallback。
- 模块契约 `lunaToolModule.ts`：模块 ID、工具名称/说明/输入 schema、可选任务类型权限、执行器和 skills 元数据/全文。工具名重复时拒绝注册；已注册工具的执行器未处理请求时返回内部错误，不能误入剪辑桥接。
- 领域层：拥有参数校验、会话/revision 校验、取消、资源访问及持久化规则。输入 schema 用于发现，不能替代领域层运行时校验。模块依赖领域服务，不依赖具体外部 Agent。
- 应用适配器：安装探测、打开/下载能力、草稿或剪贴板交接。不能创建项目、导演计划或保存任务历史。
- 任务协调器：校验需求、禁止覆盖活动任务、默认创建 auto 会话、生成通用服务/工具发现提示词、持久化原始要求，再发起交接。失败取消新会话并记录错误。
- 技能发现领域：list_agent_skills 返回当前注册表的描述与 workflow，get_agent_skill 按返回编号读取当前全文；原生只读，不依赖编辑器。前端提示词只有服务/工具发现，没有业务路径或技能分支。
- 自主分流领域：Agent 根据技能工具实际返回的用户需求相关 description、workflow 和全文选择 Skill；`select_task_workflow` 校验会话和 revision 后启用对应领域。未选择不会进入剪辑；不在 Luna 做关键词分类。`update_task_request` 接收外部用户后续要求，旧确认和旧 revision 失效。
- 会话和历史：会话用于当前执行、revision、取消与确认；历史用于跨重启回看。历史不是第三方聊天同步或长期用户记忆。

当前共享类型沿用 `AiEditor*` 命名以保持 IPC 和 iframe 兼容，但 RPC 路由已不以编辑器为扩展中心。后续迁移公共命名应独立进行，不同时改动现有桥接契约。

## 新功能接入

1. 在自己的领域目录实现服务、工具 schema 和执行器，明确哪些操作需要会话、哪些只读、哪些需用户确认。
2. 创建 `LunaToolModule`，注册到组合入口或通过服务选项 `toolModules` 注入。工具自动进入 MCP/HTTP 工具清单和 OpenAPI；RPC 无需修改。
3. 在模块 skills 中注册最新业务 Markdown 指引，技能工具自动发现。新增执行流程需扩展公共契约、会话和 agent-workflows 的受支持流程；不新增用户功能选择，不把任务分类策略放入 RPC。
4. 为持久化、并发/取消或跨进程契约选择非界面回归。仅文案或静态布局不新增专用测试。

例如未来素材管理、相机控制、资源下载各自注册领域工具模块。通用任务工具继续上报进度和结果，全局面板无需知道每个业务工具名。

顶层清单包含注册的领域指引，场景技能和资源通过领域全文声明的下级工具继续发现。Markdown 索引/全文地址仅作兼容；选择流程返回技能查询条件，不固定某个指引路径。

## 对话入口

Agent 选择位于输入区，用户只描述需求；顶部下拉查看历史，选中记录隐藏输入框。Luna 不编辑历史或提供后续聊天编辑，提示用户在该记录实际使用的 Agent 继续。活动会话仍可停止和确认导出。旧显式 purpose 调用和存档保留兼容。

## 扩展边界

工具模块是应用内部注册机制，不支持外部代码任意注入或执行。`allowedPurposes` 是已有任务的模块准入规则，不是完整授权系统；涉及文件写入、下载或危险操作仍必须在领域服务执行精确校验。

跨重启历史通过本地存储读取，外部 Agent 尚不能通过工具读取整份历史。将来加入记忆时应建立独立 memory 领域模块，区分原始对话、用户确认偏好和镜头分析，记录来源/项目范围并支持更正与删除，不能直接把全部任务历史当成已确认偏好。

## 验证

`test-luna-tool-modules.mjs` 覆盖额外领域无需修改 RPC 的发现与执行、工具名冲突、任务类型拒绝、注册处理器不可落入剪辑桥接、导演任务不激活剪辑窗口以及发现文件生命周期。
`test-agent-conversations.mjs` 覆盖首次原文先保存再交接、重启读取、乱序事件、交接失败取消、活动任务不替换与损坏历史不覆盖。

### 任务延续与执行版本

任务没有永久结束状态。completed / failed / cancelled 仅是单次执行结果；外部对话中的新要求通过 update_task_request 沿用 sessionId，并递增 revision。接口从内存历史或持久化记录恢复任务，保留创建时间、首次原话、项目关联和历史结果事件。重启不自动恢复执行，必须提供明确的新要求。

继续后先 get_edit_request，再发现技能、选择 workflow。停止状态和旧导出确认清除，旧 revision 的结果不得写入新执行。正在等待的编辑调用在要求更新后返回 REQUEST_UPDATED；已经提交到编辑器的操作不能回滚，Agent 应读取最新编辑状态再继续。其他任务正在执行时禁止覆盖。AgentSessionArchive 负责历史查找，存储通过 load 注入，通用 RPC 不依赖历史文件。
