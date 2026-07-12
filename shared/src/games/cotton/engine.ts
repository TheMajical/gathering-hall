/**
 * Cotton — full classic Settlers rules, 3-4 players: snake-draft setup with
 * starting resources, dice production with the official bank-shortage rule,
 * 7-roll discard-half → robber → steal, building with distance rule and piece
 * limits, dev cards (one per turn, not on the turn bought), longest road /
 * largest army with proper dethroning, bank/port trades, simple player trades
 * (offer → first accept wins), victory at 10 VP counting hidden VP cards.
 */
import {
  engineError,
  type EngineError,
  type EngineStatus,
  type GameEngine,
  type GameEvent,
  type GameSpec,
  type PlayerId,
  type ReduceResult,
  type SetupConfig,
  type Viewer,
} from '../../engine.js';
import { Rng } from '../../rng.js';
import {
  EDGE_VERTICES,
  HEXES,
  HEX_VERTICES,
  NUM_EDGES,
  NUM_VERTICES,
  PORTS,
  VERTEX_EDGES,
} from './geometry.js';
import {
  canAfford,
  longestRoadLength,
  pay,
  playersOnHex,
  points,
  produce,
  roadSpots,
  settlementSpots,
  tradeRates,
  vertexOpen,
} from './rules/helpers.js';
import {
  COSTS,
  HAND_LIMIT,
  LIMITS,
  RESOURCES,
  VICTORY_POINTS,
  totalRes,
  zeroDev,
  zeroRes,
  type CottonAction,
  type CottonLegal,
  type CottonState,
  type CottonView,
  type DevCard,
  type Resource,
  type ResourceCounts,
} from './types.js';

const err = engineError;

const TERRAIN_POOL = [
  'lumber', 'lumber', 'lumber', 'lumber',
  'wool', 'wool', 'wool', 'wool',
  'grain', 'grain', 'grain', 'grain',
  'brick', 'brick', 'brick',
  'ore', 'ore', 'ore',
  'desert',
] as const;
const TOKEN_POOL = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
const DEV_POOL: DevCard[] = [
  ...Array(14).fill('knight'),
  ...Array(5).fill('vp'),
  'roadBuilding', 'roadBuilding',
  'yearOfPlenty', 'yearOfPlenty',
  'monopoly', 'monopoly',
] as DevCard[];

function current(state: CottonState): PlayerId {
  return state.turnOrder[state.currentIdx]!;
}

/** Snake order through both setup rounds: 0,1,..,n-1,n-1,..,1,0. */
function snakePlayer(state: CottonState): PlayerId {
  const n = state.numPlayers;
  const i = state.setupIdx;
  return state.turnOrder[i < n ? i : 2 * n - 1 - i]!;
}

function living(state: CottonState): PlayerId[] {
  return state.eliminated.map((e, i) => (e ? -1 : i)).filter((i) => i >= 0);
}

function pieces(state: CottonState, player: PlayerId): { settlements: number; cities: number; roads: number } {
  let settlements = 0;
  let cities = 0;
  for (const b of state.buildings) {
    if (b?.owner === player) b.city ? cities++ : settlements++;
  }
  const roads = state.roads.filter((o) => o === player).length;
  return { settlements, cities, roads };
}

function availableDev(state: CottonState, player: PlayerId, card: DevCard): boolean {
  return state.devHands[player]![card] - (current(state) === player ? state.devFresh[card] : 0) >= 1;
}

function updateLongestRoad(state: CottonState, events: GameEvent[]): void {
  const lens = Array.from({ length: state.numPlayers }, (_, p) =>
    state.eliminated[p] ? 0 : longestRoadLength(state, p),
  );
  const maxLen = Math.max(...lens);
  const holder = state.longestRoad;
  let next: PlayerId | null = holder;
  if (holder !== null && lens[holder]! >= 5 && lens[holder]! >= maxLen) {
    next = holder; // ties keep the crown
  } else if (maxLen >= 5) {
    const leaders = lens.map((l, p) => (l === maxLen ? p : -1)).filter((p) => p >= 0);
    next = leaders.length === 1 ? leaders[0]! : null; // contested tie → nobody
  } else {
    next = null;
  }
  if (next !== holder) {
    state.longestRoad = next;
    events.push({ type: 'longestRoad', player: next });
  }
  state.longestRoadLength = next === null ? 0 : lens[next]!;
}

