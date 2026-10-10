#!/bin/sh
# Builds the zip to upload to the Chrome Web Store. The store assigns its own
# extension ID, so the manifest "key" (which pins the unpacked ID) is removed.
set -e
cd "$(dirname "$0")/.."
version=$(node -p "require('./extension/manifest.json').version")
out="dist/tabsteer-extension-$version.zip"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp -R extension "$work/extension"
node -e "
const fs = require('fs');
const file = process.argv[1];
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
delete manifest.key;
fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
" "$work/extension/manifest.json"
mkdir -p dist
rm -f "$out"
(cd "$work/extension" && zip -q -r -X "$OLDPWD/$out" . -x '.*')
echo "$out"
