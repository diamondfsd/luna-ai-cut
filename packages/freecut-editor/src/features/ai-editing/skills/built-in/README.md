# LunaAiCut 内置剪辑技能

这里存放 LunaAiCut AI 剪辑功能的内置提示词技能。构建 Harness 运行时时，`scripts/deepseek-harness-built-in-skills.mjs` 会读取这些文件，FreeCut 插件通过 `ctx.skills.register()` 注册它们；模型随后通过 Harness 自带的 `skill` 工具按需加载完整提示词。

## 目录结构

```text
built-in/
├── README.md
├── master/
│   └── SKILL.md                  # AI 剪辑大师：总控 Agent
├── shared/
│   ├── creative-brief.md         # 创作需求理解与结构化简报
│   ├── editing-contract.md       # 素材证据、时间轴工具和记忆边界
│   └── research-sources.md        # 剪映、Adobe 与开源手册的资料来源和使用边界
├── styles/
│   ├── cinematic-documentary/SKILL.md
│   ├── emotional-montage/SKILL.md
│   ├── family-documentary/SKILL.md
│   ├── fast-beat/SKILL.md
│   ├── talking-head/SKILL.md
│   ├── luna-style-talking-head-short/SKILL.md
│   ├── travel-vlog/SKILL.md
│   ├── luna-style-social-short/SKILL.md
│   ├── luna-style-commercial-product/SKILL.md
│   ├── luna-style-music-video/SKILL.md
│   ├── luna-style-news-knowledge/SKILL.md
│   ├── luna-style-ambient-cinematic/SKILL.md
│   └── luna-style-sports-action/SKILL.md
├── techniques/
│   ├── luna-technique-story-structure/SKILL.md
│   ├── luna-technique-cutting-rhythm/SKILL.md
│   ├── luna-technique-audio-design/SKILL.md
│   ├── luna-technique-color-look/SKILL.md
│   ├── luna-technique-motion-graphics/SKILL.md
│   ├── luna-technique-retiming-transitions/SKILL.md
│   └── luna-technique-editing-playbook/SKILL.md
└── workflows/
    ├── luna-workflow-capcut/SKILL.md
    ├── luna-workflow-premiere/SKILL.md
    ├── luna-workflow-after-effects/SKILL.md
    └── luna-workflow-short-form-production/SKILL.md
```

## 组合方式

运行时按下面顺序组装提示词：

1. `master/SKILL.md` 作为总控技能。
2. `shared/creative-brief.md`、`shared/editing-contract.md` 和 `shared/research-sources.md` 在加载大师技能时合并进去。
3. 根据主 Agent 的判断，通过技能工具加载一个或多个风格、技巧或软件工作流技能。
4. 用户本轮要求、项目 `AGENTS.md` 和用户记忆继续作为外部上下文传入，不写进风格文件。

风格技能不是独立的聊天 Agent，也不是一套新的时间轴工具。它们只负责描述剪辑策略：镜头如何选择、故事如何组织、节奏如何变化、声音和字幕如何处理。真正的工具调用由 `luna-editing-master` 统一决定。

## 当前可用工具范围

技能注册不会创建新的时间轴工具。大师技能使用 FreeCut 插件已经注册的工具；技能可以调用已注册的 `luna.audio.startSpeech` 和 `luna.audio.startMusic` 提交音频任务，并使用 `luna.audio.getTask` 轮询到 `completed` 后取得 `mediaId`；是否将结果放入时间轴仍由模型结合完整会话判断。

提示词按当前项目已有工具设计：

- 读取素材：`luna.media.list`、`luna.media.read`、`luna.media.analyze`、`luna.media.getAnalysisTask`、`luna.media.searchTranscript`
- 读取项目：`luna.project.inspect`、`luna.timeline.inspectContext`
- 修改项目：`luna.project.setCanvas`、`luna.timeline.addMedia`、`luna.timeline.addMediaBatch`、`luna.timeline.trim`、`luna.timeline.split`、`luna.timeline.move`、`luna.timeline.remove`
- 修改画面和声音：`luna.timeline.setProperties`、`luna.timeline.setTransform`、`luna.timeline.setAudio`、`luna.timeline.addKeyframe`
- 文字、HTML 图层和转场：`luna.timeline.addText`、`luna.timeline.addTextBatch`、`luna.timeline.addHtml`、`luna.timeline.listTransitions`、`luna.timeline.addTransition`、`luna.timeline.addTransitionBatch`
- 长期偏好：`luna.memory.read`、`luna.memory.search`、`luna.memory.update`、`luna.memory.remove`

当前没有独立的音乐节拍分析、人物身份识别或语义检索工具。遇到这些需求时，主 Agent 必须诚实说明当前证据或工具不足；风格提示词不能伪造不存在的能力。

## 设计原则

- 用户原文必须原样传给模型，宿主不得用关键词判断用户意图。
- 风格由模型结合完整对话、素材证据、项目规则和记忆选择，宿主不负责“猜风格”。
- 风格默认值可以被本轮用户要求覆盖。
- 没有素材证据时，不得声称看到了人物、场景、情绪或镜头。
- 工具结果必须返回模型，由模型决定下一步。
- 每个风格都必须允许人工接管时间轴，不能把风格变成不可编辑的黑盒模板。
