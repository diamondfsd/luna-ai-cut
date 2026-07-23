#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# deploy-release.sh — 从 GitHub Release 下载产物并上传到 GitCode
#
# 用法:
#   ./scripts/deploy-release.sh                 # 自动取 package.json 版本，下载 + 上传
#   ./scripts/deploy-release.sh v1.3.0          # 手动指定版本，下载 + 上传
#
# 前置条件:
#   - gh CLI 已安装并登录
#   - GITCODE_TOKEN 环境变量已设置，或 deploy-release.conf 已配置
#
# 流程:
#   1. 从 GitHub Release 下载构建产物（macOS DMG + Windows EXE）
#   2. 在 GitCode 创建 Release
#   3. 上传产物到 GitCode Release
#   4. 更新 mirror 仓库 README
#   5. 更新 Landing 页面下载地址
# ============================================================

# ── 加载本地配置（如有） ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONF_FILE="${SCRIPT_DIR}/deploy-release.conf"
if [ -f "$CONF_FILE" ]; then
  source "$CONF_FILE"
fi

# ── 参数解析 ──
PKG_VER="$(node -p "require('./package.json').version")"
DEFAULT_TAG="v${PKG_VER}"
TAG="${1:-$DEFAULT_TAG}"
RELEASE_NOTES="${SCRIPT_DIR}/../RELEASE_NOTES_${TAG}.md"

if [ ! -f "$RELEASE_NOTES" ]; then
  echo "发布说明文件不存在: ${RELEASE_NOTES}" >&2
  exit 1
fi

: "${GITCODE_TOKEN:?请先设置环境变量 GITCODE_TOKEN，或创建 deploy-release.conf}"

GITCODE_OWNER="${GITCODE_OWNER:-diamondfsd}"
GITCODE_REPO="${GITCODE_REPO:-luna-ai-cut-package-release}"
GITCODE_DL="https://gitcode.com/${GITCODE_OWNER}/${GITCODE_REPO}/releases/download"
GITHUB_REPO="${GITHUB_REPO:-diamondfsd/luna-ai-cut}"
DOWNLOAD_DIR="release"

# ── 颜色 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()  { echo -e "${CYAN}==>${NC} $*"; }
ok()    { echo -e "${GREEN}  ✓${NC} $*"; }
warn()  { echo -e "${YELLOW}  ⚠${NC} $*"; }
err()   { echo -e "${RED}  ✗${NC} $*"; }

# ============================================================
# 第一步：从 GitHub Release 下载构建产物
# ============================================================
echo ""
info "═══════════════════════════════════════════════════════════"
info "  Luna AI Cut ${TAG} — 从 GitHub 下载构建产物"
info "═══════════════════════════════════════════════════════════"
echo ""

