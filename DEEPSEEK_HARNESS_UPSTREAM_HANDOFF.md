# DeepSeek Harness 上游更新交接

更新时间：2026-08-14

## 当前问题

Luna AI Cut 目前接入的 DeepSeek Harness 是从官方仓库复制到本项目的源码副本，官方仓库地址是：

https://github.com/deepseek-ai/deepseek-harness

当前副本没有作为 Git submodule、Git subtree 或 npm 依赖接入，因此本项目 Git 历史不会自动记录它对应的上游提交，也没有现成的 `git pull` 更新方式。

后续如果直接把官方仓库内容覆盖到本地目录，会覆盖 FreeCut 为集成 Harness 增加的插件、Electron 通信、脚本能力通道和构建适配代码；如果只更新少数文件，又容易漏掉上游新增、删除或依赖变化。

## 当前代码位置

Harness 源码副本位于：

```text
packages/freecut-editor/src/features/ai-editing/
```

主要集成入口：

| 内容 | 文件 |
| --- | --- |
| 构建 Harness Web runtime | `scripts/build-deepseek-harness-web.mjs` |
| FreeCut 剪辑脚本插件 | `scripts/deepseek-harness-freecut-plugin.mjs` |
| 上游同步配置 | `deepseek-harness.upstream.json` |
| 上游三方同步 | `scripts/update-deepseek-harness.mjs` |
| Electron 主进程服务 | `electron/deepseekHarnessService.ts` |
| Electron 启动与 IPC | `electron/deepseekHarnessService.ts`、`electron/ipcDeepSeekHarness.ts` |
| Renderer 端面板 | `packages/freecut-editor/src/features/editor/components/deepseek-harness-*.tsx` |
| FreeCut 剪辑能力适配器 | `packages/freecut-editor/src/features/project-source/` |

构建时会执行：

```bash
pnpm run build:harness-runtime
```

该命令从本地副本生成 `dist/deepseek-harness/`，不是从网络下载官方 Harness。

## 本地改动情况

当前副本不是纯粹的官方快照。最近的集成提交包括：

- 删除原有 FreeCut 自己维护的 AI Agent loop 和相关工具实现。
- 增加 DeepSeek Harness 的 Electron 启动、IPC 和生命周期管理，并复用 Harness 原生设置页。
- 增加 `luna-freecut-script-editing` 插件，把脚本 SDK 能力请求转发给 FreeCut 宿主。
- 增加 Harness Web runtime 的打包适配。
- 对官方 Harness 的提示词、工具、会话及页面行为做过本地调整。
- 对 vendored Cordis 等依赖做过本地重命名、构建和运行时适配；这些改动的记录在 `packages/freecut-editor/src/features/ai-editing/vendor/README.md`。

因此，更新时不能使用“删除目录后重新复制”的方式。

## 已确认信息

- 主仓库当前 remote 是 Luna AI Cut 自己的 `origin`，不是 DeepSeek Harness 上游。
- Harness 副本目录内部没有独立 `.git` 仓库。
- 上游默认分支为 `master`。
- 本次排查读取到的上游 HEAD 为 `47f943859bef60e4160492346772ded9b24f765a`。实际开发时仍应以更新命令执行时从远端读取的提交为准。
- 当前项目已有 `build:harness-runtime` 和 `update:deepseek-harness`。同步命令使用临时 Git 仓库，不在 Harness 目录内创建第二个 Git 仓库。

## 推荐的更新方案

新增一个专用更新脚本和一个固定配置文件，例如：

```text
scripts/update-deepseek-harness.mjs
deepseek-harness.upstream.json
```

已实现命令：

```bash
pnpm update:deepseek-harness
```

命令采用“上游基线 + 本地改动 + 新上游”的三方合并流程，而不是覆盖文件：

1. 读取固定的上游地址、分支和上次同步提交。
2. 检查 Harness 目录是否有未提交改动；有改动时直接停止，避免破坏开发中的修改。
3. 在临时目录 fetch 上游，并建立新的上游工作树。
4. 以“上次同步的上游快照”为共同基线，把上游更新和 FreeCut 本地改动进行三方合并。
5. 没有冲突时写回 Harness 目录；有冲突时停止并报告冲突文件，不自动猜测解决方案。
6. 重新应用确定性的本地适配步骤，例如 `@deepseek-ai` 重命名、构建配置和本地 vendored patch；同步会保留嵌套 `.gitignore` 忽略但仍属于源码的文档，并排除依赖和构建目录。
7. 在临时树更新 Harness lockfile；默认模式写回后执行依赖安装和 `pnpm run build:app`，任一步失败都会恢复原快照。
8. 验证通过后更新同步提交记录；命令不会自动暂存或提交文件。

建议同时提供检查模式：

```bash
pnpm update:deepseek-harness -- --check
pnpm update:deepseek-harness -- --dry-run
```

`--check` 会检查当前 Harness 工作区是否干净，并在临时树验证上游合并和本地适配；`--dry-run` 还会展示准备写回的文件列表。两个命令都不修改工作树。

## 首次接入更新命令时的注意事项

当前 Git 历史没有记录“复制这份代码时对应的官方 commit”。首次接入时已确认并记录真实的上游基线 `47f943859bef60e4160492346772ded9b24f765a`，配置文件中的 `syncedCommit` 保存这个可恢复的 Git 对象。

不能直接把当前本地目录当作官方基线，原因是当前目录已经混入 FreeCut 的本地改动。否则第一次更新时无法区分：

- 官方 Harness 已经发生的变化；
- FreeCut 有意保留的本地修改；
- 复制时就存在的差异。

如果未来发现该基线与实际复制来源不一致，不得直接运行更新；应先人工导入正确的上游快照、重新确认本地差异，再修改 `syncedCommit`。

## 更新后的最小验证

同步成功后至少执行：

```bash
pnpm install
pnpm run build:app
pnpm run typecheck:freecut
pnpm run lint
```

涉及 Harness 会话、工具结果回传、取消、配置重载或 Electron 生命周期时，还应执行对应的 Playwright Electron 用例。验证重点是：

- Harness 能正常启动并加载 Web runtime。
- 用户消息原样传递给模型。
- FreeCut 工具结果会返回 Harness，由模型决定下一步。
- 工具成功后宿主不会根据文案自行宣告任务完成。
- FreeCut 插件不暴露项目文件写入能力；剪辑编辑统一经过脚本 SDK 的结构化 `timeline.*` 能力，结果仍必须回传 Harness，由模型决定下一步。
- 上游依赖更新没有破坏生产包中的 `resources/deepseek-harness/`。

## 交接结论

当前已建立可追踪、可回滚、能发现冲突的上游同步机制。后续官方 Harness 更新统一通过 `pnpm update:deepseek-harness -- --dry-run` 预演，再运行默认命令；禁止直接覆盖 `packages/freecut-editor/src/features/ai-editing/`。
