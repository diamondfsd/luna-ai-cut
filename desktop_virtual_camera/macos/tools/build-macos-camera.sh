#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h}/.."
cd "$ROOT"

TEAM_ID="${DEVELOPMENT_TEAM:-}"
SIGNING_IDENTITY="${CODE_SIGN_IDENTITY:-Apple Development}"
CONFIGURATION="${CONFIGURATION:-Debug}"
DERIVED_DATA="${DERIVED_DATA_PATH:-$ROOT/.build/SignedData}"
DRIVER_DIR="$ROOT/.build/LunaVirtualMicrophone.driver"
DRIVER_SOURCE="$ROOT/VirtualMicrophone/LunaVirtualMicrophoneDriver.c"
DRIVER_PLIST="$ROOT/VirtualMicrophone/Info.plist"

if [[ -z "$TEAM_ID" ]]; then
  print -u2 'DEVELOPMENT_TEAM is required (for example: ABC1234567)'
  exit 2
fi

if ! command -v xcodegen >/dev/null; then
  print -u2 'xcodegen is required'
  exit 2
fi

resolve_signing_identity() {
  local requested="$1"
  local line hash name subject
  while IFS= read -r line; do
    if [[ "$line" =~ '^[[:space:]]*[0-9]+\)[[:space:]]+([0-9A-F]{40})[[:space:]]+"(.+)"$' ]]; then
      hash="$match[1]"
      name="$match[2]"
      [[ "$name" == "$requested"* ]] || continue
      subject="$(security find-certificate -p -c "$name" 2>/dev/null | openssl x509 -noout -subject 2>/dev/null || true)"
      if [[ "$subject" == *"OU=$TEAM_ID"* ]]; then
        print -r -- "$hash"
        return 0
      fi
    fi
  done < <(security find-identity -v -p codesigning 2>/dev/null)
  return 1
}

xcodegen generate --spec project.yml >/dev/null

xcodebuild \
  -project LunaVirtualCamera.xcodeproj \
  -scheme LunaCameraHost \
  -configuration "$CONFIGURATION" \
  -derivedDataPath "$DERIVED_DATA" \
  -destination 'platform=macOS' \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  CODE_SIGN_IDENTITY="$SIGNING_IDENTITY" \
  CODE_SIGN_STYLE=Automatic \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  build

ARCH="$(uname -m)"
DRIVER_SIGN_IDENTITY="$(resolve_signing_identity "$SIGNING_IDENTITY")" || {
  print -u2 "No code signing identity matching '$SIGNING_IDENTITY' for team $TEAM_ID was found"
  exit 2
}
rm -rf "$DRIVER_DIR"
mkdir -p "$DRIVER_DIR/Contents/MacOS"
clang \
  -bundle \
  -fPIC \
  -O2 \
  -Wall \
  -Wextra \
  -Werror \
  -arch "$ARCH" \
  -mmacosx-version-min=15.0 \
  -framework CoreAudio \
  -framework CoreFoundation \
  -o "$DRIVER_DIR/Contents/MacOS/LunaVirtualMicrophone" \
  "$DRIVER_SOURCE"
cp "$DRIVER_PLIST" "$DRIVER_DIR/Contents/Info.plist"
codesign --force --sign "$DRIVER_SIGN_IDENTITY" "$DRIVER_DIR"
codesign --verify --strict --verbose=2 "$DRIVER_DIR"

APP="$DERIVED_DATA/Build/Products/$CONFIGURATION/LunaCameraHost.app"
EXT="$APP/Contents/Library/SystemExtensions/com.diamondfsd.luna.virtualcamera.host.extension.systemextension"

if [[ ! -d "$APP" || ! -d "$EXT" ]]; then
  print -u2 'Expected signed Host app or Camera Extension was not produced'
  exit 1
fi

codesign --verify --deep --strict --verbose=2 "$APP"

print '\nHost entitlements:'
codesign -d --entitlements - "$APP/Contents/MacOS/LunaCameraHost" 2>&1
print '\nExtension entitlements:'
codesign -d --entitlements - "$EXT/Contents/MacOS/com.diamondfsd.luna.virtualcamera.host.extension" 2>&1

print '\nSystem extensions:'
systemextensionsctl list 2>&1 || true
print "\nBuilt app: $APP"
print "Built virtual microphone: $DRIVER_DIR"
