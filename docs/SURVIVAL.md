# Survival Mode — Running Without Global Internet

**Scenario:** international internet access from Iran is cut, but the national
intranet (domestic routing between Iranian ISPs, `.ir` services, domestic
VPS/hosting) keeps working. Goal: you and your friends keep playing.

This document is a **preparation checklist** (do these steps *while global
internet works*) plus **runbooks** for the day the internet goes dark.

---

## 1. Dependency audit — what breaks and what doesn't

| Component | Needs global internet? | Status |
|---|---|---|
| Game server + engines | **No** — plain Node process | ✅ safe |
| Client (JS/CSS bundle) | **No** — served from your server | ✅ safe |
| Fonts | ~~Google Fonts CDN~~ → **self-hosted** in `/fonts` (vendored 2026-07-13) | ✅ fixed |
| Sound effects | **No** — local files in `/sounds` | ✅ safe |
| Game snapshots / rooms | **No** — local docker volume | ✅ safe |
| **cloudflared tunnel** | **YES** — Cloudflare's edge is outside Iran | ❌ dead during a blackout |
| **Docker image rebuilds** | **YES** — Docker Hub + npm registry | ❌ prepare backups (see §2) |
| GitHub remote | YES | ❌ irrelevant for playing; see §5 |

**Bottom line:** the app itself is already 100% offline-capable — it makes
zero external requests at runtime. The only real problems are (a) how friends
*reach* you without the Cloudflare tunnel, and (b) rebuilding/redeploying
without Docker Hub/npm. Both are solvable with preparation.

---

## 2. Preparation checklist — DO THIS WHILE INTERNET WORKS

1. **Export runnable backups** (repeat after every meaningful change):
   ```bash
   ./scripts/survival-backup.sh
   ```
   This builds a fresh image and writes to `./backups/`:
   - `gamehub-app-<date>.tar.gz` — the complete, tested, runnable app image
     (`docker load` needs no internet, ever)
   - `node22-alpine-<date>.tar.gz` — base image, in case you must rebuild on
     a fresh machine
   - `gathering-hall-<date>.bundle` — the full git history in one file
     (`git clone <file.bundle>` works offline)

   Copy `backups/` to a USB stick and/or a second machine.

2. **Vendor node_modules for offline rebuilds** (optional but recommended —
   lets you *change code* during a blackout, not just run it):
   ```bash
   tar -czf backups/node_modules-$(date +%Y%m%d).tar.gz node_modules \
       shared/node_modules server/node_modules client/node_modules 2>/dev/null
   ```
   With this + the base image tarball you can `npm run build` and
   `docker compose build` fully offline.

3. **Pick your blackout access path** (see §3) and test it ONCE now:
   a LAN game, a router port-forward, or a domestic VPS deploy. Don't debug
   networking for the first time during a blackout.

4. **Know your addresses.** During a blackout you can't use trycloudflare.com
   or most "what is my IP" sites. Write down / bookmark:
   - VM LAN IP: `ip -4 addr show ens33`
   - Router admin page (usually `192.168.1.1`) — shows your WAN IP
   - If you rent one: your domestic VPS IP / `.ir` domain

---

## 3. Runbooks: how friends connect during a blackout

Domestic (Iran↔Iran) routing stays up in a typical international blackout.
Three options, in increasing order of robustness:

### Option A — Same house / LAN (zero preparation)
Friends on your wifi open `http://<VM-LAN-IP>:8080`. Works today; nothing to
do. If the VM is in NAT mode, switch it to **bridged** in the hypervisor so
other devices can reach it.

### Option B — Home hosting over domestic routing (free, medium effort)
Friends elsewhere in Iran connect **directly to your home IP**:

1. Put the VM on a **bridged** adapter (stable LAN IP; consider a DHCP
   reservation in your router).
2. On your router, **port-forward** external `8080` → `<VM-LAN-IP>:8080`.
3. Friends open `http://<your-WAN-IP>:8080`.

