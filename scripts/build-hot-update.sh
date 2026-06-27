#!/usr/bin/env bash
# ============================================================
# build-hot-update.sh — 构建并上传热更新包
#
# 构建前端 + 主进程 JS，打包为 zip 并上传到 GitCode Release。
#
# 用法:
#   ./scripts/build-hot-update.sh                  # 自动取 build 号 +1，构建 + 上传
#   ./scripts/build-hot-update.sh --build-only     # 只构建不上传
#   ./scripts/build-hot-update.sh --upload-only    # 只上传（跳过构建）
#   ./scripts/build-hot-update.sh 3                # 指定 build 号
#   ./scripts/build-hot-update.sh 3 --upload-only  # 上传指定 build 号的已有包
#
# 配置:
#   需要 GITCODE_TOKEN 环境变量（或 deploy-release.conf）
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# ── 加载本地配置 ──
CONF_FILE="${SCRIPT_DIR}/deploy-release.conf"
if [ -f "$CONF_FILE" ]; then
  source "$CONF_FILE"
fi

# ── 颜色 ──
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${CYAN}==>${NC} $*"; }
ok()    { echo -e "${GREEN}  ✓${NC} $*"; }
warn()  { echo -e "${YELLOW}  ⚠${NC} $*"; }
err()   { echo -e "${RED}  ✗${NC} $*"; }

# ── 参数解析 ──
BUILD_ONLY=false
UPLOAD_ONLY=false
HOT_VERSION_ARG=""

for arg in "$@"; do
  case "$arg" in
    --build-only) BUILD_ONLY=true ;;
    --upload-only) UPLOAD_ONLY=true ;;
    --upload) ;; # 兼容（默认行为就是构建+上传）
    *) HOT_VERSION_ARG="$arg" ;;
  esac
done

# ── 获取版本信息 ──
GITCODE_OWNER="${GITCODE_OWNER:-diamondfsd}"
GITCODE_REPO="${GITCODE_REPO:-luna-ai-cut-package-release}"
PKG_VERSION=$(node -p "require('./package.json').version")
RELEASE_DIR="release/${PKG_VERSION}/hot-update"
LATEST_TAG="v${PKG_VERSION}"
API_BASE="https://api.gitcode.com/api/v5/repos/${GITCODE_OWNER}/${GITCODE_REPO}"

# ── 确定 build 号 ──
function resolve_build_number() {
  local forced="$1"
  if [ -n "$forced" ]; then
    echo "$forced"
    return
  fi

  # 通过 GitCode API 查找已有热更新 zip，取最大 build 号 +1
  local latest_json last_build
  latest_json=$(curl -sS "${API_BASE}/releases/tags/${LATEST_TAG}" 2>/dev/null || echo "")
  if [ -n "$latest_json" ]; then
    last_build=$(echo "$latest_json" | python3 -c "
import json,sys,re
try:
    d = json.load(sys.stdin)
    assets = d.get('assets', [])
    nums = []
    for a in assets:
        m = re.search(r'-hot\.(\d+)\.zip$', a['name'])
        if m: nums.append(int(m.group(1)))
    print(max(nums) if nums else 0)
except: print(0)
" 2>/dev/null || echo "0")
    echo $((last_build + 1))
    return
  fi
  echo "1"
}

HOT_VERSION=$(resolve_build_number "$HOT_VERSION_ARG")
FULL_VERSION="${PKG_VERSION}-hot.${HOT_VERSION}"
ZIP_NAME="renderer-${FULL_VERSION}.zip"
ZIP_PATH="${RELEASE_DIR}/${ZIP_NAME}"
MANIFEST_PATH="${RELEASE_DIR}/renderer-latest.json"

# ============================================================
# 第一步：构建
# ============================================================
if [ "$UPLOAD_ONLY" = false ]; then
  echo ""
  info "═══════════════════════════════════════════════════════════"
  info "  构建热更新包 ${FULL_VERSION}"
  info "═══════════════════════════════════════════════════════════"
  echo ""

  # ── 构建 ──
  info "执行前端构建..."
  npm run build:app
  ok "构建完成"

  # ── 检查构建产物 ──
  if [ ! -f "dist/index.html" ]; then
    err "dist/index.html 不存在，构建可能失败"
    exit 1
  fi
  if [ ! -f "dist-electron/luna-appMain.js" ]; then
    err "dist-electron/luna-appMain.js 不存在"
    exit 1
  fi
  if [ ! -f "dist-electron/preload.mjs" ]; then
    err "dist-electron/preload.mjs 不存在"
    exit 1
  fi

  mkdir -p "$RELEASE_DIR"

  # ── 创建 zip ──
  info "打包热更新文件..."
  node -e "
  const AdmZip = require('adm-zip');
  const zip = new AdmZip();
  zip.addLocalFolder('dist-electron', 'dist-electron', (f) => f !== 'dist-electron/main.js');
  zip.addLocalFolder('dist', 'dist');
  zip.writeZip('${ZIP_PATH}');
  console.log('  ✓ zip 已创建');
  "
  ok "ZIP: ${ZIP_PATH}"

  # ── 创建元数据 ──
  cat > "$MANIFEST_PATH" <<EOF
{
  "version": "${FULL_VERSION}",
  "zipName": "${ZIP_NAME}",
  "minAppVersion": "${PKG_VERSION}"
}
EOF
  ok "元数据: ${MANIFEST_PATH}"

  # ── 展示文件信息 ──
  echo ""
  size=$(stat -f%z "$ZIP_PATH" 2>/dev/null | numfmt --to=iec 2>/dev/null || echo "$(wc -c < "$ZIP_PATH") bytes")
  echo "  ZIP 大小:   ${size}"
  echo "  ZIP 路径:   ${ZIP_PATH}"
  echo "  元数据路径: ${MANIFEST_PATH}"
  echo ""

  # ── 验证 ──
  info "验证 zip 完整性..."
  node -e "
  const AdmZip = require('adm-zip');
  const zip = new AdmZip('${ZIP_PATH}');
  const entries = zip.getEntries();
  const expected = ['dist-electron/luna-appMain.js', 'dist-electron/preload.mjs', 'dist/index.html'];
  const missing = expected.filter(f => !entries.find(e => e.entryName === f));
  if (missing.length > 0) {
    console.error('缺少文件:', missing.join(', '));
    process.exit(1);
  }
  console.log('  ✓ 文件结构正确 (' + entries.length + ' 个文件)');
  "
  echo ""
  ok "热更新包构建完成: ${FULL_VERSION}"
  echo ""
fi

# ============================================================
# 第二步：上传（--build-only 跳过）
# ============================================================
if [ "$BUILD_ONLY" = true ]; then
  echo "  上传以下文件到 GitCode Release ${LATEST_TAG}:"
  echo "    - ${ZIP_PATH}"
  echo "    - ${MANIFEST_PATH}"
  exit 0
fi

if [ -z "${GITCODE_TOKEN:-}" ]; then
  err "未设置 GITCODE_TOKEN 环境变量"
  err "请设置环境变量或创建 ${CONF_FILE}"
  exit 1
fi

echo ""
info "═══════════════════════════════════════════════════════════"
info "  上传到 GitCode Release ${LATEST_TAG}"
info "═══════════════════════════════════════════════════════════"
echo ""

# 检查文件是否存在
if [ ! -f "$ZIP_PATH" ]; then
  err "文件不存在: ${ZIP_PATH}"
  err "请先构建（去掉 --upload-only）"
  exit 1
fi
if [ ! -f "$MANIFEST_PATH" ]; then
  err "文件不存在: ${MANIFEST_PATH}"
  err "请先构建（去掉 --upload-only）"
  exit 1
fi

# ── 确保 Release 存在 ──
info "确保 Release ${LATEST_TAG} 存在..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${API_BASE}/releases" \
  -H "PRIVATE-TOKEN: ${GITCODE_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$(cat <<-END
{
  "tag_name": "${LATEST_TAG}",
  "name": "${LATEST_TAG}",
  "body": "Luna AI Cut ${LATEST_TAG} — 热更新包"
}
END
)" ) || true

