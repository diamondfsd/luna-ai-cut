# 发版操作流程

## 概述

默认使用本地工作树编译三平台安装包，再直接上传到 GitCode。除非用户明确要求，否则不使用 GitHub Actions 构建，也不以 GitHub Release 作为产物中转站。每次发版包含版本号升级、发布说明和 GitCode Release。

应用更新统一为手动触发：启动应用不会访问更新服务，也不会自动下载或安装更新。用户需要打开顶部问号窗口，点击“检查更新”，再分别点击安装包或热更新的更新按钮。

### macOS Release 签名与公证硬性要求

`v1.8.1` 已发布到 GitCode 的 macOS ARM64 和 x64 安装包没有完成 Developer ID Application 签名和 Apple 公证，属于历史遗留包。从 `v1.8.2` 起，所有上传到 GitCode 正式 Release 的 macOS 安装包必须完成并通过以下检查：

- 使用 Developer ID Application 签名，不得使用 Ad Hoc 签名。
- 启用 hardened runtime。
- 完成 Apple notarization，并将公证票据 stapling 到最终发布产物。
- macOS ARM64 和 x64 必须分别构建、分别验证；任一架构不通过都不得上传。
- Ad Hoc 包只允许本地调试和开发验证，禁止上传到正式 GitCode Release。

发布前必须检查最终 DMG 及其中的 `.app`。以下命令在 macOS 上执行，路径按实际产物调整：

```bash
# 对 ARM64 和 x64 的每个 DMG 都执行一次
hdiutil attach "release/<版本号>/LunaAICut-Mac-<版本号>-Installer-<架构>.dmg" \
  -nobrowse -readonly -mountpoint /tmp/luna-ai-cut-release

APP_PATH="/tmp/luna-ai-cut-release/Luna AI Cut.app"
DMG_PATH="release/<版本号>/LunaAICut-Mac-<版本号>-Installer-<架构>.dmg"

codesign --verify --deep --strict --verbose=2 "$APP_PATH"
codesign --display --verbose=4 "$APP_PATH" 2>&1 | grep 'Authority=Developer ID Application'
spctl --assess --type execute --verbose=4 "$APP_PATH"
xcrun stapler validate "$APP_PATH"
xcrun stapler validate "$DMG_PATH"

hdiutil detach /tmp/luna-ai-cut-release
```

`electron-builder` 完成的公证主要作用于 `.app`。如果最终 DMG 的 `xcrun stapler validate` 提示没有票据，必须先对最终 DMG 单独提交公证并装订票据：

```bash
source scripts/apple-notarize.local
xcrun notarytool submit "$DMG_PATH" \
  --key "$APPLE_API_KEY" \
  --key-id "$APPLE_API_KEY_ID" \
  --issuer "$APPLE_API_ISSUER" \
  --wait \
  --output-format json
xcrun stapler staple "$DMG_PATH"
xcrun stapler validate "$DMG_PATH"
```

只要签名身份、公证结果或 `spctl` 检查失败，立即停止发布并重新构建；不得执行 `scripts/deploy-release.sh`。DMG 仅在完成上述最终公证装订并验证通过后才能上传。发布记录中应保留 ARM64、x64 两个产物的检查结果。

### 热更新默认发布约定

后续所有热更新默认发布一个 `universal` 平台无关的纯 JS 包，适用于 macOS ARM64、macOS x64 和 Windows x64。发布时不需要选择平台，标准命令是 `./scripts/build-hot-update.sh`；同一个正式版本线可以继续发布 `hot.1`、`hot.2` 等后续热更新。

只有明确要求平台专属包或原生模块热更新时，才使用 `--platform`、`--include-native` 或原生模块发布流程。涉及原生模块时，必须在本地准备并校验对应平台产物，不能发布不完整的通用包。

跨正式版本（例如从 `1.8.0` 到 `1.8.1`）不能依靠旧版本热更新，仍然必须发布并安装完整安装包。

## 前置条件

- `pnpm` 已安装，依赖已通过 `pnpm install --frozen-lockfile` 安装
- 当前工作树包含目标版本的代码和发布说明
- GitCode `GITCODE_TOKEN` 环境变量已设置，或已创建 `scripts/deploy-release.conf`
- 在 macOS 上构建 Windows x64 时，需要安装并验证 `cargo-xwin`；Windows 主机直接使用本机 Rust 工具链

## 构建依赖下载地址规则

构建依赖的国内镜像统一使用 GitCode Release，不要把 GitHub Release 地址直接写入客户端或本地下载逻辑。当前固定配置为：

