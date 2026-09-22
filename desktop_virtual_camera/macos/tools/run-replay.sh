#!/bin/zsh
set -euo pipefail

ROOT="$(cd "${0:A:h}/../../.." && pwd)"
MACOS_DIR="$ROOT/desktop_virtual_camera/macos"
HEVC_PATH="${TMPDIR:-/tmp}/luna-virtual-camera-replay.hevc"
HOST_LOG="${TMPDIR:-/tmp}/luna-virtual-camera-host.log"
REPLAY_LOG="${TMPDIR:-/tmp}/luna-virtual-camera-replay.log"

cleanup() {
  [[ -n "${HOST_PID:-}" ]] && kill "$HOST_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if ! command -v ffmpeg >/dev/null; then
  print -u2 'ffmpeg is required for the local replay test'
  exit 1
fi

ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i testsrc2=size=1280x720:rate=30 -t 2 \
  -c:v libx265 -preset ultrafast \
  -x265-params 'log-level=error:keyint=1:min-keyint=1:scenecut=0:repeat-headers=1' \
  -f hevc "$HEVC_PATH"

(cd "$MACOS_DIR" && xcodegen generate >/dev/null && \
  xcodebuild -project LunaVirtualCamera.xcodeproj \
    -scheme LunaCameraHost -configuration Debug -sdk macosx \
    build CODE_SIGNING_ALLOWED=NO >/dev/null)

PRODUCT="$(find "$HOME/Library/Developer/Xcode/DerivedData" \
  -path '*/Build/Products/Debug/LunaCameraHost.app' -type d -print -quit)"
if [[ -z "$PRODUCT" ]]; then
  print -u2 'LunaCameraHost.app was not found'
  exit 1
fi

"$PRODUCT/Contents/MacOS/LunaCameraHost" >"$HOST_LOG" 2>&1 & HOST_PID=$!
sleep 1
node "$ROOT/desktop_virtual_camera/tools/send-hevc-replay.mjs" \
  --input "$HEVC_PATH" --host 127.0.0.1 --port 4184 >"$REPLAY_LOG" 2>&1

sleep 5
print 'Host trace:'
tail -5 /tmp/luna-hevc.log 2>/dev/null || print '  no decoder trace'
print 'Shared frame:'
stat -f '  %z bytes: %N' /tmp/latest-bgra.frame 2>/dev/null || print '  not produced'
print "Logs: $HOST_LOG $REPLAY_LOG"
