# 🏰 The Gathering Hall

A self-hosted multiplayer board-game platform for playing with friends in the
browser — no accounts, just a room code.

## The games

| Game | Players | Notes |
|---|---|---|
| 🏝 **Colonies of Cotton** | 3–4 | Full Settlers rules: snake draft, robber, dev cards, longest road / largest army, harbor & player trading, 10 VP |
| 🌍 **Dominion** (Risk) | 3–6 | Classic World Domination: escalating card trades, blitz dice, connected-path fortify |
| ♟ **Chess** | 2 | chess.js rules, drag & drop or click-to-move, all draw rules |
| 🃏 **Uno** | 2–8 | Official 108-card rules, draw-then-play, 2-player reverse = skip |

## How it works

- **npm-workspaces monorepo** — `shared/` (pure TypeScript game engines + typed
  socket protocol), `server/` (Express + Socket.IO), `client/` (React + Vite)
- **Server-authoritative**: every move is validated by a pure engine reducer;
  clients only ever see their own redacted view (no peeking at hands)
- **Deterministic**: seeded serializable RNG lives inside game state — replays,
  snapshots, and tests are exact
- **Reconnect-proof**: seat tokens in localStorage; refresh mid-game and get
  your seat back. Games snapshot to disk and survive server restarts
- **One contract, many games**: engines implement
  `setup / getLegalActions / reduce / view / getCurrentActors / status` and
  register in one line — adding a game touches nothing else
- **Tested hard**: 122 tests — per-rule units, seeded random full-game property
  tests with invariants checked after every action, socket-level integration
  (including mid-game disconnect/reconnect). The Docker image cannot build if
  any test fails

## Run it

```bash
docker compose up -d          # app on :8080 + cloudflared quick tunnel
./scripts/tunnel-url.sh       # print the public https URL for friends
```

Local development:

```bash
npm install
npm test                      # engine + integration suites
npm run dev:server            # API + sockets on :8080
npm run dev:client            # Vite dev server with proxy
```

## Sounds

Recorded effects are CC0 from [Kenney](https://kenney.nl) asset packs, with
locally-synthesized WAV fallbacks (`scripts/gen-sounds.mjs`) for browsers
without ogg support.
