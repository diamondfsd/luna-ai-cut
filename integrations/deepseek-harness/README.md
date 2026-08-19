# DeepSeek Harness 适配层

这个目录只负责把 DeepSeek Harness 的 `edit.run_script` 接到 Luna JS SDK：

```text
Harness -> plugin -> runEditScript -> Luna JS SDK -> capability endpoint -> Electron host
```

它不实现时间线、媒体、渲染或 AI 业务逻辑，也不根据用户或模型文案推断意图。具体能力由宿主通过结构化 capability name 和参数提供。

## 文件职责

- `sdk-client.mjs`：通用 Luna JS SDK 的 transport 和命名空间方法生成器。
- `config.mjs`：统一解析 plugin 配置及 SDK/旧版环境变量。
- `script-runtime.mjs`：在独立 Node 进程执行 ESM 脚本，并向脚本注入 Luna SDK。
- `plugin.mjs`：Harness plugin，注册唯一编辑入口 `edit.run_script`；内置技能注册是可关闭的资源兼容选项，不参与能力执行。

旧路径仍然有效：

- `scripts/deepseek-harness-script-runtime.mjs`
- `scripts/deepseek-harness-freecut-plugin.mjs`

这两个文件只做 re-export，便于现有 Electron、构建脚本和测试逐步切换到新目录。

## 配置

plugin 配置优先，其次读取环境变量。新名称和旧名称都支持：

| 配置 | 新环境变量 | 兼容环境变量 |
|---|---|---|
| endpoint | `LUNA_SDK_ENDPOINT` | `LUNA_ASSISTANT_CAPABILITY_ENDPOINT` / `LUNA_SCRIPT_ENDPOINT` |
| token | `LUNA_SDK_TOKEN` | `LUNA_ASSISTANT_CAPABILITY_TOKEN` / `LUNA_SCRIPT_TOKEN` |
| projectId | `LUNA_SDK_PROJECT_ID` | `LUNA_ASSISTANT_PROJECT_ID` / `LUNA_SCRIPT_PROJECT_ID` |
| sessionId | `LUNA_SDK_SESSION_ID` | `LUNA_ASSISTANT_SESSION_ID` / `LUNA_SCRIPT_SESSION_ID` |
| cwd | `LUNA_SDK_CWD` | `LUNA_ASSISTANT_CWD` / `LUNA_SCRIPT_CWD` |
| model | `LUNA_SDK_MODEL` | `LUNA_ASSISTANT_MODEL` / `LUNA_SCRIPT_MODEL` / `DEEPSEEK_MODEL` |

`endpoint`、`token`、`projectId` 和 `cwd` 始终是必需的。`model` 和 `sessionId` 只作为宿主会话上下文透传，不参与 SDK 能力执行。脚本 worker 会同时收到新旧 SDK 环境变量，确保旧脚本行为不变。

## Electron 接线要求

Electron 后续只需要在启动 Harness plugin 时提供同一份配置：

```js
{
  endpoint,
  token,
  projectId,
  cwd,
  model,
}
```

其中 `endpoint` 是宿主 capability HTTP 服务地址，`token` 与宿主校验使用同一值，`projectId` 是当前编辑项目，`cwd` 是 Harness workspace，`model` 和 `sessionId` 是可选会话上下文。Electron 不需要把 FreeCut action 或 Store 暴露给 Harness；只需在 endpoint 内注册通用 Luna SDK capability provider。

如果暂时只能通过环境变量接线，请至少设置：

```text
LUNA_ASSISTANT_CAPABILITY_ENDPOINT
LUNA_ASSISTANT_CAPABILITY_TOKEN
LUNA_ASSISTANT_PROJECT_ID
LUNA_ASSISTANT_CWD
LUNA_ASSISTANT_MODEL
```

Harness 的 profile/plugin 资源需要能加载 `integrations/deepseek-harness/plugin.mjs`。生产构建还需要把该目录和两个兼容脚本一起纳入资源；本次适配层没有修改 Electron 或构建配置。

## 测试

```bash
node integrations/deepseek-harness/test-adapter.mjs
node scripts/test-deepseek-harness-script-runtime.mjs
node scripts/test-deepseek-harness-vitest.mjs
```

`scripts/test-deepseek-harness-plugin.mjs` 还会读取内置技能源文件；如果技能构建产物不存在，它会在资源加载阶段失败，这不代表 SDK transport 或脚本运行时失败。