function updateLargestArmy(state: CottonState, player: PlayerId, events: GameEvent[]): void {
  const mine = state.playedKnights[player]!;
  if (mine < 3) return;
  const holder = state.largestArmy;
  if (holder === null || (holder !== player && mine > state.playedKnights[holder]!)) {
    state.largestArmy = player;
    events.push({ type: 'largestArmy', player });
  }
}

function checkVictory(state: CottonState, player: PlayerId, events: GameEvent[]): void {
  if (state.winner !== null) return;
  if (points(state, player, true) >= VICTORY_POINTS) {
    state.winner = player;
    state.phase = 'game_over';
    events.push({ type: 'gameOver', player });
  }
}

function beginTurn(state: CottonState, events: GameEvent[]): void {
  state.phase = 'roll';
  state.devPlayedThisTurn = false;
  state.devFresh = zeroDev();
  state.tradeOffer = null;
  state.roadBuildingRoadsLeft = 0;
  events.push({ type: 'turnStarted', player: current(state) });
}

function endTurnInternal(state: CottonState, events: GameEvent[]): void {
  do {
    state.currentIdx = (state.currentIdx + 1) % state.turnOrder.length;
  } while (state.eliminated[current(state)]);
  beginTurn(state, events);
}

export const cottonEngine: GameEngine<CottonState, CottonAction, CottonView, CottonLegal> = {
  setup({ numPlayers, seed }: SetupConfig): CottonState {
    if (numPlayers < 3 || numPlayers > 4) throw new Error(`Cotton supports 3-4 players, got ${numPlayers}`);
    const rng = new Rng(seed);
    const terrains = rng.shuffle(TERRAIN_POOL);
    const tokens = rng.shuffle(TOKEN_POOL);
    let t = 0;
    const hexes = HEXES.map((_, i) => {
      const terrain = terrains[i]!;
      return { terrain, token: terrain === 'desert' ? null : tokens[t++]! };
    });
    return {
      rngState: rng.state,
      numPlayers,
      phase: 'setup',
      turnOrder: rng.shuffle(Array.from({ length: numPlayers }, (_, i) => i)),
      currentIdx: 0,
      hexes,
      robberHex: hexes.findIndex((h) => h.terrain === 'desert'),
      buildings: Array(NUM_VERTICES).fill(null),
      roads: Array(NUM_EDGES).fill(null),
      hands: Array.from({ length: numPlayers }, () => zeroRes()),
      bank: { brick: 19, lumber: 19, wool: 19, grain: 19, ore: 19 },
      devDeck: rng.shuffle(DEV_POOL),
      devHands: Array.from({ length: numPlayers }, () => zeroDev()),
      devFresh: zeroDev(),
      devPlayedThisTurn: false,
      playedKnights: Array(numPlayers).fill(0),
      largestArmy: null,
      longestRoad: null,
      longestRoadLength: 0,
      setupIdx: 0,
      setupNeedRoad: false,
      setupLastSettlement: null,
      discardsOwed: Array(numPlayers).fill(0),
      lastRoll: null,
      roadBuildingRoadsLeft: 0,
      tradeOffer: null,
      eliminated: Array(numPlayers).fill(false),
      winner: null,
    };
  },

  getLegalActions(state, player): CottonLegal[] {
    if (state.phase === 'game_over' || state.eliminated[player]) return [];
    const resign: CottonLegal = { type: 'resign' };

    if (state.phase === 'discard') {
      if (state.discardsOwed[player]! > 0) return [{ type: 'discard', count: state.discardsOwed[player]! }, resign];
      return [resign];
    }

    if (state.phase === 'setup') {
      if (snakePlayer(state) !== player) return [resign];
      if (state.setupNeedRoad) {
        const edges = VERTEX_EDGES[state.setupLastSettlement!]!.filter((e) => state.roads[e] === null);
        return [{ type: 'placeRoad', edges }, resign];
      }
      const vertices: number[] = [];
      for (let v = 0; v < NUM_VERTICES; v++) if (vertexOpen(state, v)) vertices.push(v);
      return [{ type: 'placeSettlement', vertices }, resign];
    }

    if (player !== current(state)) {
      const legal: CottonLegal[] = [];
      if (
        state.phase === 'main' &&
        state.tradeOffer &&
        RESOURCES.every((r) => state.hands[player]![r] >= state.tradeOffer!.want[r])
      ) {
        legal.push({ type: 'acceptTrade' });
      }
      legal.push(resign);
      return legal;
    }

    switch (state.phase) {
      case 'roll':
        return [{ type: 'roll' }, resign];
      case 'robber': {
        const hexes = HEXES.map((h) => h.id).filter((h) => h !== state.robberHex);
        return [{ type: 'moveRobber', hexes }, resign];
      }
      case 'roadBuilding':
        return [{ type: 'placeRoad', edges: roadSpots(state, player) }, resign];
      case 'main': {
        const legal: CottonLegal[] = [];
        const hand = state.hands[player]!;
        const have = pieces(state, player);
        if (canAfford(hand, COSTS.road) && have.roads < LIMITS.roads) {
          const edges = roadSpots(state, player);
          if (edges.length > 0) legal.push({ type: 'buildRoad', edges });
        }
        if (canAfford(hand, COSTS.settlement) && have.settlements < LIMITS.settlements) {
          const vertices = settlementSpots(state, player);
          if (vertices.length > 0) legal.push({ type: 'buildSettlement', vertices });
        }
        if (canAfford(hand, COSTS.city) && have.cities < LIMITS.cities) {
          const vertices: number[] = [];
          state.buildings.forEach((b, v) => {
            if (b?.owner === player && !b.city) vertices.push(v);
          });
          if (vertices.length > 0) legal.push({ type: 'buildCity', vertices });
        }
        if (canAfford(hand, COSTS.dev) && state.devDeck.length > 0) legal.push({ type: 'buyDev' });
        if (!state.devPlayedThisTurn) {
          if (availableDev(state, player, 'knight')) legal.push({ type: 'playKnight' });
          if (availableDev(state, player, 'roadBuilding') && roadSpots(state, player).length > 0 && have.roads < LIMITS.roads) {
            legal.push({ type: 'playRoadBuilding' });
          }
          if (availableDev(state, player, 'yearOfPlenty')) legal.push({ type: 'playYearOfPlenty' });
          if (availableDev(state, player, 'monopoly')) legal.push({ type: 'playMonopoly' });
        }
        const rates = tradeRates(state, player);
        if (RESOURCES.some((r) => hand[r] >= rates[r])) legal.push({ type: 'bankTrade', rates });
        if (totalRes(hand) > 0) legal.push({ type: 'offerTrade' });
        if (state.tradeOffer) legal.push({ type: 'cancelTrade' });
        legal.push({ type: 'endTurn' }, resign);
        return legal;
      }
      default:
        return [resign];
    }
  },

  reduce(prev, action, player): ReduceResult<CottonState> | EngineError {
    if (prev.phase === 'game_over') return err('ERR_ILLEGAL_ACTION', 'Game is over.');
    if (prev.eliminated[player]) return err('ERR_ILLEGAL_ACTION', 'You are out of the game.');
    const state = structuredClone(prev);
    const events: GameEvent[] = [];

    // ---------- resign (any living player, any time) ----------
    if (action.type === 'resign') {
      state.eliminated[player] = true;
      for (const r of RESOURCES) {
        state.bank[r] += state.hands[player]![r];
        state.hands[player]![r] = 0;
      }
      state.discardsOwed[player] = 0;
      events.push({ type: 'resigned', player });
      const alive = living(state);
      if (alive.length === 1) {
        state.winner = alive[0]!;
        state.phase = 'game_over';
        events.push({ type: 'gameOver', player: state.winner });
        return { state, events };
      }
      if (state.phase === 'discard') {
        if (state.discardsOwed.every((d) => d === 0)) state.phase = 'robber';
        if (state.eliminated[current(state)]) endTurnInternal(state, events);
        return { state, events };
      }
      if (state.phase === 'setup') {
        // A resign during setup would corrupt the snake; treat as full forfeit
        // and let the remaining players restart from the lobby if they wish.
        if (snakePlayer(state) === player) {
          return { state, events }; // seat dead; host can abandon to lobby
        }
        return { state, events };
      }
      if (current(state) === player) endTurnInternal(state, events);
      updateLongestRoad(state, events);
      return { state, events };
    }

    // ---------- multi-actor: discard ----------
    if (state.phase === 'discard') {
      if (action.type !== 'discard') return err('ERR_ILLEGAL_ACTION', 'Waiting for discards.');
      const owed = state.discardsOwed[player]!;
      if (owed === 0) return err('ERR_ILLEGAL_ACTION', 'You have nothing to discard.');
      const res = action.resources ?? {};
      let sum = 0;
      for (const r of RESOURCES) {
        const c = res[r] ?? 0;
        if (!Number.isInteger(c) || c < 0 || c > state.hands[player]![r]) {
          return err('ERR_ILLEGAL_ACTION', 'Invalid discard.');
        }
        sum += c;
      }
      if (sum !== owed) return err('ERR_ILLEGAL_ACTION', `You must discard exactly ${owed} cards.`);
      for (const r of RESOURCES) {
        const c = res[r] ?? 0;
        state.hands[player]![r] -= c;
        state.bank[r] += c;
      }
      state.discardsOwed[player] = 0;
      events.push({ type: 'discarded', player, count: owed });
      if (state.discardsOwed.every((d) => d === 0)) state.phase = 'robber';
      return { state, events };
    }

    // ---------- setup snake ----------
    if (state.phase === 'setup') {
      if (snakePlayer(state) !== player) return err('ERR_NOT_YOUR_TURN', 'Not your placement.');
      if (action.type === 'placeSettlement') {
        if (state.setupNeedRoad) return err('ERR_ILLEGAL_ACTION', 'Place your road first.');
        if (!vertexOpen(state, action.vertex)) return err('ERR_ILLEGAL_ACTION', 'That spot is not available.');
        state.buildings[action.vertex] = { owner: player, city: false };
        state.setupNeedRoad = true;
        state.setupLastSettlement = action.vertex;
        events.push({ type: 'built', player, what: 'settlement', vertex: action.vertex });
        if (state.setupIdx >= state.numPlayers) {
          // second-round settlement grants starting resources
          for (const h of HEX_VERTICES.map((vs, hid) => (vs.includes(action.vertex) ? hid : -1)).filter((h) => h >= 0)) {
            const terrain = state.hexes[h]!.terrain;
            if (terrain !== 'desert' && state.bank[terrain as Resource] > 0) {
              state.hands[player]![terrain as Resource]++;
              state.bank[terrain as Resource]--;
            }
          }
          events.push({ type: 'startingResources', player });
        }
        return { state, events };
      }
      if (action.type === 'placeRoad') {
        if (!state.setupNeedRoad) return err('ERR_ILLEGAL_ACTION', 'Place your settlement first.');
        const v = state.setupLastSettlement!;
        if (!VERTEX_EDGES[v]!.includes(action.edge) || state.roads[action.edge] !== null) {
          return err('ERR_ILLEGAL_ACTION', 'The road must touch your new settlement.');
        }
        state.roads[action.edge] = player;
        state.setupNeedRoad = false;
        state.setupLastSettlement = null;
        events.push({ type: 'built', player, what: 'road', edge: action.edge });
        state.setupIdx++;
        if (state.setupIdx >= 2 * state.numPlayers) {
          state.currentIdx = 0;
          beginTurn(state, events);
        }
        return { state, events };
      }
      return err('ERR_ILLEGAL_ACTION', 'Finish the setup placements first.');
    }

    if (player !== current(state)) {
      // ---------- out-of-turn: accept a trade ----------
      if (action.type === 'acceptTrade') {
        if (state.phase !== 'main' || !state.tradeOffer) return err('ERR_ILLEGAL_ACTION', 'No open trade offer.');
        const offer = state.tradeOffer;
        const proposer = current(state);
        for (const r of RESOURCES) {
          if (state.hands[player]![r] < offer.want[r]) return err('ERR_ILLEGAL_ACTION', 'You cannot cover that trade.');
          if (state.hands[proposer]![r] < offer.give[r]) return err('ERR_ILLEGAL_ACTION', 'Offer is no longer valid.');
        }
        for (const r of RESOURCES) {
          state.hands[proposer]![r] += offer.want[r] - offer.give[r];
          state.hands[player]![r] += offer.give[r] - offer.want[r];
        }
        state.tradeOffer = null;
        events.push({ type: 'tradeAccepted', player, with: proposer });
        return { state, events };
      }
      return err('ERR_NOT_YOUR_TURN', 'Not your turn.');
    }

    // ---------- current player ----------
    switch (action.type) {
      case 'roll': {
        if (state.phase !== 'roll') return err('ERR_ILLEGAL_ACTION', 'You already rolled.');
        const rng = new Rng(state.rngState);
        const d1 = rng.d6();
        const d2 = rng.d6();
        state.rngState = rng.state;
        state.lastRoll = [d1, d2];
        const total = d1 + d2;
        events.push({ type: 'diceRolled', player, d1, d2, total });
        if (total === 7) {
          for (let p = 0; p < state.numPlayers; p++) {
            const n = totalRes(state.hands[p]!);
            state.discardsOwed[p] = !state.eliminated[p] && n > HAND_LIMIT ? Math.floor(n / 2) : 0;
          }
          state.phase = state.discardsOwed.some((d) => d > 0) ? 'discard' : 'robber';
        } else {
          const produced = produce(state, total);
          for (const p of produced) events.push({ type: 'produced', player: p.player, gained: p.gained });
          state.phase = 'main';
        }
        return { state, events };
      }

      case 'moveRobber': {
        if (state.phase !== 'robber') return err('ERR_ILLEGAL_ACTION', 'The robber is not on the move.');
        const { hex } = action;
        const victim = action.victim ?? null;
        if (!Number.isInteger(hex) || hex < 0 || hex >= HEXES.length || hex === state.robberHex) {
          return err('ERR_ILLEGAL_ACTION', 'Move the robber to a different hex.');
        }
        state.robberHex = hex;
        events.push({ type: 'robberMoved', player, hex });
        const victims = playersOnHex(state, hex, player);
        if (victim !== null) {
          if (!victims.includes(victim)) return err('ERR_ILLEGAL_ACTION', 'No stealable player there.');
          const hand = state.hands[victim]!;
          const cards: Resource[] = RESOURCES.flatMap((r) => Array(hand[r]).fill(r));
          const rng = new Rng(state.rngState);
          const stolen = cards[rng.int(cards.length)]!;
          state.rngState = rng.state;
          hand[stolen]--;
          state.hands[player]![stolen]++;
          events.push({ type: 'stole', player, victim });
        } else if (victims.length > 0) {
          return err('ERR_ILLEGAL_ACTION', 'You must steal from a player on that hex.');
        }
        state.phase = 'main';
        return { state, events };
      }

      case 'placeRoad': {
        if (state.phase !== 'roadBuilding') return err('ERR_ILLEGAL_ACTION', 'Not placing free roads.');
        if (!roadSpots(state, player).includes(action.edge)) return err('ERR_ILLEGAL_ACTION', 'Invalid road spot.');
        state.roads[action.edge] = player;
        events.push({ type: 'built', player, what: 'road', edge: action.edge });
        state.roadBuildingRoadsLeft--;
        const have = pieces(state, player);
        if (state.roadBuildingRoadsLeft <= 0 || have.roads >= LIMITS.roads || roadSpots(state, player).length === 0) {
          state.roadBuildingRoadsLeft = 0;
          state.phase = 'main';
        }
        updateLongestRoad(state, events);
        checkVictory(state, player, events);
        return { state, events };
      }

      case 'buildRoad': {
        if (state.phase !== 'main') return err('ERR_ILLEGAL_ACTION', 'Build during your main phase.');
        if (!canAfford(state.hands[player]!, COSTS.road)) return err('ERR_ILLEGAL_ACTION', 'Costs 1 brick + 1 lumber.');
        if (pieces(state, player).roads >= LIMITS.roads) return err('ERR_ILLEGAL_ACTION', 'No road pieces left.');
        if (!roadSpots(state, player).includes(action.edge)) return err('ERR_ILLEGAL_ACTION', 'Invalid road spot.');
        pay(state.hands[player]!, state.bank, COSTS.road);
        state.roads[action.edge] = player;
        events.push({ type: 'built', player, what: 'road', edge: action.edge });
        updateLongestRoad(state, events);
        checkVictory(state, player, events);
        return { state, events };
      }

      case 'buildSettlement': {
        if (state.phase !== 'main') return err('ERR_ILLEGAL_ACTION', 'Build during your main phase.');
        if (!canAfford(state.hands[player]!, COSTS.settlement)) {
          return err('ERR_ILLEGAL_ACTION', 'Costs brick + lumber + wool + grain.');
        }
        if (pieces(state, player).settlements >= LIMITS.settlements) {
          return err('ERR_ILLEGAL_ACTION', 'No settlement pieces left (upgrade to cities).');
        }
        if (!settlementSpots(state, player).includes(action.vertex)) {
          return err('ERR_ILLEGAL_ACTION', 'Needs your road and 2 spaces from other buildings.');
        }
        pay(state.hands[player]!, state.bank, COSTS.settlement);
        state.buildings[action.vertex] = { owner: player, city: false };
        events.push({ type: 'built', player, what: 'settlement', vertex: action.vertex });
        updateLongestRoad(state, events); // may sever an opponent's road
        checkVictory(state, player, events);
        return { state, events };
      }

      case 'buildCity': {
        if (state.phase !== 'main') return err('ERR_ILLEGAL_ACTION', 'Build during your main phase.');
        if (!canAfford(state.hands[player]!, COSTS.city)) return err('ERR_ILLEGAL_ACTION', 'Costs 3 ore + 2 grain.');
        if (pieces(state, player).cities >= LIMITS.cities) return err('ERR_ILLEGAL_ACTION', 'No city pieces left.');
        const b = state.buildings[action.vertex];
        if (!b || b.owner !== player || b.city) return err('ERR_ILLEGAL_ACTION', 'Upgrade one of your settlements.');
        pay(state.hands[player]!, state.bank, COSTS.city);
        b.city = true;
        events.push({ type: 'built', player, what: 'city', vertex: action.vertex });
        checkVictory(state, player, events);
        return { state, events };
      }

      case 'buyDev': {
        if (state.phase !== 'main') return err('ERR_ILLEGAL_ACTION', 'Buy during your main phase.');
        if (!canAfford(state.hands[player]!, COSTS.dev)) return err('ERR_ILLEGAL_ACTION', 'Costs ore + wool + grain.');
        if (state.devDeck.length === 0) return err('ERR_ILLEGAL_ACTION', 'No development cards left.');
        pay(state.hands[player]!, state.bank, COSTS.dev);
        const card = state.devDeck.pop()!;
        state.devHands[player]![card]++;
        state.devFresh[card]++;
        events.push({ type: 'devBought', player });
        checkVictory(state, player, events); // a bought VP card can win on the spot
        return { state, events };
      }

      case 'playKnight': {
        const e = requireDev(state, player, 'knight');
        if (e) return e;
        state.devHands[player]!.knight--;
        state.devPlayedThisTurn = true;
        state.playedKnights[player]!++;
        events.push({ type: 'devPlayed', player, card: 'knight' });
        updateLargestArmy(state, player, events);
        state.phase = 'robber';
        checkVictory(state, player, events);
        return { state, events };
      }

      case 'playRoadBuilding': {
        const e = requireDev(state, player, 'roadBuilding');
        if (e) return e;
        if (roadSpots(state, player).length === 0 || pieces(state, player).roads >= LIMITS.roads) {
          return err('ERR_ILLEGAL_ACTION', 'You have nowhere to build roads.');
        }
        state.devHands[player]!.roadBuilding--;
        state.devPlayedThisTurn = true;
        state.roadBuildingRoadsLeft = Math.min(2, LIMITS.roads - pieces(state, player).roads);
        state.phase = 'roadBuilding';
        events.push({ type: 'devPlayed', player, card: 'roadBuilding' });
        return { state, events };
      }

      case 'playYearOfPlenty': {
        const e = requireDev(state, player, 'yearOfPlenty');
        if (e) return e;
        const { a, b } = action;
        if (!RESOURCES.includes(a) || !RESOURCES.includes(b)) return err('ERR_ILLEGAL_ACTION', 'Pick two resources.');
        const need = zeroRes();
        need[a]++;
        need[b]++;
        if (RESOURCES.some((r) => state.bank[r] < need[r])) return err('ERR_ILLEGAL_ACTION', 'The bank is short.');
        state.devHands[player]!.yearOfPlenty--;
        state.devPlayedThisTurn = true;
        state.hands[player]![a]++;
        state.hands[player]![b]++;
        state.bank[a]--;
        state.bank[b]--;
        events.push({ type: 'devPlayed', player, card: 'yearOfPlenty', a, b });
        return { state, events };
      }

      case 'playMonopoly': {
        const e = requireDev(state, player, 'monopoly');
        if (e) return e;
        const { resource } = action;
        if (!RESOURCES.includes(resource)) return err('ERR_ILLEGAL_ACTION', 'Pick a resource.');
        state.devHands[player]!.monopoly--;
        state.devPlayedThisTurn = true;
        let took = 0;
        for (let p = 0; p < state.numPlayers; p++) {
          if (p === player || state.eliminated[p]) continue;
          took += state.hands[p]![resource];
          state.hands[player]![resource] += state.hands[p]![resource];
          state.hands[p]![resource] = 0;
        }
        events.push({ type: 'devPlayed', player, card: 'monopoly', resource, took });
        return { state, events };
      }

      case 'bankTrade': {
        if (state.phase !== 'main') return err('ERR_ILLEGAL_ACTION', 'Trade during your main phase.');
        const { give, want } = action;
        if (!RESOURCES.includes(give) || !RESOURCES.includes(want) || give === want) {
          return err('ERR_ILLEGAL_ACTION', 'Invalid trade.');
        }
        const rate = tradeRates(state, player)[give];
        if (state.hands[player]![give] < rate) return err('ERR_ILLEGAL_ACTION', `You need ${rate} ${give}.`);
        if (state.bank[want] < 1) return err('ERR_ILLEGAL_ACTION', 'The bank is out of that resource.');
        state.hands[player]![give] -= rate;
        state.bank[give] += rate;
        state.bank[want]--;
        state.hands[player]![want]++;
        events.push({ type: 'bankTraded', player, give, want, rate });
        return { state, events };
      }

      case 'offerTrade': {
        if (state.phase !== 'main') return err('ERR_ILLEGAL_ACTION', 'Trade during your main phase.');
        const give = normalize(action.give);
        const want = normalize(action.want);
        if (totalRes(give) === 0 || totalRes(want) === 0) return err('ERR_ILLEGAL_ACTION', 'Offer something for something.');
        if (RESOURCES.some((r) => state.hands[player]![r] < give[r])) {
          return err('ERR_ILLEGAL_ACTION', 'You do not have those resources.');
        }
        state.tradeOffer = { give, want };
        events.push({ type: 'tradeOffered', player, give, want });
        return { state, events };
      }

      case 'cancelTrade': {
        if (!state.tradeOffer) return err('ERR_ILLEGAL_ACTION', 'No open offer.');
        state.tradeOffer = null;
        events.push({ type: 'tradeCancelled', player });
        return { state, events };
      }

      case 'acceptTrade':
        return err('ERR_ILLEGAL_ACTION', 'You cannot accept your own offer.');

      case 'endTurn': {
        if (state.phase !== 'main') return err('ERR_ILLEGAL_ACTION', 'Finish the current phase first.');
        endTurnInternal(state, events);
        return { state, events };
      }

      default:
        return err('ERR_ILLEGAL_ACTION', 'Unknown action.');
    }
  },

  view(state, viewer: Viewer): CottonView {
    const me = viewer === 'spectator' ? null : viewer;
    return {
      numPlayers: state.numPlayers,
      phase: state.phase,
      turnOrder: state.turnOrder,
      current: state.phase === 'setup' ? snakePlayer(state) : current(state),
      hexes: state.hexes,
      robberHex: state.robberHex,
      buildings: state.buildings,
      roads: state.roads,
      ports: PORTS,
      players: Array.from({ length: state.numPlayers }, (_, p) => {
        const have = pieces(state, p);
        return {
          playerId: p,
          visiblePoints: points(state, p, false),
          handSize: totalRes(state.hands[p]!),
          devCount: Object.values(state.devHands[p]!).reduce((a, b) => a + b, 0),
          playedKnights: state.playedKnights[p]!,
          roadLength: longestRoadLength(state, p),
          settlementsLeft: LIMITS.settlements - have.settlements,
          citiesLeft: LIMITS.cities - have.cities,
          roadsLeft: LIMITS.roads - have.roads,
          eliminated: state.eliminated[p]!,
        };
      }),
      largestArmy: state.largestArmy,
      longestRoad: state.longestRoad,
      hand: me === null ? zeroRes() : state.hands[me]!,
      devHand: me === null ? zeroDev() : state.devHands[me]!,
      devFresh: me !== null && me === current(state) ? state.devFresh : zeroDev(),
      myPoints: me === null ? 0 : points(state, me, true),
      bank: state.bank,
      devDeckCount: state.devDeck.length,
      lastRoll: state.lastRoll,
      discardsOwed: state.discardsOwed,
      tradeOffer: state.tradeOffer,
      roadBuildingRoadsLeft: state.roadBuildingRoadsLeft,
      setupNeedRoad: state.setupNeedRoad,
      winner: state.winner,
    };
  },

  getCurrentActors(state) {
    if (state.phase === 'game_over') return [];
    if (state.phase === 'setup') return [snakePlayer(state)];
    if (state.phase === 'discard') {
      return state.discardsOwed.map((d, p) => (d > 0 ? p : -1)).filter((p) => p >= 0);
    }
    return [current(state)];
  },

  status(state): EngineStatus {
    return {
      phase: state.phase,
      terminal: state.phase === 'game_over',
      winners: state.winner === null ? [] : [state.winner],
      eliminated: state.eliminated.map((e, i) => (e ? i : -1)).filter((i) => i >= 0),
    };
  },
};

function requireDev(state: CottonState, player: PlayerId, card: DevCard): EngineError | null {
  if (state.phase !== 'main') return err('ERR_ILLEGAL_ACTION', 'Play cards during your main phase.');
  if (state.devPlayedThisTurn) return err('ERR_ILLEGAL_ACTION', 'Only one development card per turn.');
  if (state.devHands[player]![card] - state.devFresh[card] < 1) {
    return err('ERR_ILLEGAL_ACTION', 'You cannot play that card (bought this turn?).');
  }
  return null;
}

function normalize(partial: Partial<ResourceCounts> | undefined): ResourceCounts {
  const out = zeroRes();
  for (const r of RESOURCES) {
    const c = partial?.[r] ?? 0;
    if (Number.isInteger(c) && c > 0) out[r] = c;
  }
  return out;
}

export const cottonSpec: GameSpec = {
  id: 'cotton',
  name: 'Colonies of Cotton',
  tagline: 'Settle, trade, and build your way to 10 points.',
  minPlayers: 3,
  maxPlayers: 4,
  engineVersion: 1,
  engine: cottonEngine as unknown as GameEngine,
};
