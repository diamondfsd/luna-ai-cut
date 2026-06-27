#!/usr/bin/env bash
# ============================================================
# build-hot-update.sh — 构建热更新包
#
# 构建前端 + 主进程 JS，打包为 zip 供 GitCode Release 上传。
# 这个 zip 包只包含平台无关的 JS/HTML/CSS 资源，不包含原生二进制。
#
# 用法:
#   ./scripts/build-hot-update.sh [build-number]
#
# 示例:
#   ./scripts/build-hot-update.sh 1     → 生成 renderer-v1.3.1-hot.1.zip
#   ./scripts/build-hot-update.sh       → 自动取上次 build 号 +1
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# ── 颜色 ──
GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${CYAN}==>${NC} $*"; }
ok()    { echo -e "${GREEN}  ✓${NC} $*"; }
err()   { echo -e "${RED}  ✗${NC} $*"; }

# ── 获取版本信息 ──
PKG_VERSION=$(node -p "require('./package.json').version")
RELEASE_DIR="release/${PKG_VERSION}/hot-update"
mkdir -p "$RELEASE_DIR"

# ── 确定 build 号 ──
HOT_VERSION="$1"
if [ -z "$HOT_VERSION" ]; then
  # 尝试从 GitCode Release 获取最新的 hot 版本号
  LATEST_TAG="v${PKG_VERSION}"
  GITCODE_REPO="diamondfsd/luna-ai-cut-package-release"
  GITCODE_API="https://api.gitcode.com/api/v5/repos/${GITCODE_REPO}/releases/tags/${LATEST_TAG}"

  LATEST_JSON=$(curl -sS "${GITCODE_API}" 2>/dev/null || echo "")
  if [ -n "$LATEST_JSON" ]; then
    # 查找现有的 renderer-latest.json 附件 URL
    DL_URL=$(echo "$LATEST_JSON" | python3 -c "
import json,sys
try:
    d = json.load(sys.stdin)
    for a in d.get('assets', []):
        if a['name'] == 'renderer-latest.json':
            print(a['browser_download_url'])
            break
except: pass
" 2>/dev/null || echo "")

    if [ -n "$DL_URL" ]; then
      MANIFEST=$(curl -sS "$DL_URL" 2>/dev/null || echo "")
      if [ -n "$MANIFEST" ]; then
        LAST_BUILD=$(echo "$MANIFEST" | python3 -c "
import json,sys
try:
    v = json.load(sys.stdin)['version']
    print(v.split('hot.')[-1])
except: print(0)
" 2>/dev/null || echo "0")
        HOT_VERSION=$((LAST_BUILD + 1))
      fi
    fi
  fi
fi

# 如果没有远程版本且未指定，从 1 开始
HOT_VERSION="${HOT_VERSION:-1}"
FULL_VERSION="${PKG_VERSION}-hot.${HOT_VERSION}"
ZIP_NAME="renderer-${FULL_VERSION}.zip"

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

# ── 创建 zip ──
info "打包热更新文件..."
ZIP_PATH="${RELEASE_DIR}/${ZIP_NAME}"

# 用 node 创建 zip（更可靠）
node -e "
const AdmZip = require('adm-zip');
const zip = new AdmZip();

// 添加 dist-electron/ 目录（排除 main.js bootstrap，它永远不会被热更新加载）
zip.addLocalFolder('dist-electron', 'dist-electron', (file: string) => file !== 'dist-electron/main.js');
// 添加 dist/ 目录
zip.addLocalFolder('dist', 'dist');

zip.writeZip('${ZIP_PATH}');
console.log('  ✓ zip 已创建');
"

ok "ZIP: ${ZIP_PATH}"

# ── 创建元数据 ──
MANIFEST_PATH="${RELEASE_DIR}/renderer-latest.json"
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
ZIP_SIZE=$(stat -f%z "$ZIP_PATH" 2>/dev/null | numfmt --to=iec 2>/dev/null || echo "$(wc -c < "$ZIP_PATH") bytes")
echo "  ZIP 大小:   ${ZIP_SIZE}"
echo "  ZIP 路径:   ${ZIP_PATH}"
echo "  元数据路径: ${MANIFEST_PATH}"
echo ""

# ── 解压验证（可选）──
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
echo "  上传以下文件到 GitCode Release v${PKG_VERSION}:"
echo "    - ${RELEASE_DIR}/${ZIP_NAME}"
echo "    - ${RELEASE_DIR}/renderer-latest.json"
echo ""
