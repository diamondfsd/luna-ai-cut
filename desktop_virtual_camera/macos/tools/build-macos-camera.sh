#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h}/.."
cd "$ROOT"

TEAM_ID="${DEVELOPMENT_TEAM:-}"
SIGNING_IDENTITY="${CODE_SIGN_IDENTITY:-Apple Development}"
CONFIGURATION="${CONFIGURATION:-Debug}"
DERIVED_DATA="${DERIVED_DATA_PATH:-$ROOT/.build/SignedData}"

if [[ -z "$TEAM_ID" ]]; then
  print -u2 'DEVELOPMENT_TEAM is required (for example: ABC1234567)'
  exit 2
fi

if ! command -v xcodegen >/dev/null; then
  print -u2 'xcodegen is required'
  exit 2
fi

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
