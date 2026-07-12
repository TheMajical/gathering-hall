#!/bin/sh
# Print the current public trycloudflare URL for the game hub.
cd "$(dirname "$0")/.." || exit 1
URL=$(docker compose logs cloudflared 2>&1 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | grep -v '^https://api\.' | tail -1)
if [ -n "$URL" ]; then
  echo "$URL"
else
  echo "No tunnel URL found yet — is the cloudflared container running?" >&2
  exit 1
fi