case "$HTTP_CODE" in
  201|200) ok "Release 创建成功" ;;
  *)       warn "Release 创建返回 HTTP ${HTTP_CODE}（已存在就跳过）" ;;
esac

# ── 上传单个文件 ──
function upload_asset() {
  local filepath="$1"
  local filename
  filename=$(basename "$filepath")

  info "上传 ${filename}..."

  local encoded_name
  encoded_name=$(printf '%s' "$filename" | python3 -c "import sys,urllib.parse; print(urllib.parse.quote(sys.stdin.read().strip()))")

  # 获取 OBS 上传地址
  local upload_json upload_url headers_json ct pid acl cb
  upload_json=$(curl -sS \
    "${API_BASE}/releases/${LATEST_TAG}/upload_url?file_name=${encoded_name}" \
    -H "PRIVATE-TOKEN: ${GITCODE_TOKEN}")

  upload_url=$(echo "$upload_json" | python3 -c "import json,sys; print(json.load(sys.stdin).get('url',''))" 2>/dev/null || echo "")
  if [ -z "$upload_url" ]; then
    local error_msg
    error_msg=$(echo "$upload_json" | python3 -c "import json,sys; print(json.load(sys.stdin).get('error_message','unknown'))" 2>/dev/null)
    err "获取上传地址失败: ${error_msg}"
    return 1
  fi

  # 提取 headers
  headers_json=$(echo "$upload_json" | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get('headers',{})))" 2>/dev/null)
  ct=$(echo "$headers_json" | python3 -c "import json,sys; print(json.load(sys.stdin).get('Content-Type','application/octet-stream'))" 2>/dev/null)
  pid=$(echo "$headers_json" | python3 -c "import json,sys; print(json.load(sys.stdin).get('x-obs-meta-project-id',''))" 2>/dev/null)
  acl=$(echo "$headers_json" | python3 -c "import json,sys; print(json.load(sys.stdin).get('x-obs-acl',''))" 2>/dev/null)
  cb=$(echo "$headers_json" | python3 -c "import json,sys; print(json.load(sys.stdin).get('x-obs-callback',''))" 2>/dev/null)

  local header_args=(-H "Content-Type: ${ct}")
  [ -n "$pid" ] && header_args+=(-H "x-obs-meta-project-id: ${pid}")
  [ -n "$acl" ] && header_args+=(-H "x-obs-acl: ${acl}")
  [ -n "$cb" ]  && header_args+=(-H "x-obs-callback: ${cb}")

  curl --progress-bar -X PUT "${header_args[@]}" --data-binary "@${filepath}" \
    "${upload_url}" -o /dev/null -w "\n→ HTTP %{http_code}\n" && \
    ok "${filename} 上传完成" || err "${filename} 上传失败"
}

# 上传 zip（manifest 不再需要，客户端通过 API 自动发现最新 zip）
upload_asset "$ZIP_PATH"

echo ""
ok "全部上传完成！"
info "Release: ${API_BASE}/releases/tag/${LATEST_TAG}"
echo ""
