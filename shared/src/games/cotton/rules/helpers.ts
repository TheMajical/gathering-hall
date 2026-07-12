import type { PlayerId } from '../../../engine.js';
import { EDGE_VERTICES, HEX_VERTICES, VERTEX_EDGES, VERTEX_HEXES, VERTEX_PORT } from '../geometry.js';
import {
  RESOURCES,
  totalRes,
  zeroRes,
  type CottonState,
  type Resource,
  type ResourceCounts,
} from '../types.js';

export function canAfford(hand: ResourceCounts, cost: Partial<ResourceCounts>): boolean {
  return RESOURCES.every((r) => hand[r] >= (cost[r] ?? 0));
}

export function pay(hand: ResourceCounts, bank: ResourceCounts, cost: Partial<ResourceCounts>): void {
  for (const r of RESOURCES) {
    const c = cost[r] ?? 0;
    hand[r] -= c;
    bank[r] += c;
  }
}

/** Vertices where `player` may place a settlement mid-game (distance rule + own road). */
export function settlementSpots(state: CottonState, player: PlayerId): number[] {
  const out: number[] = [];
  for (let v = 0; v < state.buildings.length; v++) {
    if (!vertexOpen(state, v)) continue;
    const touchesRoad = VERTEX_EDGES[v]!.some((e) => state.roads[e] === player);
    if (touchesRoad) out.push(v);
  }
  return out;
}

/** Distance rule: vertex empty and no neighbor built. */
export function vertexOpen(state: CottonState, v: number): boolean {
  if (state.buildings[v]) return false;
  return VERTEX_EDGES[v]!.every((e) => {
    const [a, b] = EDGE_VERTICES[e]!;
    const other = a === v ? b : a;
    return !state.buildings[other];
  });
}

/** Edges where `player` may build a road (touching own road or building, not through enemy building). */
export function roadSpots(state: CottonState, player: PlayerId): number[] {
  const out: number[] = [];
  for (let e = 0; e < state.roads.length; e++) {
    if (state.roads[e] !== null) continue;
    const [a, b] = EDGE_VERTICES[e]!;
    if (connectsForPlayer(state, player, a) || connectsForPlayer(state, player, b)) out.push(e);
  }
  return out;
}

function connectsForPlayer(state: CottonState, player: PlayerId, v: number): boolean {
  const building = state.buildings[v];
  if (building?.owner === player) return true;
  if (building && building.owner !== player) return false; // enemy building blocks continuation
  return VERTEX_EDGES[v]!.some((e) => state.roads[e] === player);
}

/**
 * Longest continuous road for a player. DFS over their road edges; a path may
 * not continue THROUGH a vertex holding an opponent's building. Player road
 * counts are ≤15, so exhaustive DFS is cheap.
 */
export function longestRoadLength(state: CottonState, player: PlayerId): number {
  const myEdges = state.roads.map((o, e) => (o === player ? e : -1)).filter((e) => e >= 0);
  if (myEdges.length === 0) return 0;
  let best = 0;
  const used = new Set<number>();

  const passable = (v: number): boolean => {
    const b = state.buildings[v];
    return !b || b.owner === player;
  };

  const dfs = (v: number, len: number): void => {
    best = Math.max(best, len);
    if (!passable(v)) return; // may END here, not continue
    for (const e of VERTEX_EDGES[v]!) {
      if (state.roads[e] !== player || used.has(e)) continue;
      const [a, b] = EDGE_VERTICES[e]!;
      const next = a === v ? b : a;
      used.add(e);
      dfs(next, len + 1);
      used.delete(e);
    }
  };

  for (const e of myEdges) {
    const [a, b] = EDGE_VERTICES[e]!;
    used.add(e);
    dfs(a, 1);
    dfs(b, 1);
    used.delete(e);
  }
  return best;
}

/** Victory points; includeHidden adds unplayed VP dev cards. */
export function points(state: CottonState, player: PlayerId, includeHidden: boolean): number {
  let pts = 0;
  for (const b of state.buildings) {
    if (b?.owner === player) pts += b.city ? 2 : 1;
  }
  if (state.largestArmy === player) pts += 2;
  if (state.longestRoad === player) pts += 2;
  if (includeHidden) pts += state.devHands[player]!.vp;
  return pts;
}

/** Best bank-trade rate per resource for a player (4, 3 with any-port, 2 with matching port). */
export function tradeRates(state: CottonState, player: PlayerId): Record<Resource, number> {
  let base = 4;
  const two = new Set<Resource>();
  for (let v = 0; v < state.buildings.length; v++) {
    if (state.buildings[v]?.owner !== player) continue;
    const port = VERTEX_PORT[v];
    if (port === 'any') base = Math.min(base, 3);
    else if (port) two.add(port);
  }
  const rates = {} as Record<Resource, number>;
  for (const r of RESOURCES) rates[r] = two.has(r) ? 2 : base;
  return rates;
}

/**
 * Resource production for a dice total. Official bank-shortage rule: if the
 * bank cannot cover everyone for a resource and MORE THAN ONE player is owed
 * it, nobody receives that resource; a single recipient takes what remains.
 */
export function produce(state: CottonState, total: number): { player: PlayerId; gained: ResourceCounts }[] {
  const owed: ResourceCounts[] = state.turnOrder.map(() => zeroRes());
  for (let h = 0; h < state.hexes.length; h++) {
    const hex = state.hexes[h]!;
    if (hex.token !== total || h === state.robberHex || hex.terrain === 'desert') continue;
    const res = hex.terrain as Resource;
    for (const v of HEX_VERTICES[h]!) {
      const b = state.buildings[v];
      if (b && !state.eliminated[b.owner]) owed[b.owner]![res] += b.city ? 2 : 1;
    }
  }
  // apply bank-shortage rule per resource
  for (const r of RESOURCES) {
    const demand = owed.reduce((s, o) => s + o[r], 0);
    if (demand <= state.bank[r]) continue;
    const recipients = owed.filter((o) => o[r] > 0);
    if (recipients.length > 1) {
      for (const o of owed) o[r] = 0; // nobody gets it
    } else if (recipients.length === 1) {
      recipients[0]![r] = state.bank[r]; // take what's left
    }
  }
  const out: { player: PlayerId; gained: ResourceCounts }[] = [];
  for (let p = 0; p < state.numPlayers; p++) {
    if (totalRes(owed[p]!) === 0) continue;
    for (const r of RESOURCES) {
      state.hands[p]![r] += owed[p]![r];
      state.bank[r] -= owed[p]![r];
    }
    out.push({ player: p, gained: owed[p]! });
  }
  return out;
}

/** Players with a building adjacent to a hex (potential robbery victims). */
export function playersOnHex(state: CottonState, hex: number, excluding: PlayerId): PlayerId[] {
  const set = new Set<PlayerId>();
  for (const v of HEX_VERTICES[hex]!) {
    const b = state.buildings[v];
    if (b && b.owner !== excluding && !state.eliminated[b.owner] && totalRes(state.hands[b.owner]!) > 0) {
      set.add(b.owner);
    }
  }
  return [...set].sort((a, b) => a - b);
}
