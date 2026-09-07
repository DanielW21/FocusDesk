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

# The backend owns this build and its dependency lockfile. Do not ship source
# TypeScript, private configuration, cookies, databases, or a development symlink.
WW_SOURCE="$PROJECT_DIR/tools/waterlooworks"
if [[ ! -d "$WW_SOURCE/node_modules" ]]; then
  echo "Install WaterlooWorks build dependencies with npm ci --ignore-scripts --prefix tools/waterlooworks first." >&2
  exit 1
fi
npm run build --prefix "$WW_SOURCE"
[[ -s "$WW_SOURCE/dist/server.js" && -s "$WW_SOURCE/dist/cli.js" ]] || {
  echo "WaterlooWorks build must produce dist/server.js and dist/cli.js." >&2
  exit 1
}

rm -rf "$APP_DIR"
mkdir -p "$CONTENTS_DIR/MacOS" "$CONTENTS_DIR/Resources/web"

cp -R dist/. "$CONTENTS_DIR/Resources/web/"
cp native/Info.plist "$CONTENTS_DIR/Info.plist"

WW_RESOURCES="$CONTENTS_DIR/Resources/waterlooworks"
mkdir -p "$WW_RESOURCES/src" "$WW_RESOURCES/bin/lib"
cp -R "$WW_SOURCE/dist/." "$WW_RESOURCES/src/"
cp "$WW_SOURCE/package.json" "$WW_RESOURCES/package.json"
# Include runtime dependencies as well as compiled output: dynamic requires and
# worker resources must remain available when launched from an installed app.
cp -RL "$WW_SOURCE/node_modules" "$WW_RESOURCES/node_modules"
npm prune --omit=dev --ignore-scripts --offline --no-audit --no-fund --prefix "$WW_RESOURCES"

# Homebrew Node can depend on libnode and other non-system dylibs. Recursively
# copy/relink that closure, or accept a standalone Node via this build-only option.
# All subprocess arguments below are arrays, including paths containing spaces.
node --input-type=commonjs - "$WW_RESOURCES" "${FOCUSDESK_NODE_EXECUTABLE:-$(command -v node)}" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const [root, executable] = process.argv.slice(2);
const run = (file, args) => execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sourceNode = fs.realpathSync(executable);
const version = run(sourceNode, ['--version']).replace(/^v/, '').split('.').map(Number);
if (version[0] < 22 || (version[0] === 22 && version[1] < 5)) throw new Error('Bundled Node must be >=22.5');
const system = value => value.startsWith('/usr/lib/') || value.startsWith('/System/Library/');
const copied = new Map();
const names = new Map();
function copyImage(source, destination, inheritedRpaths = []) {
  source = fs.realpathSync(source);
  if (copied.has(source)) return copied.get(source);
  if (names.has(destination) && names.get(destination) !== source) throw new Error(`Conflicting dylib: ${destination}`);
  names.set(destination, source);
  copied.set(source, destination);
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, 0o755);
  // Relinking invalidates an existing signature; sign the finished bundle below.
  try { run('/usr/bin/codesign', ['--remove-signature', destination]); } catch {}
  const expand = value => value.replace(/^@loader_path/, path.dirname(source)).replace(/^@executable_path/, path.dirname(sourceNode));
  const commands = run('/usr/bin/otool', ['-l', source]);
  const rpaths = [...commands.matchAll(/cmd LC_RPATH\s+cmdsize \d+\s+path (.+?) \(offset/g)].map(match => expand(match[1])).concat(inheritedRpaths);
  const ids = new Set(run('/usr/bin/otool', ['-D', source]).split('\n').slice(1).map(value => value.trim()));
  const dependencies = run('/usr/bin/otool', ['-L', source]).split('\n').slice(1).map(line => line.trim().split(' (compatibility version')[0]);
  for (const dependency of dependencies) {
    if (system(dependency) || ids.has(dependency)) continue;
    const candidates = dependency.startsWith('@rpath/')
      ? rpaths.map(directory => path.join(directory, dependency.slice(7))) : [expand(dependency)];
    const resolved = candidates.find(candidate => fs.existsSync(candidate));
    if (!resolved) throw new Error(`Cannot resolve Node dependency ${dependency} from ${source}`);
    const target = copyImage(resolved, path.join(root, 'bin/lib', path.basename(fs.realpathSync(resolved))), rpaths);
    const relative = '@loader_path/' + path.relative(path.dirname(destination), target);
    run('/usr/bin/install_name_tool', ['-change', dependency, relative, destination]);
  }
  if (destination.endsWith('.dylib')) run('/usr/bin/install_name_tool', ['-id', '@loader_path/' + path.basename(destination), destination]);
  run('/usr/bin/codesign', ['--force', '--sign', '-', destination]);
  return destination;
}
const bundledNode = copyImage(sourceNode, path.join(root, 'bin/node'));
// Loading SQLite proves the packaged executable and its dylibs work together.
run(bundledNode, ['--experimental-sqlite', '-e', 'require("node:sqlite")']);
for (const file of ['server.js', 'cli.js']) run(bundledNode, ['--check', path.join(root, 'src', file)]);
NODE
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
  native/Integrations/FDWaterlooWorksClient.m \
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
