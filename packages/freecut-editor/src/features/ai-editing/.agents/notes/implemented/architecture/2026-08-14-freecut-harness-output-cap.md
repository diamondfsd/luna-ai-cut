# Agent Note: FreeCut Harness output cap is host-configured

Status: implemented

English | [中文](2026-08-14-freecut-harness-output-cap.zh.md)

## Problem

The DeepSeek adapter can retain a provider default above the official DeepSeek API `max_tokens` limit, so an embedded FreeCut session can fail before the first model response.

## Decision

The FreeCut host owns a persisted `maxOutputTokens` setting for its embedded Harness connection. The editor's connection dialog validates values from 1 through 131072, and old configuration files receive 131072 when the field is absent.

When the host prepares the Harness home, it writes the selected value as both the `llm-deepseek` provider default and the configured model's `maxTokens`. Saving the connection stops the current Web runtime, and the value participates in runtime identity so a later start uses the selected cap.

## Consequences

- The connection dialog exposes the output cap beside the endpoint, model, context length, and API key.
- Invalid values are rejected at both the renderer form and the Electron configuration service before Harness starts.
- OpenAI-compatible endpoints used through this embedded DeepSeek route remain limited to the official DeepSeek maximum.

## Alternatives considered

**Keep the adapter default.** Rejected because the shipped default can serialize `256000`, which the DeepSeek API rejects.

**Write the cap only on the provider.** Rejected because an explicit model catalog entry can override the provider default.

**Allow values above 131072 for compatible gateways.** Rejected because this embedded route targets the official DeepSeek API and must not emit requests that its documented endpoint rejects.

## Testing

`pnpm run build:app` passes, and the focused `llm-deepseek` adapter and dynamic configuration suites pass with 84 tests.
