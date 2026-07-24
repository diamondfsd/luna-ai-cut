# 发版操作流程

## 概述

使用 `gh` CLI 执行标准发版流程。每次发版包含版本号升级、发布说明、Git tag 和 GitHub Release。

## 前置条件

- `gh` CLI 已安装并登录 (`gh auth status`)
- 当前分支为 `main`
- 构建 CI 通过 GitHub Actions 自动触发

## 版本号规则

默认发版为**补丁版本号升级**（patch version bump），即 `X.Y.Z` → `X.Y.(Z+1)`，例如 `v1.1.2` → `v1.1.3`。

> 如需小版本号（middle，`X.(Y+1).0`）或大版本号（major，`(X+1).0.0`）升级，需用户主动说明，否则默认执行 patch 升级。

## 前置注意事项

- **未提交的改动**：工作区中任何未提交的修改，直接随发布提交（`git add -A`），不需要 stash 或分离。发布后推送到 main。

## 操作步骤

### 1. 提交所有变更 + 升级版本号

先提交所有未推送的改动（包括工作区未暂存的），再升级版本号：

```bash
# 添加所有未提交的改动（工作区 + 暂存区）
git add -A

# 升级版本号（小版本号升级，X.Y.Z → X.(Y+1).0）
npm version minor

# 查看生成的版本 tag
git describe --tags --abbrev=0
```

> `npm version minor` 会自动修改 `package.json` 的版本号并创建 Git commit 和 tag。
> 如需 patch 或 major 升级需特别说明。

### 2. 创建发布说明

创建 `RELEASE_NOTES_v<版本号>.md`，按以下分类整理变更：

- 新功能
- Bug 修复
- UI 变化
- 其他

### 3. 补充发布说明到上一步的 commit

```bash
# 将发布说明添加到上一个 commit（即 npm version 生成的 commit）
git add RELEASE_NOTES_v<新版本号>.md
git commit --amend --no-edit
```

### 4. 更新 tag 指向新的 commit

```bash
git tag -f v<新版本号>
```

### 5. 推送 main 和 tag

```bash
git push origin main
git push origin v<新版本号>
```

> **必须先推送 main，再推送 tag**，否则 CI 触发时 main 上还没有 release notes commit。
> 推送 `v*` tag 会自动触发 GitHub Actions CI 构建打包。

### 6. 创建 GitHub Release（自动挂载构建产物）

```bash
# 使用 gh 创建 release，发布说明从 .md 文件读取
gh release create v<新版本号> \
  --title "v<新版本号>" \
  --notes-file RELEASE_NOTES_v<新版本号>.md
```

> ⚡ **产物自动上传**：推送 `v*` tag 后，CI 会自动构建 macOS DMG 和 Windows NSIS 安装包，并在构建完成后通过 `softprops/action-gh-release` 将产物自动挂载到 Release 页面附件中，无需手动上传。
>
> 手动触发 `workflow_dispatch` 时不会上传到 Release（仅 tag 推送触发）。

### 6b. 发布到国内资源（GitCode）

GitHub Release 创建完成后，需要再执行部署脚本，从 GitHub Release 下载构建产物并上传到 GitCode 国内镜像仓库，方便国内用户高速下载：

```bash
# 运行部署脚本（从 GitHub 下载产物 → 上传到 GitCode）
./scripts/deploy-release.sh v<版本号>
```

部署脚本会同步更新官网下载地址和更新日志，并提交、推送 Landing 页面变更。脚本执行前需确保对应的 `RELEASE_NOTES_v<版本号>.md` 已存在。

> 前置条件：
> - `gh` CLI 已安装并登录 (`gh auth status`)
> - `GITCODE_TOKEN` 环境变量已设置，或已创建 `scripts/deploy-release.conf` 配置文件

## gh release 常用参数

| 参数 | 说明 |
|------|------|
| `--title "v1.1.0"` | Release 标题 |
| `--notes-file FILE.md` | 从文件读取发布说明 |
| `--notes "内容"` | 直接指定发布说明 |
| `--draft` | 创建草稿（不公开发布） |
| `--prerelease` | 标记为预发布版本 |
| `--generate-notes` | 自动生成发布说明 |
| `--target main` | 指定目标分支 |

