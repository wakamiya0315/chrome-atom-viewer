#!/bin/sh
# Build the Chrome Web Store upload: dist/atom-viewer-<version>.zip with manifest.json at the zip root.
set -eu
cd "$(dirname "$0")/.."
version=$(node -p "require('./extension/manifest.json').version")
mkdir -p dist
out="dist/atom-viewer-$version.zip"
rm -f "$out"
(cd extension && zip -qr -X "../$out" . -x '.*' -x '*/.*')
echo "$out ($(du -h "$out" | cut -f1))"
