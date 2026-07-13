# The Gathering Hall — How the Code Is Designed and Works

This document explains the whole system: the ideas behind it, every layer of
the code, how a move travels from a click to every player's screen, and how to
extend it. It assumes you can read TypeScript but doesn't assume you know this
codebase.

---

## 1. The three big ideas

**1. The server is the only authority.**
Clients never compute game state. They send *intents* ("I attack Alaska from
Kamchatka with 3 dice") and receive back *views*. All rules run on the server.
This makes cheating impossible (a hacked client can only send actions the
server validates) and desyncs impossible (there is exactly one copy of the
truth).

**2. Game engines are pure functions.**
An engine never touches the network, timers, disk, or `Math.random()`. It is
a *reducer*: `(state, action, player) → new state + events`, plus helpers to
ask "what may this player do now?" and "what does this player see?". Purity is
what makes the games testable to death (see §9) and lets game state be
snapshotted to disk and restored exactly.

**3. Determinism everywhere.**
Randomness (dice, shuffles, steals) comes from a seeded PRNG whose *entire
internal state is one 32-bit number stored inside the game state*
(`shared/src/rng.ts`, mulberry32). Same seed + same actions = byte-identical
game, always. This is why replay-style tests work, why snapshots restore
perfectly, and why a "random" blitz of 20 dice rolls can be asserted in a
unit test.

---

## 2. Monorepo layout

```
gamehub/
├── shared/          ← pure TypeScript, ZERO runtime dependencies (except chess.js)
│   └── src/
│       ├── rng.ts             seeded serializable PRNG
│       ├── engine.ts          THE ENGINE CONTRACT (see §3)
│       ├── protocol.ts        every socket event + payload type (see §5)
│       ├── registry.ts        list of GameSpecs the shell iterates over
│       ├── games/
│       │   ├── risk/          mapData, rules/, engine, bot
│       │   ├── chess/         chess.js wrapper engine
│       │   ├── uno/           card encoding + engine
│       │   ├── cotton/        geometry, rules/, engine (Catan)
│       │   └── coinflip/      trivial game used to exercise the shell
│       └── __tests__/         unit + property tests (see §9)
├── server/          ← Express + Socket.IO
│   └── src/
│       ├── index.ts           entrypoint: ports, env, SIGTERM flush
│       ├── app.ts             createApp() factory (also used by tests)
│       ├── roomManager.ts     rooms, seats, tokens, engine hosting
│       ├── socketHandlers.ts  protocol wiring, error guarding
│       ├── persistence.ts     atomic snapshots to disk
│       └── __tests__/         socket-level integration tests
├── client/          ← React 18 + Vite SPA
│   └── src/
│       ├── api/socket.tsx     socket provider: session, reconnect, state
│       ├── api/sounds.ts      local sound effects (ogg + wav fallback)
│       ├── pages/             Home (create/join) → Room (lobby) → Game
│       ├── games/registry.tsx gameId → renderer component + event mappers
│       └── games/<id>/        one renderer per game
├── scripts/         tunnel-url.sh, gen-sounds.mjs, survival-backup.sh
├── Dockerfile       multi-stage; TESTS RUN INSIDE THE BUILD
└── docker-compose.yml   app (:8080) + cloudflared tunnel
```

`shared` is consumed by both `server` (npm workspace link, built to
`shared/dist`) and `client` (bundled by Vite). The protocol and engine types
are therefore *literally the same file* on both sides — the compiler catches
client/server drift.

---

## 3. The engine contract (`shared/src/engine.ts`)

Every game implements one interface. This is the **entire** integration
surface — the shell (server + client pages) knows nothing about any specific
game.

```ts
interface GameEngine<S, A, V, L> {
  setup(cfg: { numPlayers, seed }): S;                  // create initial state
  getLegalActions(state: S, player): L[];               // what may they do NOW?
  reduce(state: S, action: A, player): { state, events } | EngineError;
  view(state: S, viewer: PlayerId | 'spectator'): V;    // REDACTED per-player view
  getCurrentActors(state: S): PlayerId[];               // whose input is awaited
  status(state: S): { phase, terminal, winners, eliminated };
}
```

The pieces, and why each exists:

- **`setup`** — builds the whole starting state from a player count and a
  seed. The RNG state is stored *inside* the returned object.
- **`getLegalActions`** — the single source of truth for "what is allowed".
  The server sends these descriptors to the client, which uses them to enable
  buttons and highlight board spots. The client never re-implements rules; if
  the descriptor says you can build on vertices `[3, 17, 40]`, those pulse.
  Descriptors also make multi-actor moments natural: during Cotton's
  discard-half phase, several players have a non-empty legal list at once.
- **`reduce`** — validates *everything* itself (never trusts the client) and
  either returns the next state plus **semantic events** (`diceRolled`,
  `conquered`, `eliminated`…) or a typed error. Events exist for the log,
  sounds, and animations; they are *not* state (a client that misses events
  still has correct state from the next view).
- **`view`** — redaction. Uno opponents' hands become counts; Risk cards and
  the deck order are hidden; Cotton dev cards stay secret. Server-side
  redaction means private information *never leaves the server*.
- **`resign`** — a universal action every engine accepts from any living
  player, which is also how the host "kicks" an abandoned seat.

Every game also exports a `GameSpec { id, name, minPlayers, maxPlayers,
engineVersion, engine }` and adds itself to `shared/src/registry.ts`.
`engineVersion` gates snapshot restore (§6).

### How a turn flows, end to end

```
 you click a territory
   └► client sends  game:action { seq: 41, action: {type:'attack', …} }   (with ack)
        └► server: RoomManager.action()
             ├─ seq check (41 === room.seq? else ERR_STALE + resync)
             ├─ engine.reduce(state, action, yourSeat)
             │    ├─ invalid → typed EngineError → ack {ok:false, code, message}
             │    └─ valid   → new state + events
             ├─ room.seq++  → 42
             ├─ schedule snapshot to disk (debounced)
             ├─ broadcast  game:events {seq:42, events}          (same for everyone)
             └─ per seat:  game:state  {seq:42, view(seat), legalActions(seat), …}
        └► your ack resolves {ok:true}
   └► every client replaces its state wholesale; events drive log + sounds
```

Two design choices worth noting:

- **Full-view sync, no deltas.** Every broadcast contains the complete
  (redacted) view. A view is a few KB; correctness beats bandwidth here — an
  entire class of "client drifted out of sync" bugs cannot exist.
- **`seq` (per-room monotonic counter).** Actions carry the sender's
  last-seen seq. A stale client gets `ERR_STALE` *plus* an immediate resync
  push, so double-clicks and races resolve themselves.

---

## 4. Randomness (`shared/src/rng.ts`)

`Rng` is mulberry32: `next()` mutates a single `uint32` state and returns a
float. Engines do:

```ts
const rng = new Rng(state.rngState);   // resume from stored state
const roll = rng.d6();
state.rngState = rng.state;            // store back — serialization-safe
```

`shuffle` is Fisher–Yates on top of `next()`. Nothing anywhere calls
`Math.random()` for game logic (only cosmetic things like room-code letters).

---

## 5. The protocol (`shared/src/protocol.ts`)

Request/response uses Socket.IO **acks** (the callback either resolves
`{ok:true,…}` or `{ok:false, code, message}` with codes like
`ERR_NOT_YOUR_TURN`, `ERR_ROOM_FULL`, `ERR_STALE`). Pushes are plain emits.

| Client → Server | Purpose |
|---|---|
| `room:create {name, gameId}` | create room, returns `{code, seatToken, playerId}` |
| `room:join {code, name, seatToken?}` | join / reconnect / spectate |
| `room:configure {gameId}` · `room:start {seed?}` · `room:toLobby` · `room:kick` | host controls |
| `game:action {seq, action}` | THE gameplay message |
| `game:sync` | ask for a full refresh |
| `chat:send {text}` | chat |

| Server → Client | Purpose |
|---|---|
| `room:state` | lobby/seat/presence info (broadcast) |
| `game:state` | seq + per-viewer view + legalActions + currentActors + status |
| `game:events` | semantic events for log/sounds (broadcast) |
| `chat:message` · `session:superseded` | chat; "another tab took your seat" |

---

## 6. The server

### RoomManager (`server/src/roomManager.ts`)

A `Map<code, Room>`. A `Room` holds: 6-char code, gameId, phase
(`lobby → playing → finished`), `seats[]`, spectator socket ids, the engine
`state`, and `seq`.

**Identity without accounts.** A seat is
`{playerId, name, token (uuid), socketId | null}`. The token is returned once
at join and stored in the browser's localStorage keyed by room code.
*Sockets are ephemeral; seats are durable*:

- **Disconnect ≠ leave.** The seat's `socketId` goes null, a badge shows in
  the UI, the game simply waits.
- **Reconnect** = `room:join` with the stored token → the seat re-binds to the
  new socket and gets a full `game:state`. This covers refreshes, wifi drops,
  server restarts, and switching devices.
- **Duplicate tab** with the same token: newest socket wins; the old one gets
  `session:superseded`.
- **Late joiner** to a running game becomes a spectator (spectator view,
  empty legal actions).
- Host = seat 0. Host can start, switch game, kick *disconnected* seats
  (injects the universal `resign`), or abandon to lobby.

### Persistence (`server/src/persistence.ts`)

Every mutation schedules a debounced (2s) snapshot:
`write room-CODE.json.tmp → fsync → rename` (rename is atomic on Linux — a
crash can never leave a half-written file). `SIGTERM` flushes synchronously,
and compose gives a 10s grace period, so `docker compose restart` mid-game
loses nothing. On boot, snapshots are restored; a snapshot whose
`engineVersion` doesn't match the running engine is *dropped loudly* rather
than migrated — version-gating beats silent corruption. Finished games are
garbage-collected after 24h.

Because engines are pure and RNG state lives in the snapshot, a restored game
continues *exactly* where it stopped — same future dice rolls and all.

### Error guarding (`server/src/socketHandlers.ts`)

Every handler is wrapped: any thrown `Fail` (or unexpected exception) becomes
a typed ack. A malformed payload can never crash the process.

---

## 7. The client

### The socket provider (`client/src/api/socket.tsx`)

One React context owns the socket and exposes: `room`, `game` (latest
`game:state`), `events` (latest batch), `log`, `you`, and imperative calls
(`createRoom`, `joinRoom`, `sendAction`…). Key behaviors:

- On socket reconnect it **re-joins automatically** with the stored seat
  token (the server may have restarted; the room is restored from snapshot).
- `game:state` packets older than the current seq are ignored (out-of-order
  safety); newer ones replace the state wholesale.
- Action failures surface as a 4-second toast; a red banner shows whenever the
  connection is down ("your seat and the game are safe").
- An **error boundary** turns any render crash into a readable panel with a
  reload button instead of a white page.

### Pages

`Home` (name + create/join) → `Room` (joins by URL, renders `Lobby` while
`phase==='lobby'`, else `Game`). `Game` looks up the renderer in
`client/src/games/registry.tsx`:

```ts
interface GameUI {
  Table: React.FC<{ extras: ReactNode }>;   // the whole game screen
  describeEvent(e, name): string | null;    // event → log line
  soundFor(e): SoundName | null;            // event → sound effect
}
```

`extras` is a shared block (winner banner, event log, chat, resign/kick
buttons, mute toggle) that every game embeds in its sidebar. Sounds are
played **once per distinct sound per event batch** — a 20-roll Risk blitz
rattles once.

### Game renderers — the pattern

Each renderer reads `game.view` + `game.legalActions` and derives its
interactivity **from the descriptors**, never from re-implemented rules:

- **Risk** (`games/risk/`): stylized hex "parchment atlas" SVG. Coordinates in
  `mapLayout.ts` are the only art asset. Clickable sets come straight from
  legal descriptors (place targets, attack from/to, fortify pairs).
- **Chess**: board parsed from the FEN in the view; solid glyph pieces styled
  by CSS; pointer-event drag & drop *and* click-to-move; promotion picker
  appears when multiple legal moves share from/to.
- **Uno**: hand cards enabled per the `play` descriptor; wild → color picker;
  "you drew X — play it or pass" flow mirrors the engine's `drawnCard` state.
- **Cotton**: board geometry (positions of 54 vertices / 72 edges) is imported
  from the *shared* geometry module — the client can't disagree with the
  server about where things are. Build buttons enter a placement mode that
  highlights exactly the legal spots; dialogs handle discards, robber victims,
  trades, and dev-card choices.

---

## 8. Per-game engine notes

**Risk** (`shared/src/games/risk/`) — classic World Domination. `mapData.ts`
hand-encodes the 42-territory adjacency graph (validated by symmetry/
connectivity tests). All starting armies are auto-placed randomly (a
deliberate UX choice); turns are reinforce → attack (dice, blitz loop,
conquest move, elimination + card handover, forced trades at 6+ cards) →
connected-path fortify. Escalating global trade values (4,6,8,10,12,15,+5…).

**Chess** (`games/chess/`) — rules are delegated to the battle-tested
`chess.js`. State = optional start FEN + the move list; the position is
*replayed* on demand, which makes history-dependent draws (threefold,
50-move) exact. Seat colors assigned by seed.

**Uno** (`games/uno/`) — the 108-card deck is a pure *encoding*: card id →
(color, kind, number) by arithmetic, so the deck composition is a theorem,
not data. Skip/reverse/+2/wilds apply their penalties immediately (victims
are skipped), which keeps the game single-actor. 2-player reverse = skip.

**Cotton** (`games/cotton/`) — full Settlers. The board geometry is **derived,
not hand-typed**: hexes live on an axial grid, and every vertex gets an exact
integer label (the N or S corner of some hex), from which vertices, edges,
adjacency, coast, and ports are computed. Tests then assert the classic
counts (19/54/72/30) — a typo'd board cannot exist. Longest road is a real
DFS over the player's road subgraph (opponents' buildings sever paths);
production implements the official bank-shortage rule; trades cover bank
(4:1), harbors (3:1/2:1), and player offers (first accept wins). Victory at
10 VP counts hidden VP cards, checked only on the current player's actions.

