#!/usr/bin/env bash
# Download the motion-preview MP4s from the gallery-media release into
# gallery/media/ for local preview. They are not tracked in git — the
# deploy-pages workflow fetches them the same way when publishing.
set -euo pipefail
cd "$(dirname "$0")"
gh release download gallery-media \
  --repo Vincentwei1021/video-shotcraft \
  --dir media \
  --pattern '*.mp4' \
  --clobber
echo "done: $(ls media/*.mp4 | wc -l | tr -d ' ') clips in gallery/media/"
