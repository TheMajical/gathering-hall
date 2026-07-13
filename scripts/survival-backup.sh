#!/bin/sh
# Survival-mode backup: capture everything needed to run or redeploy the
# platform WITHOUT global internet access (see docs/SURVIVAL.md).
# Run it while internet works, and after meaningful changes.
set -e
cd "$(dirname "$0")/.."
OUT="${1:-./backups}"
mkdir -p "$OUT"
STAMP=$(date +%Y%m%d)

echo "1/4 building fresh image (uses internet — that's the point of doing it NOW)…"
docker compose build app >/dev/null

echo "2/4 exporting the runnable app image → $OUT/gamehub-app-$STAMP.tar.gz"
docker save gamehub-app | gzip > "$OUT/gamehub-app-$STAMP.tar.gz"

echo "3/4 exporting the base image (for offline rebuilds on a fresh docker host)…"
# BuildKit keeps base layers in its cache, not in `docker images` — pull explicitly.
docker pull -q node:22-alpine >/dev/null
docker save node:22-alpine > "$OUT/node22-alpine-$STAMP.tar"
gzip -f "$OUT/node22-alpine-$STAMP.tar"
[ "$(stat -c%s "$OUT/node22-alpine-$STAMP.tar.gz")" -gt 1000000 ] || { echo "ERROR: base image export looks wrong"; exit 1; }

echo "4/4 bundling the git repo → $OUT/gathering-hall-$STAMP.bundle"
git bundle create "$OUT/gathering-hall-$STAMP.bundle" --all

echo
echo "Done. Copy $OUT/ somewhere safe (USB stick, another machine, domestic VPS)."
echo "Restore on any docker host:  gunzip -c gamehub-app-*.tar.gz | docker load"
echo "                             then: docker compose up -d app"
ls -lh "$OUT" | tail -4