> 每次推送 `v*` tag 到 GitHub 时，`.github/workflows/package-artifacts.yml` 会自动触发 CI 构建，生成 macOS DMG 和 Windows NSIS 安装包。

## 日常热更新发布

当只需要推送增量修复（不涉及版本号变更、Electron 升级或原生模块变更）时，使用本地脚本生成一份平台无关的通用热更新包。`dist/`、`luna-appMain.js` 和 `preload.mjs` 均为平台无关的 JS，无需让 GitHub Actions 重复构建三份。

### 1. 创建热更新发布说明

创建 `RELEASE_NOTES_v<版本号>-hot.<build号>.md`，按以下分类整理变更：

- Bug 修复
- 改进
- 其他（如需）

发布说明文件同时充当变更记录，用户可通过查看 Release 附件中的说明了解热更新内容。

示例：

```markdown
# v1.3.2-hot.4 — 热更新发布说明

## Bug 修复

- **修复 xxx 问题**：xxx

## 改进

- **xxx**：xxx
```

### 2. 提交代码和发布说明

```bash
git add -A
git commit -m "fix: xxx"
```

### 3. 构建并上传热更新包

```bash
# 自动取下一个 build 号，构建并上传到 GitCode Release
./scripts/build-hot-update.sh
```

首次运行需确保 `GITCODE_TOKEN` 环境变量已设置，或已创建 `scripts/deploy-release.conf` 配置文件。

脚本会完成以下操作：

- 运行 `pnpm run build:app`。
- 生成并校验通用热更新 ZIP。
- 上传 ZIP 和发布说明到 GitCode Release。
- 创建并推送 `hot/v<版本号>-hot.<build号>` tag。

### 4. 推送 main

```bash
git push origin main
```

推送热更新 tag 后，GitHub Actions 会比较上一个热更新 tag。没有修改 `luna-render-core/`、`Cargo.lock`、`scripts/build-native.mjs` 或 `electron/lunaRenderCore.ts` 时，只执行变更检测，不再构建或上传平台包。

> 客户端每次启动会自动检查热更新（2 秒后），发现新版本后提示用户「立即更新」→ 下载 ~1.4MB → 重启生效。

## 原生模块热更新

修改 Rust 渲染核心、原生模块构建脚本或 Electron 原生桥接时，不能使用本地通用 ZIP 作为最终产物。推送 `hot/v*` tag 后，GitHub Actions 会构建 macOS ARM64、macOS x64 和 Windows x64 三个平台的原生模块与热更新包，并上传到 GitCode。

原生热更新不要运行 `build-hot-update.sh`，避免三平台包就绪前先发布不含原生模块的通用 ZIP。确定下一个 build 号并提交代码与发布说明后，直接推送 `main` 和 tag：

```bash
git push origin main
git tag hot/v<版本号>-hot.<build号>
git push origin hot/v<版本号>-hot.<build号>
```

手动触发 `Publish Hot Update` workflow 也始终按原生热更新处理。原生热更新必须等待该 workflow 的三平台任务全部成功，并确认 GitCode 已包含三个带平台后缀的 ZIP、清单和发布说明后，再通知用户更新。

## 旧版发布说明归档

当根目录下积累较多 `RELEASE_NOTES_*.md` 文件时，可以将其归档到 `old-release-log/` 目录下：

```bash
# 保留当前版本的发布说明在根目录，其余移至 old-release-log/
mv RELEASE_NOTES_v1.*.md old-release-log/
mv RELEASE_NOTES_v2.0.*.md old-release-log/  # （不含当前最新版本）
```

> 应用发布说明对话框（`release-notes:list`）会同时扫描根目录和 `old-release-log/` 目录，归档后用户仍可查看历史发布记录。
> 构建打包时两个目录下的发布说明文件均会被包含在 `extraResources` 中。

## 查看热更新发布记录

热更新发布说明文件以 `RELEASE_NOTES_v<版本号>-hot.<build号>.md` 命名，与正式版发布说明放在同一目录下。GitCode Release 的附件中也会同步上传最新的发布说明。
