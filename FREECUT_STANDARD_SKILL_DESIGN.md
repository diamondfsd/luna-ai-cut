# FreeCut 标准剪辑技能设计

## 结论

`docs/github-editing-skills` 是公开 GitHub 资料的研究快照，不是 DeepSeek Harness 的运行时技能目录。它适合提供剪辑原则、工作流案例和来源信息，不应直接复制到 `skills/`，也不应让 Harness 通过文件名或用户文案选择工作流。

本次将确认过的通用原则整理为一组 FreeCut 自有技能：

```text
packages/freecut-editor/src/features/ai-editing/skills/built-in/
├── master/SKILL.md
├── workflows/luna-editing-standard/SKILL.md
├── workflows/luna-rough-cut/SKILL.md
├── techniques/luna-story-continuity/SKILL.md
├── techniques/luna-rhythm-pacing/SKILL.md
├── techniques/luna-audio-editing/SKILL.md
├── techniques/luna-caption-layout/SKILL.md
├── techniques/luna-polish-delivery/SKILL.md
└── shared/*.md
```

当前共有 8 个内置技能：`luna-editing-master` 负责总控，`luna-editing-standard` 负责通用工作流，另外 6 个技能分别负责粗剪、连续性、节奏、声音、字幕和精修交付。它们按任务由模型组合使用，`shared/*.md` 继续承载所有技能共同需要的技术契约。

## 对研究资料的解读

### 可以迁移的内容

- OpenShot、Kdenlive 和 narrative-film-direction 资料中的结构优先、连续性、动作衔接、视线方向、J/L-cut、声音先于效果等原则。
- ShotPilot 的“证据 -> 选择 -> 复核”决策方式，但只保留判断框架，不固化它的项目阈值。
- AIEV 的转录优先、剪辑后时间映射、字幕不重叠、渲染前检查等可验证流程。
- VideoDB 资料中的 `ingest -> understand -> act` 分层思想，映射到 FreeCut 后就是“读取项目和素材 -> 获取分析证据 -> 通过 Luna SDK 执行”。

### 不直接迁移的内容

- 上游 `SKILL.md` 的原文、特定项目命令、云服务接口、CLI 安装步骤和平台专属参数。
- 没有经过 FreeCut 验证的固定时长、音量、缩放幅度、字幕字号、转场阈值和风格参数。
- 上游仓库的 Agent 意图分类、自动确认或自动收尾逻辑。模型应结合完整会话判断，Harness 只提供能力、执行结构化调用并回传结果。
- 许可证文件本身不属于运行时技能正文；来源、提交号和许可信息继续保留在快照 README 与调研记录中。

## 与 DeepSeek Harness 的接入关系

当前适配链路如下：

```text
Markdown SKILL.md
  -> scripts/deepseek-harness-built-in-skills.mjs
  -> ctx.skills.register(...)
  -> Harness skill catalog
  -> 模型调用 skill 工具加载正文
  -> edit.run_script
  -> Luna SDK capability endpoint
```

`scripts/build-deepseek-harness-web.mjs` 会把整个内置技能目录复制到 `dist/deepseek-harness/skills/built-in`，加载器在开发树和打包树之间选择资源。因此新增一个目录内的 `SKILL.md` 就会自动进入 Harness；不需要把技能名称追加到插件代码，也不需要修改 Harness 的 `skill` 注册表、系统提示词或 agent loop。

Harness 文件系统提供方支持 `.dsh/skills`、`.agents/skills`、自定义目录和 bundled root，但 FreeCut 当前使用的是适配层显式注册的 bundled runtime skill。这是产品内置剪辑技能的正确归属；不要把产品技能放到用户个人 skill 根目录，也不要依赖用户工作区的相对路径。

需要区分两个目录协议：Harness 原生 filesystem provider 发现的是 `<skill-root>/<name>/SKILL.md`，只扫描 skill root 的直接子目录；当前 FreeCut 的 `deepseek-harness-built-in-skills.mjs` 是产品适配层，自行递归发现 `master/`、`workflows/`、`techniques/` 和 `styles/` 下的 `SKILL.md`。因此本次使用现有的递归目录约定以保持产品发布链路稳定；如果未来切换到原生 filesystem provider，应先扁平化技能根目录或增加明确的 provider 适配，不要直接复用现有目录并假设它会被发现。

## 技能正文的标准形态

每个 FreeCut 内置技能只承担四类内容：

1. 何时适用，以及它补充总控技能的哪一部分。
2. 模型需要结合素材证据判断的剪辑原则。
3. 允许使用的 `luna.*` 能力和必须遵守的共享契约。
4. 操作后的结构化复核证据和不能声称已完成的情况。

SDK 参数、轨道层级、异步状态、关联音频删除和静音语义只在 `shared/editing-contract.md` 与 `shared/luna-sdk.md` 维护，避免每个场景技能各自定义一套协议。

## 验证方式

技能资源验证应覆盖以下事实：

- `SKILL.md` 有有效的 `name` 和 `description`，名称唯一且符合 kebab-case。
- 加载器能发现 `luna-editing-standard`，注册来源为 bundled/provider 为 FreeCut 内置 provider。
- 运行时加载的技能正文包含证据优先、异步任务等待、轨道/时间线复核和 `edit.run_script` 约束。
- 没有新增根据用户输入、模型回复、工具名称或业务关键词改变意图、工具策略、停止或完成状态的逻辑。
- 构建时技能正文被复制进打包 Harness；日常验证优先运行资源注册测试，不因 Markdown 改动触发完整应用打包。

推荐检查：

```bash
node scripts/test-deepseek-harness-plugin.mjs
python3 /Users/REDACTED/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  packages/freecut-editor/src/features/ai-editing/skills/built-in/workflows/luna-editing-standard
```

第三方资料更新时，先更新 `docs/github-editing-skills/README.md` 中的固定提交号和来源，再重新审阅原则；不要让运行时技能隐式依赖网络或上游仓库可用性。