info "清理旧下载目录..."
rm -rf "${DOWNLOAD_DIR:?}"/*
mkdir -p "$DOWNLOAD_DIR"
ok "目录已清理"

info "检查 gh CLI..."
if ! command -v gh &>/dev/null; then
  err "请先安装 gh CLI 并登录 (brew install gh && gh auth login)"
  exit 1
fi

info "检查 GitHub Release ${TAG}..."
if ! gh release view "$TAG" --repo "$GITHUB_REPO" &>/dev/null; then
  err "GitHub Release ${TAG} 不存在，请先创建 Release"
  info "运行: gh release create ${TAG} --title \"${TAG}\" --notes \"...\""
  exit 1
fi
ok "Release 存在"

info "下载构建产物到 ${DOWNLOAD_DIR}/..."
gh release download "$TAG" \
  --repo "$GITHUB_REPO" \
  --dir "$DOWNLOAD_DIR" \
  --pattern "*.dmg" \
  --pattern "*.exe"
ok "下载完成"

# 列出下载的产物
FILES=()
while IFS= read -r f; do FILES+=("$f"); done < <(find "$DOWNLOAD_DIR" \( -name "*.dmg" -o -name "*.exe" \) -type f 2>/dev/null || true)

if [ ${#FILES[@]} -eq 0 ]; then
  err "未找到下载的构建产物（.dmg / .exe）"
  exit 1
fi

for f in "${FILES[@]}"; do
  size=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null)
  size_hr=$(numfmt --to=iec "$size" 2>/dev/null || echo "${size}B")
  ok "已下载: $f (${size_hr})"
done

# ============================================================
# 第二步：创建 / 更新 GitCode Release
# ============================================================
echo ""
info "═══════════════════════════════════════════════════════════"
info "  GitCode Release — ${TAG}"
info "═══════════════════════════════════════════════════════════"
echo ""

API_BASE="https://api.gitcode.com/api/v5/repos/${GITCODE_OWNER}/${GITCODE_REPO}"

info "创建 Release..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${API_BASE}/releases" \
  -H "PRIVATE-TOKEN: ${GITCODE_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$(cat <<-END
{
  "tag_name": "${TAG}",
  "name": "${TAG}",
  "body": "Luna AI Cut ${TAG} 发布，详见 https://github.com/${GITHUB_REPO}/releases/tag/${TAG}"
}
END
)" ) || true

case "$HTTP_CODE" in
  201|200) ok "Release 创建成功 (HTTP ${HTTP_CODE})" ;;
  *)       warn "Release 创建返回 HTTP ${HTTP_CODE}（可能已存在，继续）" ;;
esac

# ============================================================
# 第三步：上传附件
# ============================================================
echo ""
info "═══════════════════════════════════════════════════════════"
info "  上传附件到 GitCode"
info "═══════════════════════════════════════════════════════════"
echo ""

for filepath in "${FILES[@]}"; do
  filename=$(basename "$filepath")
  size=$(stat -f%z "$filepath" 2>/dev/null || stat -c%s "$filepath" 2>/dev/null)
  size_hr=$(numfmt --to=iec "$size" 2>/dev/null || echo "${size}B")

  info "上传 ${filename} (${size_hr})"

  # URL 编码
  encoded_name=$(printf '%s' "$filename" | python3 -c "import sys,urllib.parse; print(urllib.parse.quote(sys.stdin.read().strip()))")

  # 获取 OBS 上传地址
  upload_json=$(curl -sS \
    "${API_BASE}/releases/${TAG}/upload_url?file_name=${encoded_name}" \
    -H "PRIVATE-TOKEN: ${GITCODE_TOKEN}")

  upload_url=$(echo "$upload_json" | python3 -c "import json,sys; print(json.load(sys.stdin).get('url',''))" 2>/dev/null || echo "")
  if [ -z "$upload_url" ]; then
    err "获取上传地址失败: $(echo "$upload_json" | python3 -c "import json,sys; print(json.load(sys.stdin).get('error_message','unknown'))" 2>/dev/null)"
    continue
  fi

  # 提取 headers
  headers_json=$(echo "$upload_json" | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get('headers',{})))" 2>/dev/null)
  ct=$(echo "$headers_json" | python3 -c "import json,sys; print(json.load(sys.stdin).get('Content-Type','application/octet-stream'))" 2>/dev/null)
  pid=$(echo "$headers_json" | python3 -c "import json,sys; print(json.load(sys.stdin).get('x-obs-meta-project-id',''))" 2>/dev/null)
  acl=$(echo "$headers_json" | python3 -c "import json,sys; print(json.load(sys.stdin).get('x-obs-acl',''))" 2>/dev/null)
  cb=$(echo "$headers_json" | python3 -c "import json,sys; print(json.load(sys.stdin).get('x-obs-callback',''))" 2>/dev/null)

  header_args=(-H "Content-Type: ${ct}")
  [ -n "$pid" ] && header_args+=(-H "x-obs-meta-project-id: ${pid}")
  [ -n "$acl" ] && header_args+=(-H "x-obs-acl: ${acl}")
  [ -n "$cb" ]  && header_args+=(-H "x-obs-callback: ${cb}")

  # 上传文件
  curl --progress-bar -X PUT "${header_args[@]}" --data-binary "@${filepath}" \
    "${upload_url}" -o /dev/null -w "\n→ HTTP %{http_code}\n" && \
    ok "${filename} 上传完成" || err "${filename} 上传失败"
done


# ============================================================
# 第四步：更新 README
# ============================================================
echo ""
info "═══════════════════════════════════════════════════════════"
info "  更新镜像仓库 README"
info "═══════════════════════════════════════════════════════════"
echo ""

# 获取 release 详情得到附件 browser_download_url
release_json=$(curl -sS \
  "${API_BASE}/releases/tags/${TAG}" \
  -H "PRIVATE-TOKEN: ${GITCODE_TOKEN}")

# 提取附件 URL
extract_asset() {
  local pattern="$1"
  echo "$release_json" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for a in d.get('assets',[]):
    if a.get('name','').endswith('${pattern}'):
        print(a.get('browser_download_url',''))
        break
" 2>/dev/null
}

mac_arm_url=$(extract_asset "-arm64.dmg")
mac_x64_url=$(extract_asset "-x64.dmg")
win_url=$(extract_asset ".exe")
mac_arm_name=$(echo "$release_json" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for a in d.get('assets',[]):
    if a['name'].endswith('-arm64.dmg'):
        print(a['name']); break
")
mac_x64_name=$(echo "$release_json" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for a in d.get('assets',[]):
    if a['name'].endswith('-x64.dmg'):
        print(a['name']); break
")
win_name=$(echo "$release_json" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for a in d.get('assets',[]):
    if a['name'].endswith('.exe'):
        print(a['name']); break
")

echo "  macOS ARM64: ${mac_arm_name:-<未上传>}"
echo "  macOS x64:   ${mac_x64_name:-<未上传>}"
echo "  Windows:     ${win_name:-<未上传>}"

readme_body=$(cat <<-END
# Luna AI Cut — 国内下载镜像

> 本仓库用于托管 [Luna AI Cut](https://github.com/${GITHUB_REPO}) 的构建产物，方便国内用户高速下载。

---

## 📥 最新版本：${TAG}

[![GitHub Release](https://img.shields.io/badge/release-${TAG}-blue)](https://github.com/${GITHUB_REPO}/releases/tag/${TAG})

| 平台 | 文件 | 下载 |
|------|------|------|
| macOS (Apple Silicon) | ${mac_arm_name} | [⬇️ 下载](${mac_arm_url}) |
| macOS (Intel) | ${mac_x64_name} | [⬇️ 下载](${mac_x64_url}) |
| Windows (x64) | ${win_name} | [⬇️ 下载](${win_url}) |

---

## 📋 关于

**Luna AI Cut** 是一款面向 Insta360 Luna Ultra 相机的桌面媒体管理工具。

- **功能**：Wi-Fi 连接相机、媒体浏览与下载、水印导出、边到边预览
- **GitHub 仓库**：[${GITHUB_REPO}](https://github.com/${GITHUB_REPO})
- **GitHub Releases**：[所有版本](https://github.com/${GITHUB_REPO}/releases)
- **问题反馈**：[Issues](https://github.com/${GITHUB_REPO}/issues)
END
)

content_b64=$(echo "$readme_body" | base64 -w 0)

current_sha=$(curl -sS \
  "${API_BASE}/contents/README.md" \
  -H "PRIVATE-TOKEN: ${GITCODE_TOKEN}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('sha',''))" 2>/dev/null)

if [ -n "$current_sha" ]; then
  info "更新 README.md..."
  curl -s -X PUT "${API_BASE}/contents/README.md" \
    -H "PRIVATE-TOKEN: ${GITCODE_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$(cat <<-END
{
  "message": "chore: update download links for ${TAG}",
  "content": "${content_b64}",
  "sha": "${current_sha}"
}
END
)" | python3 -c "import json,sys; print(json.load(sys.stdin).get('commit',{}).get('message','updated'))" 2>/dev/null
  ok "README.md 已更新"
else
  warn "未找到 README.md，跳过更新"
fi

# ============================================================
# 第五步：更新 Landing 页面下载地址
# ============================================================
echo ""
info "═══════════════════════════════════════════════════════════"
info "  更新 Landing 页面下载地址"
info "═══════════════════════════════════════════════════════════"
echo ""

SCRIPT_JS="${SCRIPT_DIR}/../landing/script.js"
CHANGELOG_GENERATOR="${SCRIPT_DIR}/../landing/generate-changelog.cjs"
CHANGELOG_DATA="${SCRIPT_DIR}/../landing/changelog-data.js"
GITCODE_BASE="https://gitcode.com/${GITCODE_OWNER}/${GITCODE_REPO}/releases/download"

# 从下载到的文件构建下载 URL
mac_arm_file=""
mac_x64_file=""
win_file=""
for f in "${FILES[@]}"; do
  fn=$(basename "$f")
  case "$fn" in
    *-arm64.dmg) mac_arm_file="$fn" ;;
    *-x64.dmg)   mac_x64_file="$fn" ;;
    *.dmg)       mac_arm_file="$fn" ;;  # 降级：不含架构后缀视为 ARM64
    *Setup*.exe | *.exe) win_file="$fn" ;;
  esac
done

mac_arm_dl="${GITCODE_BASE}/${TAG}/${mac_arm_file}"
mac_x64_dl="${GITCODE_BASE}/${TAG}/${mac_x64_file}"
win_dl="${GITCODE_BASE}/${TAG}/${win_file}"

info "macOS ARM64 下载地址: ${mac_arm_dl}"
info "macOS x64 下载地址:   ${mac_x64_dl}"
info "Windows 下载地址:     ${win_dl}"

# 更新 script.js 中的 LATEST_RELEASE 常量
if [ -f "$SCRIPT_JS" ]; then
  OS="$(uname -s)"
  if [ "$OS" = "Darwin" ]; then
    sed -i '' "s|tag: '.*'|tag: '${TAG}'|" "$SCRIPT_JS"
    sed -i '' "s|label: '.*'|label: '${TAG}'|" "$SCRIPT_JS"
    sed -i '' "s|gitcode_mac_arm: '.*'|gitcode_mac_arm: '${mac_arm_dl}'|" "$SCRIPT_JS"
    sed -i '' "s|gitcode_mac_x64: '.*'|gitcode_mac_x64: '${mac_x64_dl}'|" "$SCRIPT_JS"
    sed -i '' "s|gitcode_win: '.*'|gitcode_win: '${win_dl}'|" "$SCRIPT_JS"
  else
    sed -i "s|tag: '.*'|tag: '${TAG}'|" "$SCRIPT_JS"
    sed -i "s|label: '.*'|label: '${TAG}'|" "$SCRIPT_JS"
    sed -i "s|gitcode_mac_arm: '.*'|gitcode_mac_arm: '${mac_arm_dl}'|" "$SCRIPT_JS"
    sed -i "s|gitcode_mac_x64: '.*'|gitcode_mac_x64: '${mac_x64_dl}'|" "$SCRIPT_JS"
    sed -i "s|gitcode_win: '.*'|gitcode_win: '${win_dl}'|" "$SCRIPT_JS"
  fi
  ok "landing/script.js 已更新"

  info "生成 Landing 页面更新日志..."
  node "$CHANGELOG_GENERATOR"
  ok "landing/changelog-data.js 已更新"

  # 提交并推送 landing 页面改动
  info "提交 Landing 页面更新..."
  git add "$SCRIPT_JS" "$CHANGELOG_DATA" 2>/dev/null || true
  if git diff --cached --quiet 2>/dev/null; then
    warn "无变更，跳过提交"
  else
    git commit -m "chore: update landing release for ${TAG}" || true
    git push origin main 2>/dev/null || warn "推送失败，请手动推送"
    ok "Landing 页面已更新并推送"
  fi
else
  warn "未找到 landing/script.js"
fi

# ============================================================
# 完成
# ============================================================
echo ""
info "═══════════════════════════════════════════════════════════"
ok  "全部完成！${TAG} 已发布到 GitCode"
info "  ${API_BASE}/releases/tag/${TAG}"
echo ""