- 仓库：`diamondfsd/luna-ai-cut-package-release`
- Release tag：`build-dependencies-v1.0.0`
- 下载地址格式：`https://gitcode.com/<owner>/<repo>/releases/download/<release-tag>/<file-name>`
- FFmpeg 示例：`https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases/download/build-dependencies-v1.0.0/ffmpeg-win32-x64.gz`
- Windows GPU 构建依赖：`ffmpeg-8.1.2-full_build-shared.7z`，本地下载会读取 `GITCODE_TOKEN` 或 `scripts/deploy-release.conf` 并携带 GitCode 私有令牌

其中 `releases/download` 是固定路径。不要使用 `.../releases/<release-tag>/<file-name>`，后者是错误的下载地址格式；也不要把 GitCode API 的 Release 查询或上传地址当作文件下载地址。

模型和其他 Release 附件沿用同一规则。下载地址必须由网页域名、仓库、Release tag 和附件文件名组成：

```text
https://gitcode.com/<owner>/<repo>/releases/download/<release-tag>/<file-name>
```

模型资源当前使用 `model-resources-v1.0.0` 作为 Release tag；manifest 修订名（如 `model-resources-v1.0.0-r4.json`）只属于附件文件名，不能替代或追加到 Release tag。API 返回的 `browser_download_url`、`api.gitcode.com` 地址和上传接口返回的临时 CDN URL 都不写入客户端。发布验证使用实际 GET/断点下载，不用 HEAD 作为唯一判断。

相关实现入口：

- `scripts/build-dependency-sources.mjs`：维护仓库、Release tag 和下载地址基址
- `scripts/copy-ffmpeg.mjs`：下载、校验并准备 FFmpeg/ffprobe
- `scripts/publish-build-dependencies.mjs`：将固定构建依赖上传并校验到上述 Release

## 版本号规则

默认发版为**补丁版本号升级**（patch version bump），即 `X.Y.Z` → `X.Y.(Z+1)`，例如 `v1.1.2` → `v1.1.3`。

> 如需小版本号（middle，`X.(Y+1).0`）或大版本号（major，`(X+1).0.0`）升级，需用户主动说明，否则默认执行 patch 升级。

## 前置注意事项

- **未提交的改动**：工作区中任何未提交的修改，直接随发布提交（`git add -A`），不需要 stash 或分离。发布后推送到目标发布分支。

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

### 5. 本地编译三平台安装包

默认在本地生成 macOS ARM64、macOS x64 和 Windows x64 安装包。产物会写入 `release/<版本号>/`：

```bash
pnpm install --frozen-lockfile
# 正式 GitCode Release 必须使用签名和公证配置构建 macOS 包
pnpm run pack:mac:official:arm64
source scripts/apple-notarize.local
pnpm run pack:mac:signed:x64
pnpm run pack:win:x64
```

`pnpm run pack:mac:arm64` 和 `pnpm run pack:mac:x64` 生成的是 Ad Hoc 调试包，只能用于本地验证，不能作为 GitCode 正式 Release 产物。

在 macOS 上首次构建 Windows x64 前，先确认交叉编译工具可用：

```bash
cargo xwin --version
```

如果命令不存在，先执行 `cargo install cargo-xwin`，再重新构建 Windows 安装包。

构建完成后，确认 `release/<版本号>/` 同时包含 `*-arm64.dmg`、`*-x64.dmg` 和 Windows `.exe` 文件，再执行下一步上传。

### 5a. macOS 签名与公证检查

按照“macOS Release 签名与公证硬性要求”逐一检查 ARM64 和 x64 的 DMG 及 `.app`。必须确认签名身份为 Developer ID Application、公证票据已装订，并且 `codesign`、`spctl`、`xcrun stapler validate` 全部成功。检查未通过时禁止进入 GitCode 上传步骤。

### 6. 推送代码

```bash
git push origin <发布分支>
```

本地构建不依赖 GitHub Actions。Git tag 可以保留在本地用于标记版本；只有用户明确要求 GitHub Actions/Release 时，才推送会触发打包 workflow 的 `v*` tag。

### 6b. 上传到 GitCode（默认路径）

上传脚本默认读取本地 `release/<版本号>/`，创建或更新 GitCode Release，并上传三平台安装包：

```bash
./scripts/deploy-release.sh v<版本号>
```

脚本不会访问 GitHub。beta/测试版不会更新稳定版 README 或公开下载页；稳定版会按原有流程同步下载地址和更新日志。脚本执行前需确保对应的 `RELEASE_NOTES_v<版本号>.md` 已存在。

只有需要复用 GitHub Release 产物时，才显式使用旧路径：

```bash
./scripts/deploy-release.sh --from-github v<版本号>
```

### 6c. Beta/测试版发布

