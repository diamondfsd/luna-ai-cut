# Agent Note: Packaged Harness JavaScript bundles

Status: implemented

English | [中文](2026-08-18-packaged-harness-javascript-bundles.zh.md)

## Problem

The packaged DeepSeek Harness copied the complete deployed `node_modules` tree. Most JavaScript dependencies were loaded by fixed Harness package entry points, but they remained separate files because the Cordis loader resolves `@deepseek-ai/*` plugins dynamically. The resulting runtime carried a large third-party JavaScript tree alongside the native modules that genuinely need filesystem package boundaries.

## Decision

`scripts/build-deepseek-harness-web.mjs` bundles each deployed `@deepseek-ai/*` package's main JavaScript entry back into that package's existing `lib/` directory. Other `@deepseek-ai/*` package names remain external so Cordis keeps one shared module instance and YAML plugin loading continues to resolve package names. The CLI entry is bundled separately into the deployed `lib/` directory.

The bundle stage keeps Node built-ins, native modules, native architecture packages, and browser CSS entries outside the JavaScript bundle. Generated files replace only their same-path runtime files after the destination is removed, so hard-linked `pnpm deploy` output cannot mutate the source checkout. Keeping the original `lib/` location also preserves `import.meta.url` references to workers and package assets.

After bundling, the build scans generated runtime imports and removes third-party packages that are no longer referenced. It retains the complete `@deepseek-ai/*` plugin set, detected native packages, and transitive dependencies of remaining external imports. The build reports residual optional or platform-specific imports instead of assuming that every dependency can be inlined.

## Alternatives considered

Bundling the entire Harness into one file was rejected because dynamic package loading and Cordis singleton identity require package names and shared `@deepseek-ai/*` modules to remain available. Reusing Electron's Node runtime was not part of this change because it is a separate packaging decision.

Leaving the complete `node_modules` tree in the package was rejected because it preserves the size problem this build stage is intended to reduce. Bundling browser CSS entries into the Node output was rejected because the Node bundler does not own CSS processing and those entries are consumed by the web client path.

## Consequences

The generated Harness runtime is smaller while native dependencies and dynamic plugin resolution remain available. Each package now has a small deployment-only metadata indirection and the build must keep the external-module allowlist aligned with native package boundaries. Third-party packages used by retained client, test, optional, or platform-specific runtime entries remain in the package and are reported by the build audit.