Caveats — check these NOW:
- **CGNAT:** many Iranian ISPs put homes behind carrier-grade NAT. If your
  router's WAN IP starts with `100.64–100.127.*` or `10.*`, inbound
  connections can't reach you → use Option C, or ask your ISP for a public
  ("static") IP — in Iran this is a cheap add-on offered by most ISPs.
- **Dynamic IP:** your WAN IP changes on reconnect. Fine for friends — just
  reshare the link in your group chat (domestic messengers keep working).
- The stop of the tunnel is expected — silence the crash-looping container:
  `docker compose stop cloudflared` (or `docker compose up -d app` only).

### Option C — Domestic VPS (most robust, small monthly cost) ⭐ recommended
Rent the cheapest VPS from an **Iranian** provider (ArvanCloud, ParsPack,
Iranserver, …). These stay reachable from all Iranian ISPs during blackouts.
Two ways to use it:

**C1 — host the game ON the VPS** (best: your home connection stops
mattering at all):
```bash
# while internet works: copy the image + compose file up
scp backups/gamehub-app-*.tar.gz docker-compose.yml user@VPS:
# on the VPS (docker must be installed once, while internet works):
gunzip -c gamehub-app-*.tar.gz | docker load
docker compose up -d app          # app only — no cloudflared needed
```
Friends use `http://<vps-ip>:8080` (or put an `.ir` domain in front of it).
Game snapshots live on the VPS volume; everything else works identically.

**C2 — keep hosting at home, use the VPS as a relay** (if you prefer your
home machine): a reverse SSH tunnel replaces cloudflared —
```bash
# on the VPS, once: in /etc/ssh/sshd_config set  GatewayPorts yes  (then restart sshd)
# from the VM (auto-reconnecting loop):
while true; do ssh -N -o ServerAliveInterval=15 -R 0.0.0.0:8080:localhost:8080 user@VPS; sleep 5; done
```
Friends use `http://<vps-ip>:8080`; traffic flows VPS→your VM over the
domestic route. (Works because *outbound* SSH from your home to a domestic
VPS doesn't care about CGNAT.)

---

## 4. Running & rebuilding offline

**Just running** (the normal case): nothing to do. The built image runs
forever without internet:
```bash
docker compose up -d app        # note: app only, skip the tunnel
```

**Restoring onto a fresh machine** (from the USB backups):
```bash
gunzip -c gamehub-app-<date>.tar.gz | docker load
git clone gathering-hall-<date>.bundle gamehub && cd gamehub
docker compose up -d app
```

**Rebuilding after code changes, offline** — requires prep step §2.2:
```bash
gunzip -c node22-alpine-<date>.tar.gz | docker load     # base image
tar -xzf node_modules-<date>.tar.gz                     # vendored deps
npm run build && npm test                                # works offline
docker compose build app                                 # cache-hits the base image
```
(If `npm ci` inside the Dockerfile bothers you offline, build/test on the VM
directly and run via `node server/dist/index.js` — the Dockerfile is a
convenience, not a requirement.)

---

## 5. Code collaboration without GitHub

- `git bundle create latest.bundle --all` → send the file over any domestic
  channel; the other side `git pull latest.bundle main`.
- Or run a bare repo on the domestic VPS as your temporary origin:
  `git init --bare` there, `git remote add iran user@VPS:gamehub.git`.

---

## 6. Blackout-day quick card

```
1. docker compose up -d app          # ensure the game is up (tunnel off)
2. ip -4 addr show ens33             # confirm the VM's address
3. Pick the path you prepared:
     LAN     → share http://<VM-IP>:8080
     Direct  → share http://<WAN-IP>:8080     (needs port-forward, no CGNAT)
     VPS     → share http://<VPS-IP>:8080     (already deployed / ssh -R relay)
4. Friends' seats & running games survive IP changes — the room code and
   their seat tokens do the work; they just need whatever URL currently works.
```

The one thing to remember: **everything about this platform was built to be
self-contained** — no accounts, no third-party APIs, no CDNs. Survival mode
is not a special mode of the software; it's just a different way for packets
to reach the same server.
