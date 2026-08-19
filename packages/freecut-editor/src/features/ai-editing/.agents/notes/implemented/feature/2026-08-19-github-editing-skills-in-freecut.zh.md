# Agent Note: GitHub 剪辑 skill 集成 FreeCut Harness

[English](2026-08-19-github-editing-skills-in-freecut.md) | 中文

## 问题

FreeCut 的 AI 剪辑技能已经覆盖风格、节奏、声音和软件工作流，但缺少一套针对口播短视频的端到端规则，也缺少把社区 skill 中的预检、对稿、可审计粗剪和交付复核经验整理到当前 `luna.*` 时间轴能力的方法。

## 决策

FreeCut 将 GitHub 社区 skill 的通用经验重新整理为三个内置 skill：`luna-style-talking-head-short` 负责口播短视频，`luna-technique-editing-playbook` 负责通用剪辑技巧，`luna-workflow-short-form-production` 负责从预检到交付的流程。它们由 `scripts/deepseek-harness-built-in-skills.mjs` 注册到 `ctx.skills`，由 DeepSeek Harness 的 `skill` 工具按需加载。

新 skill 只引用当前已有的 `edit.run_script`、`luna.media`、`luna.project`、`luna.timeline` 和 `luna.audio` 能力。外部仓库中的 FFmpeg、云端转写、HyperFrames、平台审核或额外模型不会成为 FreeCut 的隐式依赖；当前工具无法提供的渲染、节拍检测或专业音频能力必须报告为未验证或能力限制。

GitHub 资料来源及提炼范围记录在 `skills/built-in/shared/research-sources.md`，技能正文使用重新编写的规则，不复制外部仓库的脚本或模板。

## 考虑过的替代方案

- **直接 vendoring 外部 skill 的脚本和依赖**：不采用，因为这些脚本依赖 FFmpeg、Python、云端服务或其他编辑器运行时，且会绕过 FreeCut 的 `luna.*` 时间轴写入边界。
- **只增强现有 `luna-style-talking-head`**：不采用，因为口播风格、通用剪辑决策和短视频交付流程的触发场景与职责不同，拆分后模型可以按任务加载最小必要上下文。
- **让宿主根据用户文案自动选择新 skill**：不采用，因为 skill 选择必须由模型结合完整会话和可用目录判断，宿主只负责注册、目录和工具执行。

## 后果

模型可以按需获得口播初剪、通用剪辑和短视频交付的可复用规则，同时仍然只能通过当前 FreeCut 工具修改项目。内置技能目录增加三个条目，正文只在模型加载对应 skill 时进入上下文。GitHub 仓库内容可能随时间变化，后续更新需要重新检索、提炼并同步资料来源，而不是自动跟随远程仓库。

## 验证

`scripts/test-deepseek-harness-plugin.mjs` 校验内置技能数量、名称、注册结果和三个新增 skill 的可加载性；加载器仍要求每个技能存在合法 frontmatter。运行时未增加外部二进制、网络服务或新的模型调用。
