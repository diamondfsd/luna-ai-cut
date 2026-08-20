# Luna AI Cut 内置技能

本目录是 AI 剪辑技能的唯一提示词资源目录。

- 每个包含 `SKILL.md` 的目录会自动注册为一个 Harness skill。
- `shared/*.md` 是所有技能可复用的剪辑契约，由加载器合并到总控技能和 SDK 系统提示词。
- 新增技能或规则只需要新增/修改 Markdown，不需要修改 Harness 插件的技能清单代码。
- `SKILL.md` 必须包含 YAML frontmatter：`name` 和 `description`。

目录约定：

```text
built-in/
├── master/SKILL.md
├── styles/<style-name>/SKILL.md
├── techniques/<technique-name>/SKILL.md
├── workflows/<workflow-name>/SKILL.md
└── shared/*.md
```

当前标准工作流是 `workflows/luna-editing-standard/SKILL.md`。它从研究快照中提炼通用真人剪辑原则，不直接复制第三方技能正文；具体来源和迁移说明见 `docs/github-editing-skills/README.md` 与根目录 `FREECUT_STANDARD_SKILL_DESIGN.md`。

当前通用工作流和专项技能：

- `workflows/luna-rough-cut/SKILL.md`：转录优先粗剪。
- `techniques/luna-story-continuity/SKILL.md`：镜头选择和连续性。
- `techniques/luna-rhythm-pacing/SKILL.md`：节奏和蒙太奇。
- `techniques/luna-audio-editing/SKILL.md`：对白、音乐和音效。
- `techniques/luna-caption-layout/SKILL.md`：字幕时间和版式。
- `techniques/luna-polish-delivery/SKILL.md`：画面精修和交付复核。
- `styles/luna-wong-kar-wai/SKILL.md`：王家卫式都市孤独、错过关系、碎片时间和原创霓虹情绪剪辑。

技能只描述剪辑判断和操作规则，实际编辑必须通过 `edit.run_script` 中的 `luna.*` SDK 完成。
