# 会员版维护与发布流程

本文档只适用于私有会员版仓库 `diamondfsd/luna-ai-cut-member`。

## 仓库职责

| 仓库 | 用途 | 发布方式 |
| --- | --- | --- |
| `diamondfsd/luna-ai-cut` | 开源版公共代码 | GitHub Actions + GitHub Release |
| `diamondfsd/luna-ai-cut-member` | 会员版代码和私有功能 | 私有构建流程 + GitCode Release |

公共功能可以从开源仓库同步到会员仓库。会员专属代码只能提交到会员仓库，不要反向推送到开源仓库。

## 远程仓库

当前本地仓库约定使用以下远程名称：

```text
origin  git@github.com:diamondfsd/luna-ai-cut.git
member  git@gitcode.com:diamondfsd/luna-ai-cut-member.git
```

会员版代码推送时必须显式指定 `member`：

```bash
git push member HEAD:main
```

不要在不确认当前分支跟踪关系时直接运行 `git push`，避免误推送到开源仓库。

## 同步开源代码

公共功能先在开源仓库完成并推送，然后在会员仓库工作树中同步：

```bash
git fetch origin
git fetch member
git switch main
git merge origin/release-1.8.0
git push member HEAD:main
```

如果开源仓库使用的不是 `release-1.8.0`，将命令中的分支名替换成实际公共分支。发生冲突时，保留会员版专属改动，解决后再提交并推送到 `member`。

会员专属功能直接在会员仓库开发：

```bash
git switch -c feature/member-xxx
git add <文件>
git commit -m "feat: xxx"
git push member HEAD:feature/member-xxx
```

## 会员版正式发布

正式发布前检查：

- `package.json` 版本号正确。
- 会员版使用独立的 `appId` 和产品名称。
- 开源版专属配置没有被带入会员构建。
- 会员专属功能和授权校验已通过测试。
- 签名证书、私钥和授权服务密钥没有进入代码仓库。
- 发布说明文件已创建，例如 `RELEASE_NOTES_v1.8.1.md`。

当前会员发布流水线尚未完成前，tag 只代表源码发布点，不会自动产生已签名安装包。正式自动发布需要后续接入私有 CI：

```text
会员仓库 tag
  -> 构建 macOS / Windows 安装包
  -> macOS Developer ID 签名和公证
  -> Windows Authenticode 签名
  -> 生成自动更新元数据
  -> 上传 GitCode Release 或更新存储
```

发布源码版本的基本步骤：

```bash
git switch main
git pull --ff-only member main

# 修改 package.json 版本号，并创建 RELEASE_NOTES_v<版本号>.md
git add package.json RELEASE_NOTES_v<版本号>.md
git commit -m "release: v<版本号>"
git push member HEAD:main

git tag -a v<版本号> -m "member v<版本号>"
git push member v<版本号>
```

会员仓库与开源仓库分开后，可以使用相同的版本 tag，例如 `v1.8.1`。不要把会员 tag 推送到 `origin`。

## GitCode 安装包发布

会员安装包仓库和会员源码仓库建议分开：

```text
luna-ai-cut-member          私有源码
luna-ai-cut-member-release  安装包、更新清单和发布说明
```

GitCode 只负责保存和分发安装包，不负责会员资格判断。会员资格、激活和授权校验应由独立授权服务处理。

当前仓库已有的 `scripts/deploy-release.sh` 是“从开源 GitHub Release 同步到 GitCode 镜像仓库”的脚本，默认目标为 `luna-ai-cut-package-release`。它不能直接作为会员发布脚本使用，除非先修改仓库、版本和发布权限配置。

## 自动更新约定

会员直装版使用独立更新地址，例如：

```text
https://updates.example.com/member/
```

发布目录至少包含对应平台的安装包和更新元数据。客户端更新流程应为：

```text
查询更新
  -> 下载
  -> 校验签名和完整性
  -> 用户确认或自动重启安装
```

会员版安装包必须使用稳定不变的 `appId`。开源版和会员版不得共用 `appId`，否则可能互相覆盖安装目录、数据目录或更新来源。

签名密钥只能放在私有 CI 的 Secrets 或受控签名服务中。不要将证书、私钥、密码、授权服务 token 或 `deploy-release.conf` 提交到仓库。

## 版本与分支检查

推送前执行：

```bash
git status
git branch -vv
git remote -v
git log -1 --oneline
```

确认以下条件后再推送：

```text
当前代码是会员版内容
推送目标是 member
推送分支是 main 或明确的会员功能分支
没有把私钥、token、证书或本地构建产物加入提交
```

