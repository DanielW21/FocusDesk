#!/bin/zsh
set -euo pipefail

PROJECT_DIR="${0:A:h}"
APP_DIR="$PROJECT_DIR/release/FocusDesk.app"
CONTENTS_DIR="$APP_DIR/Contents"
ICON_TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/focusdesk-icon.XXXXXX")"
trap 'rm -rf "$ICON_TEMP_DIR"' EXIT

cd "$PROJECT_DIR"
# Load local native-only configuration for packaging. `.env.local` is ignored
# by git; only values explicitly consumed by this script reach the app bundle.
if [[ -f "$PROJECT_DIR/.env.local" ]]; then
  set -a
  source "$PROJECT_DIR/.env.local"
  set +a
fi
npm run build
node native/inline-build.mjs

rm -rf "$APP_DIR"
mkdir -p "$CONTENTS_DIR/MacOS" "$CONTENTS_DIR/Resources/web"

cp -R dist/. "$CONTENTS_DIR/Resources/web/"
cp native/Info.plist "$CONTENTS_DIR/Info.plist"
if [[ -n "${FOCUSDESK_GOOGLE_CLIENT_SECRET:-}" ]]; then
  plutil -insert FDGoogleClientSecret -string "$FOCUSDESK_GOOGLE_CLIENT_SECRET" "$CONTENTS_DIR/Info.plist"
fi

sips -z 512 512 assets/app-icon.png --out "$ICON_TEMP_DIR/icon-512.png" >/dev/null
sips -z 1024 1024 assets/app-icon.png --out "$ICON_TEMP_DIR/icon-1024.png" >/dev/null
node native/make-icon.mjs "$CONTENTS_DIR/Resources/AppIcon.icns" \
  ic09 "$ICON_TEMP_DIR/icon-512.png" \
  ic10 "$ICON_TEMP_DIR/icon-1024.png"

clang -fobjc-arc native/main.m \
  native/Bridge/FDMessageBridge.m \
  native/Integrations/FDGoogleCalendarClient.m \
  native/Database/FDFocusDeskDatabase.m \
  native/Database/FDTaskManagerDatabase.m \
  -o "$CONTENTS_DIR/MacOS/FocusDesk" \
  -framework Cocoa -framework WebKit -framework UniformTypeIdentifiers -framework Security -lsqlite3 \
  -mmacosx-version-min=13.0

# Ad-hoc signatures are convenient, but macOS treats every rebuilt binary as a
# different Keychain client. Set FOCUSDESK_CODESIGN_IDENTITY to a stable local
# or Developer ID identity when available so the Google refresh token can be
# read without a new approval prompt after each rebuild.
CODESIGN_IDENTITY="${FOCUSDESK_CODESIGN_IDENTITY:-}"
if [[ -z "$CODESIGN_IDENTITY" ]]; then
  CODESIGN_IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | awk -F '\"' '/FocusDesk Development|Developer ID Application/ { print $2; exit }')"
fi
if [[ -n "$CODESIGN_IDENTITY" ]]; then
  codesign --force --deep --sign "$CODESIGN_IDENTITY" "$APP_DIR"
else
  codesign --force --deep --sign - "$APP_DIR"
  echo "Warning: using an ad-hoc signature; macOS may ask for Keychain access again after rebuilding."
fi
pkgbuild --component "$APP_DIR" \
  --install-location /Applications \
  --identifier com.danielwu.focusdesk \
  --version 0.1.0 \
  "release/FocusDesk.pkg"

ditto -c -k --sequesterRsrc --keepParent "$APP_DIR" "release/FocusDesk-mac-arm64.zip"

echo "Built: $APP_DIR"
echo "Built: $PROJECT_DIR/release/FocusDesk.pkg"
