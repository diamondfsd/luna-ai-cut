# Agent 个人空间索引

维护规范见 [AGENTS.md](AGENTS.md)，整体设计见 [应用记忆架构](../../../docs/app-memory-architecture.md)。

`agentPersonalSpace.ts` 是个人空间的唯一路径入口，生产使用系统当前用户 home；自动化必须注入隔离 home，不触碰用户真实目录。

| 位置 | 用途 | 生命周期 |
| --- | --- | --- |
| `~/.luna-ai-cut/memory/memories.json` | 应用级记忆及版本、来源、幂等收据 | 用户主动管理，更新/卸载不删除 |
| `~/.luna-ai-cut/conversations/conversations.json` | Luna 任务原文、交接和进度历史 | 用户主动管理，更新/卸载不删除 |
| `~/.luna-ai-cut/mcp-endpoint.json` | 当前本机服务地址 | 启动原子更新，退出仅清理自己进程的记录 |

旧任务历史从当前 `baseDir/agent-conversations/conversations.json` 延迟导入，仅在新历史文件不存在时执行。验证后原子复制，保留旧文件；新空间存在或损坏时不得用旧文件覆盖。实现仍在 external-agents 的存储层，公共路径模块不解析业务数据。

未来 Agent 配置、用户 Skill 等持久信息应在此根目录按职责分子目录，不存放模型二进制、项目媒体或临时缓存。目录不存在本身不是需要清空/重建其他数据的理由。

验证：`scripts/test-agent-conversations.mjs`（旧历史迁移），`scripts/test-app-memory.mjs`（路径、记忆、发现生命周期），`scripts/test-luna-tool-modules.mjs`（发现文件）。
