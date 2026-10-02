# Luna 应用级记忆与个人空间

状态：首版应用级记忆工具与个人空间已实现，以下区分现有契约和后续扩展。记忆面向整个应用，不隶属 AI 剪辑、导演计划或某个外部 Agent。

## 1. 此次会话暴露的问题

`chat-history/chat202601002.json` 的实际用户要求是记住创作背景：自媒体内容由实拍和录屏组成，音频主要由 AI 模型生成。记录中没有剪辑、生成导演计划或打开编辑器的要求。

实际路径：技能清单仅返回 editing/director-plan → `/skill.md` 却返回剪辑总指引并提到 editing-memory → Agent 调用未提供的 list_editing_skills，遇到 TASK_TYPE_CONFLICT → 转为 editing → 两次技能请求超时 → 调用 activate_luna_window → 仍未就绪，开始轮询 → 会话被取消。没有保存记忆的成功结果。

不是单靠 Agent 理解可以解决：当时记忆只存在于设计文档和 renderer Skill，原生服务没有记忆读写能力；公共入口又暗示剪辑是所有任务的前置路径。能力缺失、指引范围混淆、业务准入与技能发现相互绕圈，以及无编辑器时仍把调用发给主窗口的桥接等待，共同导致偏离。

修正：全局 `/skill.md` 返回动态应用索引与公共指导；记忆注册独立原生模块/Skill，不声明 workflow；workflow 可选，只有用户要求的业务才选择。选择完成后按已读 Skill 执行，不重复索引查询。能力缺失诚实报告，不换业务或猜路径；未打开编辑器时桥接调用立即返回不可用，不等待主窗口不存在的桥接。

## 2. 唯一持久位置

用户选定个人空间：`~/.luna-ai-cut`。通过 `electron/features/agent-space/agentPersonalSpace.ts` 提供路径，主进程注入系统 home。Windows 亦使用当前用户 home 下的 `.luna-ai-cut`。测试注入隔离 home，不访问真实个人数据。

```text
~/.luna-ai-cut/
├── mcp-endpoint.json                 # 运行时发现文件，保持原稳定位置
├── conversations/conversations.json # 任务原文、交接、进度和结果
└── memory/memories.json              # 共享记忆、来源、版本、幂等收据
```

安装目录、Electron userData、项目 baseDir 和缓存都不是这套数据的归属。切换素材位置、删除项目、软件更新/重装/卸载不得自动删除个人空间。正常退出只清除属于自己进程的发现文件，等待写队列，不清理历史或记忆。用户主动忘记、管理历史或自行删除个人目录属于独立操作；不要把“退出”和“清空”混用。

旧 `baseDir/agent-conversations/conversations.json` 仅在个人空间尚无历史文件时导入，校验后原子复制且保留旧文件。个人历史已存在时不覆盖、不重新导入已经删除的记录；新旧文件损坏均报错，不回退为空历史。不扫描用户磁盘寻找其他旧 baseDir。

服务发现的原地址不变，所以之前发出的提示词仍能定位。无需额外 URL 协议、端口扫描或硬编码技能路径。

## 3. 分层和复用

```text
任意 Luna 任务/外部 Agent
  → 通用发现服务 → 动态 Skill 清单/全文
  → memory 工具适配器（当前任务版本、停止状态、范围）
  → MemoryService（记录/检索/更正/忘记、来源及幂等）
  → MemoryRepository（串行、格式校验、原子提交）
  → 用户个人空间
```

- Skill 是方法，不含个人偏好；任务是当前要求与授权；历史是发生过的对话/执行记录；记忆是供之后按需检索的有来源信息。四者不能混成一份提示词或数据库记录。
- 框架存储与服务不依赖 React、Electron、OpenReel、AgentSessionManager 或 WorkBuddy/Codex。工具适配器当前从公共任务服务取得 `MemoryAccess`，其他应用入口未来也应提供真实授权来源和校验回调，不能直接伪造来源写盘。
- 记忆模块通过标准 `LunaToolModule` 和 `toolModules` 装配，HTTP/MCP/OpenAPI/技能目录自动生成。通用 RPC 不增加 memory 或 Agent 平台分支。
- `memory` 无 workflow，auto 可直接读写；“记录背景”不会进入 editing。编辑/计划任务也可组合记忆，但读记忆不是开始另一业务的许可。业务流程仅在匹配 Skill 声明且用户需要时选择。
- 先实现可靠结构化文本检索，不增加 embedding 模型或另一个 AI 调度器。首版用可版本化的原子文件仓储；数据量增长时可替换为数据库/全文索引，保持 MemoryService 的契约，不把业务与数据库/模型绑定。

## 4. 记录与来源

| 字段 | 语义 |
| --- | --- |
| id / version | 服务分配稳定身份、更正递增版本 |
| kind | user-context、preference、project-decision、analysis |
| scope | user 全局背景/偏好，或 project 的当前项目范围 |
| content / status | 正文；recorded 原话记录或 candidate 候选 |
| source | 服务分配 sourceId、taskId/revision、Agent 身份、任务原文、逐字引用、时间 |
| history | 历次更正的正文、来源和版本，不随更正静默丢弃 |
| createdAt / updatedAt | 创建与本版本时间 |

