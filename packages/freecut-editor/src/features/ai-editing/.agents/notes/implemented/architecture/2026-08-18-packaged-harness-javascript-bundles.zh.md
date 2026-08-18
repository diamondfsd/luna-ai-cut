# Agent Note: 打包 Harness 的 JavaScript bundle

Status: implemented

English | 中文

## Problem

打包 DeepSeek Harness 之前会复制完整的部署版 `node_modules`。大部分 JavaScript 依赖都由固定的 Harness 包入口加载，但由于 Cordis loader 需要动态解析 `@deepseek-ai/*` 插件，它们仍以独立文件存在。最终运行时除了确实需要文件系统包边界的原生模块外，还携带了体积很大的第三方 JavaScript 依赖树。

## Decision

`scripts/build-deepseek-harness-web.mjs` 将每个部署版 `@deepseek-ai/*` 包的主 JavaScript 入口 bundle 回该包原有的 `lib/` 目录。其他 `@deepseek-ai/*` 包名继续外置，从而保持 Cordis 只有一份共享模块实例，并继续支持 YAML 插件按包名加载。CLI 入口单独 bundle 到部署版的 `lib/` 目录。

bundle 阶段将 Node 内置模块、原生模块、原生架构包和含浏览器 CSS 的入口留在 bundle 外部。生成文件只替换同路径的运行时文件，并在复制前先删除目标文件，避免 `pnpm deploy` 生成的硬链接把改动写回源工作区。保持原有 `lib/` 位置也能保留 `import.meta.url` 对 worker 和包资源的引用。

bundle 完成后，构建过程扫描生成运行时代码的 import，并删除已经不再被引用的第三方包。完整保留 `@deepseek-ai/*` 插件集合、检测到的原生包，以及剩余外部 import 的传递依赖。对于仍有残余的可选或平台依赖，构建过程会报告而不会假设它们全部可以内联。

## Alternatives considered

拒绝将整个 Harness 合成一个文件，因为动态包加载和 Cordis 单例身份要求保留包名，并保留共享的 `@deepseek-ai/*` 模块。本次没有复用 Electron 内置 Node runtime，因为那是另一项独立的打包决策。

拒绝继续把完整 `node_modules` 放进安装包，因为这会保留本阶段需要解决的体积问题。拒绝将带浏览器 CSS 的入口 bundle 到 Node 产物，因为 Node bundler 不负责 CSS 处理，而这些入口由 Web 客户端路径消费。

## Consequences

生成的 Harness runtime 体积更小，同时保留原生依赖和动态插件解析能力。每个包多了一层仅存在于部署产物中的元数据路径，构建过程也必须让外置模块白名单与原生包边界保持一致。被保留的客户端、测试、可选或平台运行时入口所使用的第三方包仍会留在产物中，并由构建审计报告。
