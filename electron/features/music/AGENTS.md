# 音乐领域规范与索引

继承 [领域扩展规则](../AGENTS.md)。

- `musicGenerationService.ts` 负责模板读取和生成服务，`musicMedia.ts` 负责生成素材接入。
- 当前音乐工具 schema/执行器仍位于 `electron/mcp/lunaMcpTaskCatalog.ts` 和 `lunaMcpTaskTools.ts`，由 `lunaAppToolModules.ts` 注册为独立 music 模块。这是现有组织方式，新领域不得照此堆入任务工具文件。
- 音乐模块仅适用于 editing 任务，不能因新增模板或执行路径绕过导演计划任务隔离。
- 生成结果沿用公共素材契约；下载、运行时资源和许可规则继承根目录要求，不在外部 Agent 适配器或聊天组件实现音频生成。
- 调整注册与隔离时运行相关 `scripts/test-luna-tool-modules.mjs`；修改生成工作进程契约时选择 `scripts/test-luna-bgm-worker.mjs`。

注册层见 [本机服务索引](../../mcp/README.md)。