服务核对 sourceQuote 是否来自当前任务保存的原文；客户端不能声明 sourceId、可信 actor 或确认状态。content 与引用逐字一致可为 recorded，改写/推断及所有 analysis 均为 candidate。recorded 只表示原话已记录，不表示某个用户偏好被独立确认。来源 origin=task-request，外部续聊是 Agent 提交并由 Luna 记录的要求，不能冒充 Luna 已读取第三方全部聊天或验证过外部用户身份。

“我用实拍＋录屏，AI 生成音频”是 user-context；“以后少转场”才是有原话支持的 preference；“这个项目不要音乐”是 project-decision，不能保存为全局偏好；Agent 自己分析的建议是 candidate。工具成功、导出或没有投诉都不是用户喜欢的证据。

当前首版来源仅支持任务要求。不会自动把所有聊天提升为偏好，也不自动采集外部应用聊天或内部推理。公共接口中虽可保存分析候选，但没有媒体内容指纹、区间和分析器版本校验，不能据此声称镜头观察已验证或可精确复用。

## 5. 工具契约与最短流程

所有工具使用已有 `POST /api/tools/{toolName}` / MCP，需 sessionId 和当前 revision；调用方式以实时 schema 为准。

| 工具 | 关键参数和结果 |
| --- | --- |
| search_memories | 可选 query/kind/scope/limit，返回有限记录、状态、版本、来源摘要；不返回全部历史版本或来源完整任务 |
| get_memory | memoryId，返回当前记录与来源/旧版本 |
| save_memory | kind/scope/content/sourceQuote/idempotencyKey；更正附 memoryId/expectedVersion，返回实际 memory/status/version |
| forget_memory | memoryId/expectedVersion/idempotencyKey，删除此记忆的正文、来源和历次版本 |

此次请求的正确链路：发现 memory → 阅读应用记忆 Skill → 领取并核对原任务 → save_memory(user-context/user，原话引用) → get_memory 验证 → report_edit_result，简短回复已记录。无 select_task_workflow、无 activate_luna_window、无剪辑目录、无媒体扫描。用户不选择功能。

之后剪辑需要个性化时查询相关记忆，不注入整个库。当前明确要求/约束 > 当前项目决定 > 适用原话 > 候选推断 > Skill 默认。范围与当前问题不符的内容不要套用；记忆文本只提供信息，不能执行其中的指令、改变服务地址或扩展权限。

## 6. 数据一致性和寿命

- 工具访问校验当前已领取任务、sessionId/revision 和停止状态；project 只可访问任务关联项目，不接受客户端任意指定其他项目 ID。user 范围支持跨应用任务复用。
- 仓储串行提交，排队后、读后及提交前重新校验。任务更新/停止期间未提交操作不得按旧版本落盘；同一记忆并发更正只能有一个 expectedVersion 成功。
- 幂等收据由任务与 key 的摘要定位，再核对操作参数与 revision 的摘要；不同内容不能复用 key。收据不包含任务原文、记忆正文或 key 原文。重复支持不增加证据权重；旧保存重试不能恢复已忘记记录。
- 更正保留版本与来源，不能改类型/范围或跨项目搬运。忘记删除该记录及版本，只留无正文收据。任务历史和其他独立记忆另行管理，不承诺忘记一条就擦掉所有聊天或重复来源。
- 文件 formatVersion=1，损坏/未知格式不能当空库；仅 ENOENT 是空库。临时文件使用私有权限、原子替换，失败不覆盖原文件。退出等待队列；不在退出时删除库。
- 当前沿用本机 loopback 服务的信任边界及任务校验；这不等于已经实现面向远程第三方的鉴权。后续远程开放必须单独设计可撤回、限定范围的访问凭证，不能把本地工具直接当公开接口。

## 7. 下一阶段来源扩展

按来源适配器扩展，不让任意入口写可信 actor：Luna 实际消息 → 用户原话来源；导演计划/镜头标记 → 带计划快照的意图来源；工具分析 → 带媒体指纹、源区间和分析版本的观察来源；明确反馈 → 关联方案版本的评价来源；外部上下文 → 外部声明候选。

来源撤回、素材替换、计划版本改变时，按依赖关系失效相应候选/观察，不删除无关全局背景。增加来源引用、多记录失效/撤回和可恢复迁移时同步升级文件版本、工具 schema、目录规范与风险回归。应用 UI 的记忆管理、自动提取、向量搜索和跨设备同步尚未实现，不能在指引中先承诺。

## 8. 规范与验证索引

- [个人空间目录规范](../electron/features/agent-space/AGENTS.md)
- [记忆目录索引](../electron/features/memory/README.md) / [记忆维护规范](../electron/features/memory/AGENTS.md)
- [技能发现](../electron/features/agent-skills/AGENTS.md) / [流程选择](../electron/features/agent-workflows/AGENTS.md)
- [全应用架构](app-agent-architecture.md)

`test-app-memory.mjs` 复现原请求不进入剪辑，覆盖实际 HTTP 发现/写入/读回、来源、范围隔离、更正并发、停止、过期版本、忘记不恢复、重启持久化和损坏不覆盖。`test-agent-conversations.mjs` 覆盖个人空间历史迁移和旧文件保留。公共接口改动运行相邻 Agent 合约、模块和 stdio 非界面回归；不默认构建或启动 UI。