版本号带 `-beta.N` 的安装包属于测试版，不是正式稳定版。仍使用按安装版本命名的 GitCode Release，但必须作为预发布版本管理，不更新稳定版下载入口：

```text
安装版本：1.8.0-beta.1
GitCode Release：v1.8.0-beta.1
```

安装包使用本地三平台构建和上传脚本：

```bash
./scripts/deploy-release.sh v1.8.0-beta.1
```

Beta 热更新也上传到安装版本对应的同一个 Release：

```text
热更新：1.8.0-beta.1-hot.1
GitCode Release：v1.8.0-beta.1
```

发布 beta 热更新时，使用普通构建和发布脚本：

```bash
pnpm run build:app
pnpm run publish:hot -- --version 1.8.0-beta.1-hot.1 --upload
```

客户端只根据安装版本计算 Release tag。历史的 `beta/v...`、`test-beta-v...`、`test-v...` 和 `test/...` Release 不再兼容；已安装旧版本的客户端需要先安装包含本规则的新版安装包。

`1.8.0-beta.1-hot.1` 不能安装到 `1.8.0` 或 `1.8.0-beta.2`。稳定版继续使用 `vX.Y.Z` 和 `X.Y.Z-hot.N` 规则。

## GitHub Release（仅明确要求时）

| 参数 | 说明 |
|------|------|
| `--title "v1.1.0"` | Release 标题 |
| `--notes-file FILE.md` | 从文件读取发布说明 |
| `--notes "内容"` | 直接指定发布说明 |
| `--draft` | 创建草稿（不公开发布） |
| `--prerelease` | 标记为预发布版本 |
| `--generate-notes` | 自动生成发布说明 |
| `--target main` | 指定目标分支 |

仅当用户明确要求 GitHub Actions/Release 时，才使用 `gh release` 或推送会触发打包的 `v*` tag。此路径由 `.github/workflows/package-artifacts.yml` 负责构建和挂载附件，不改变默认的本地编译上传流程。

GitHub Actions 的 macOS 自动构建只生成 Ad Hoc 包，不导入 Developer ID 证书、不执行 Apple notarization，也不需要配置 macOS 签名或公证 Secrets。GitHub Release 产物不能直接作为 GitCode 正式 Release 产物；上传 GitCode 前仍必须按本文件的 macOS 签名与公证流程重新构建并验证。

## 日常热更新发布

当只需要推送增量修复，且当前正式版发布后从未通过热更新修改原生模块时，使用本地脚本生成默认的 `universal` 纯 JS 热更新包。`dist/`、`luna-appMain.js` 和 `preload.mjs` 均为 JavaScript 热更新内容，无需重复构建三份平台包。例如产物为 `renderer-1.7.1-hot.1.zip`，客户端会从 GitCode Release 附件中使用这个通用包。

平台专属包、三平台包和原生模块热更新都属于例外流程：只有明确要求时才发布；如果版本线已经出现原生模块变更，则必须遵循“原生模块热更新”章节的流程。

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
# 默认，也是后续热更新的标准命令：通用纯 JS 包
./scripts/build-hot-update.sh

# 仅在明确要求平台专属包时使用
./scripts/build-hot-update.sh --platform darwin-arm64
```

可选平台为 `darwin-arm64`、`darwin-x64`、`win32-x64` 和 `universal`。默认且长期约定使用 `universal`；平台专属包、多平台产物和 `--include-native` 均不是默认选项，只有收到明确要求时才使用。

首次运行需确保 `GITCODE_TOKEN` 环境变量已设置，或已创建 `scripts/deploy-release.conf` 配置文件。

脚本会完成以下操作：

- 运行 `pnpm run build:app`。
- 生成并校验平台无关的单个热更新 ZIP。
- 将 ZIP 和发布说明上传到版本对应的 GitCode Release `v<安装版本>`。
- 创建并推送 `hot/v<版本号>-hot.<build号>` tag。

### 4. 推送 main

```bash
git push origin main
```

发布热更新前，在本地从对应安装版本（例如 `v1.6.5`）开始检查原生相关文件。只要该版本线任意一次热更新修改过 `luna-render-core/`、`Cargo.lock`、`scripts/build-native.mjs` 或 `electron/platform/render/lunaRenderCore.ts`，此后所有热更新都必须继续构建并发布三个平台包，保证跳过中间热更新的客户端也能获得最新原生模块。仅当整个版本线均无原生改动时，才跳过三端构建。

> 客户端不会在启动时自动检查更新。用户需要在顶部问号窗口中手动检查，并确认下载或应用更新。

## 原生模块热更新

修改 Rust 渲染核心、原生模块构建脚本或 Electron 原生桥接时，不能使用本地通用 ZIP 作为最终产物。同一版本线只要出现过一次原生热更新，后续热更新也全部按此流程发布。三个目标平台的原生模块和热更新包均在本机编译、校验并上传到 GitCode；除非用户明确要求，不使用 GitHub Actions 代替本地构建。

原生热更新不要运行 `build-hot-update.sh`，避免三平台包就绪前先发布不含原生模块的通用 ZIP。确定下一个 build 号并提交代码与发布说明后，直接推送 `main` 和 tag：

```bash
git push origin main
git tag hot/v<版本号>-hot.<build号>
git push origin hot/v<版本号>-hot.<build号>
```

只有用户明确要求 GitHub Actions 时，才触发 `Publish Hot Update` workflow。默认直接完成三平台本地构建，再执行以下本地发布步骤：

```bash
# 获取当前 tag 对应的成功运行 ID
run_id="$(gh run list --workflow publish-hot-update.yml \
  --branch hot/v<版本号>-hot.<build号> --limit 1 \
  --json databaseId --jq '.[0].databaseId')"

