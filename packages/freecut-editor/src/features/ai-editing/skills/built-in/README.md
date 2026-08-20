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

技能只描述剪辑判断和操作规则，实际编辑必须通过 `edit.run_script` 中的 `luna.*` SDK 完成。
