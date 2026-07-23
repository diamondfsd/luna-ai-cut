# v1.3.2-hot.13 — 热更新发布说明

## Bug 修复

- **修复版本更新检测**：不再依赖 GitCode 有 bug 的 `/releases/latest` 接口，改为遍历 release 列表寻找最新版本，确保能正确检测到 v1.3.3