# 分别下载三个 artifact
native_dir="$(mktemp -d /tmp/luna-hot-native.XXXXXX)"
gh run download "$run_id" --name darwin-arm64 --dir "$native_dir/darwin-arm64"
gh run download "$run_id" --name darwin-x64 --dir "$native_dir/darwin-x64"
gh run download "$run_id" --name win32-x64 --dir "$native_dir/win32-x64"

# 本地构建页面和主进程，生成并上传三端热更新包
pnpm run build:app
node scripts/publish-hot-update.mjs \
  --version <版本号>-hot.<build号> \
  --include-native \
  --native-dir "$native_dir" \
  --upload
```

`publish-hot-update.mjs` 会优先使用环境变量，未设置时自动读取 `scripts/deploy-release.conf`。上传完成后，确认 GitCode 已包含三个带平台后缀的 ZIP、清单和发布说明，再通知用户更新。

### v1.7.0-hot.4 发布执行记录

本次变更范围以 `v1.7.0..main` 为准。该范围修改了 `luna-render-core/src/`、渲染桥接和导出参数，因此必须发布原生热更新，不能运行 `./scripts/build-hot-update.sh` 提前上传通用包。

本次用户可见内容见 `RELEASE_NOTES_v1.7.0-hot.4.md`，主要包括：

- AI 选片人物识别、人物合并、隐藏、头像和重新分析流程升级。
- 本地资源目录迁移，以及设置、项目和素材保存可靠性改进。
- 视频导出声音开关和 macOS、Windows 原生导出调整。
- 图片自然美颜算法、素材拖放与复制、下载流程改进。
- 帮助弹窗合并显示安装版与历次热更新日志。

发布命令：

```bash
pnpm test:hot-update
pnpm test:ai-selection
pnpm test:storage-migration
pnpm test:settings-storage
pnpm run build:app

git add -A
git commit -m "chore: prepare v1.7.0-hot.4"
git push origin main
git tag hot/v1.7.0-hot.4
git push origin hot/v1.7.0-hot.4
```

推送 tag 后，`Publish Hot Update` 工作流会检测到相对 `hot/v1.7.0-hot.3` 的 Rust 改动，并完成：

1. 在 macOS runner 构建 `darwin-arm64` 原生模块。
2. 在 macOS runner 交叉构建 `darwin-x64` 原生模块。
3. 在 Windows runner 构建 `win32-x64` 原生模块及 DXC 运行文件。
4. 将三个原生模块保存为 GitHub Actions artifact，不直接连接 GitCode。

本机随后下载三个 artifact，执行 `pnpm run build:app`，再用 `publish-hot-update.mjs --include-native --upload` 生成并上传三个平台 ZIP、`renderer-1.7.0-hot.4.json` 和发布说明到 GitCode 的 `v1.7.0` Release。

发布后必须确认 GitCode Release 至少新增以下文件：

```text
renderer-1.7.0-hot.4-darwin-arm64.zip
renderer-1.7.0-hot.4-darwin-x64.zip
renderer-1.7.0-hot.4-win32-x64.zip
renderer-1.7.0-hot.4.json
RELEASE_NOTES_v1.7.0-hot.4.md
```

不要为本次版本上传 `renderer-1.7.0-hot.4.zip` 通用包。客户端会按当前平台优先选择最新的三端包。

Intel Mac 由 Apple 芯片 runner 交叉编译。工作流会先下载并校验固定的 ONNX Runtime x64 构建，仅用于完成同一 Rust 包内辅助进程的链接；热更新归档仍只收集不依赖 ONNX Runtime 的 `luna-render-core.node`，不会重复下发安装包已有的辅助进程和运行库。

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