---

## 9. Testing strategy — why "it works" is a claim, not a hope

Four layers, ~122 tests, and **the Docker image cannot be produced if any
fail** (they run inside the build):

1. **Structural invariants** — board geometry counts, adjacency symmetry, deck
   compositions. Catches data typos.
2. **Per-rule unit tests** — every rule the docs above mention has a test:
   trade schedules, forced trades, dethroning of longest-road, bank shortage,
   stalemate/threefold, 2-player Uno reverse, etc.
3. **Property tests** — the crown jewel. Seeded random-but-legal bots play
   *complete games* (dozens per suite run), and after **every single action**
   invariants are checked: resource/card conservation, piece limits, no
   negative counts, termination, and same-seed ⇒ identical-final-state.
4. **Socket integration** — real Socket.IO clients play full games through
   the actual server: a 4-bot Risk game to a winner *including a mid-game
   disconnect/reconnect*, chess fool's mate over the wire, snapshot
   restore across a simulated server restart, stale/illegal/spectator
   rejections.

---

## 10. Deployment

Multi-stage `Dockerfile`: build stage installs, compiles, **runs all tests**;
runtime stage is a slim node:22-alpine with only production deps and the
built artifacts. `docker-compose.yml` runs:

- **app** — port 8080, `/healthz` healthcheck, `restart: unless-stopped`,
  snapshots on the `gamehub-data` volume, `stop_grace_period: 10s` (pairs
  with the SIGTERM snapshot flush).
- **cloudflared** — a free "quick tunnel" giving a public
  `https://….trycloudflare.com` URL (printed by `scripts/tunnel-url.sh`).
  Forced to `--protocol http2` because QUIC/UDP is blocked on this network.

Caching: hashed assets are `immutable, 30d`; `index.html` and sounds are
`no-cache` — deploys are picked up on a normal refresh, never a stale blank
page.

The app itself makes **zero external requests** (fonts self-hosted, sounds
local, everything bundled) — see `docs/SURVIVAL.md` for why that matters.

---

## 11. How to add a new game (the recipe)

1. `shared/src/games/<id>/engine.ts` — implement `GameEngine` + export a
   `GameSpec`. Keep it pure; RNG state inside the game state.
2. Add the spec to `shared/src/registry.ts` and export from `index.ts`.
3. Write tests: structural invariants, per-rule units, and a property test
   with a random-legal bot playing to termination.
4. `client/src/games/<id>/YourTable.tsx` — a renderer reading
   `view` + `legalActions`; implement `describeEvent` and `soundFor`.
5. Register it in `client/src/games/registry.tsx`.

That's it — rooms, seats, reconnect, spectators, persistence, chat, sounds,
and deployment come for free.
