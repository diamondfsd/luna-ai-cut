# Agent Note: FreeCut Harness output cap is host-configured

Status: implemented

[English](2026-08-14-freecut-harness-output-cap.md) | 中文

## Problem

DeepSeek 适配器可能保留高于官方 DeepSeek API `max_tokens` 上限的 provider 默认值，使嵌入 FreeCut 的会话在收到首个模型回复之前就失败。

## Decision

FreeCut 宿主持有嵌入式 Harness 连接的持久化 `maxOutputTokens` 设置。编辑器连接设置弹窗将值校验为 1 到 131072；旧配置文件缺少该字段时使用 131072。

宿主准备 Harness home 时，会把用户选择的值同时写入 `llm-deepseek` provider 默认值和已配置模型的 `maxTokens`。保存连接配置会停止当前 Web runtime，且该值参与 runtime 标识，因此下次启动会使用新的上限。

## Consequences

- 连接设置弹窗在服务地址、模型、记忆长度和 API Key 旁显示输出上限。
- 渲染层表单和 Electron 配置服务都会在 Harness 启动前拒绝非法值。
- 通过这个嵌入式 DeepSeek 路由使用的 OpenAI 兼容 endpoint 也会受官方 DeepSeek 最大值限制。

## Alternatives considered

**保留适配器默认值。** 否决，因为当前交付的默认值可能序列化为 `256000`，会被 DeepSeek API 拒绝。

**只在 provider 层写入上限。** 否决，因为显式的模型目录项可能覆盖 provider 默认值。

**允许兼容网关使用超过 131072 的值。** 否决，因为这个嵌入式路由面向官方 DeepSeek API，不能发送其文档明确拒绝的请求。

## Testing

`pnpm run build:app` 已通过，定向 `llm-deepseek` 适配器和动态配置测试共 84 个用例已通过。
