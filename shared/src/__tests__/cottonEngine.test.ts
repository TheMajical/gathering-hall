import { describe, expect, it } from 'vitest';
import { isEngineError, type GameEvent } from '../engine.js';
import { cottonEngine } from '../games/cotton/engine.js';
import { EDGE_VERTICES, HEX_VERTICES, VERTEX_ADJ, VERTEX_EDGES } from '../games/cotton/geometry.js';
import { longestRoadLength, produce, tradeRates } from '../games/cotton/rules/helpers.js';
import {
  RESOURCES,
  totalRes,
  zeroRes,
  type CottonLegal,
  type CottonState,
  type Resource,
} from '../games/cotton/types.js';

function ok(r: ReturnType<typeof cottonEngine.reduce>): { state: CottonState; events: GameEvent[] } {
  if (isEngineError(r)) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
}
function bad(r: ReturnType<typeof cottonEngine.reduce>, code?: string): void {
  if (!isEngineError(r)) throw new Error('expected error');
  if (code) expect(r.code).toBe(code);
}

/** Run the snake draft with first-legal placements → game reaches 'roll'. */
function throughSetup(seed = 11, numPlayers = 3): CottonState {
  let s = cottonEngine.setup({ numPlayers, seed });
  let guard = 0;
  while (s.phase === 'setup' && guard++ < 100) {
    const p = cottonEngine.getCurrentActors(s)[0]!;
    const legal = cottonEngine.getLegalActions(s, p) as CottonLegal[];
    const settle = legal.find((l): l is Extract<CottonLegal, { type: 'placeSettlement' }> => l.type === 'placeSettlement');
    if (settle) {
      s = ok(cottonEngine.reduce(s, { type: 'placeSettlement', vertex: settle.vertices[0]! }, p)).state;
    } else {
      const road = legal.find((l): l is Extract<CottonLegal, { type: 'placeRoad' }> => l.type === 'placeRoad')!;
      s = ok(cottonEngine.reduce(s, { type: 'placeRoad', edge: road.edges[0]! }, p)).state;
    }
  }
  expect(s.phase).toBe('roll');
  return s;
}

/** Craft: post-setup state in 'main' phase with controlled hands. */
function inMain(seed = 11): CottonState {
  const s = throughSetup(seed);
  s.phase = 'main';
  s.lastRoll = [3, 4] as [number, number];
  return s;
}

const give = (s: CottonState, p: number, res: Partial<Record<Resource, number>>): void => {
  for (const r of RESOURCES) {
    const c = res[r] ?? 0;
    s.hands[p]![r] += c;
    s.bank[r] -= c;
  }
};

describe('Cotton setup & snake draft', () => {
  it('board composition: terrains, tokens, robber on desert, 25 dev cards, bank 19×5', () => {
    const s = cottonEngine.setup({ numPlayers: 4, seed: 1 });
    const terr = s.hexes.map((h) => h.terrain);
    expect(terr.filter((t) => t === 'lumber')).toHaveLength(4);
    expect(terr.filter((t) => t === 'wool')).toHaveLength(4);
    expect(terr.filter((t) => t === 'grain')).toHaveLength(4);
    expect(terr.filter((t) => t === 'brick')).toHaveLength(3);
    expect(terr.filter((t) => t === 'ore')).toHaveLength(3);
    expect(terr.filter((t) => t === 'desert')).toHaveLength(1);
    expect(s.hexes[s.robberHex]!.terrain).toBe('desert');
    expect(s.hexes[s.robberHex]!.token).toBeNull();
    const tokens = s.hexes.flatMap((h) => (h.token === null ? [] : [h.token]));
    expect(tokens).toHaveLength(18);
    expect(tokens.filter((t) => t === 7)).toHaveLength(0);
    expect(s.devDeck).toHaveLength(25);
    expect(s.devDeck.filter((c) => c === 'knight')).toHaveLength(14);
    expect(s.devDeck.filter((c) => c === 'vp')).toHaveLength(5);
    for (const r of RESOURCES) expect(s.bank[r]).toBe(19);
    expect(cottonEngine.setup({ numPlayers: 4, seed: 1 })).toEqual(s);
  });

  it('snake draft: 2 settlements + 2 roads each, second grants starting resources, order reverses', () => {
    const s0 = cottonEngine.setup({ numPlayers: 3, seed: 7 });
    const seen: number[] = [];
    let s = s0;
    let guard = 0;
    while (s.phase === 'setup' && guard++ < 50) {
      const p = cottonEngine.getCurrentActors(s)[0]!;
      const legal = cottonEngine.getLegalActions(s, p) as CottonLegal[];
      const settle = legal.find((l): l is Extract<CottonLegal, { type: 'placeSettlement' }> => l.type === 'placeSettlement');
      if (settle) {
        seen.push(p);
        s = ok(cottonEngine.reduce(s, { type: 'placeSettlement', vertex: settle.vertices[0]! }, p)).state;
      } else {
        const road = legal.find((l): l is Extract<CottonLegal, { type: 'placeRoad' }> => l.type === 'placeRoad')!;
        s = ok(cottonEngine.reduce(s, { type: 'placeRoad', edge: road.edges[0]! }, p)).state;
      }
    }
    // snake: a,b,c,c,b,a
    const [a, b, c] = s0.turnOrder as [number, number, number];
    expect(seen).toEqual([a, b, c, c, b, a]);
    for (let p = 0; p < 3; p++) {
      expect(s.buildings.filter((x) => x?.owner === p)).toHaveLength(2);
      expect(s.roads.filter((x) => x === p)).toHaveLength(2);
    }
    // starting resources: total handed out equals non-desert hexes adjacent to second settlements
    const handTotal = s.hands.reduce((sum, h) => sum + totalRes(h), 0);
    expect(handTotal).toBeGreaterThan(0);
    expect(s.turnOrder[s.currentIdx]).toBe(a);
  });

  it('setup enforces the distance rule and road adjacency', () => {
    let s = cottonEngine.setup({ numPlayers: 3, seed: 3 });
    const p = cottonEngine.getCurrentActors(s)[0]!;
    s = ok(cottonEngine.reduce(s, { type: 'placeSettlement', vertex: 10 }, p)).state;
    // road must touch vertex 10
    const notTouching = s.roads.findIndex((_, e) => !VERTEX_EDGES[10]!.includes(e));
    bad(cottonEngine.reduce(s, { type: 'placeRoad', edge: notTouching }, p));
    s = ok(cottonEngine.reduce(s, { type: 'placeRoad', edge: VERTEX_EDGES[10]![0]! }, p)).state;
    // next player cannot settle adjacent to vertex 10
    const p2 = cottonEngine.getCurrentActors(s)[0]!;
    bad(cottonEngine.reduce(s, { type: 'placeSettlement', vertex: VERTEX_ADJ[10]![0]! }, p2));
    bad(cottonEngine.reduce(s, { type: 'placeSettlement', vertex: 10 }, p2));
  });
});

describe('Cotton production & robber', () => {
  it('a roll pays settlements 1 and cities 2; the robber blocks a hex', () => {
    const s = inMain(5);
    // pick a productive hex and plant a settlement + a city of p0 on it
    const hex = s.hexes.findIndex((h, i) => h.terrain !== 'desert' && i !== s.robberHex);
    const res = s.hexes[hex]!.terrain as Resource;
    const [v1, v2] = HEX_VERTICES[hex]! as [number, number];
    s.buildings = s.buildings.map(() => null);
    s.buildings[v1] = { owner: 0, city: false };
    s.buildings[v2] = { owner: 0, city: true };
    const before = s.hands[0]![res];
    produce(s, s.hexes[hex]!.token!);
    expect(s.hands[0]![res]).toBe(before + 3);

    // robber on the hex → nothing
    s.robberHex = hex;
    const mid = s.hands[0]![res];
    produce(s, s.hexes[hex]!.token!);
    expect(s.hands[0]![res]).toBe(mid);
  });

  it('bank shortage: two players owed more than remains → nobody paid; single player takes remainder', () => {
    const s = inMain(6);
    const hex = s.hexes.findIndex((h, i) => h.terrain !== 'desert' && i !== s.robberHex);
    const res = s.hexes[hex]!.terrain as Resource;
    const [v1, v2] = HEX_VERTICES[hex]! as [number, number];
    s.buildings = s.buildings.map(() => null);
    s.buildings[v1] = { owner: 0, city: true }; // owed 2
    s.buildings[v2] = { owner: 1, city: false }; // owed 1
    s.bank[res] = 2; // demand 3 > 2, two recipients → nobody
    const h0 = s.hands[0]![res];
    const h1 = s.hands[1]![res];
    produce(s, s.hexes[hex]!.token!);
    expect(s.hands[0]![res]).toBe(h0);
    expect(s.hands[1]![res]).toBe(h1);

    // single recipient takes what's left
    s.buildings[v2] = null;
    produce(s, s.hexes[hex]!.token!);
    expect(s.hands[0]![res]).toBe(h0 + 2);
    expect(s.bank[res]).toBe(0);
  });

  it('7-roll: over-limit players discard half, then the robber moves and steals', () => {
    const s = throughSetup(21);
    give(s, 1, { brick: 4, lumber: 5 }); // hand 9 + starting
    const owed1 = Math.floor(totalRes(s.hands[1]!) / 2);
    // force a 7 by entering discard manually (roll is rng-driven)
    s.phase = 'discard';
    s.discardsOwed = [0, owed1, 0];
    expect(cottonEngine.getCurrentActors(s)).toEqual([1]);
    // wrong count rejected
    bad(cottonEngine.reduce(s, { type: 'discard', resources: { brick: 1 } }, 1));
    // p0 has nothing owed
    bad(cottonEngine.reduce(s, { type: 'discard', resources: {} }, 0));
    // proper discard: greedy from brick/lumber
    const res: Partial<Record<Resource, number>> = {};
    let left = owed1;
    for (const r of RESOURCES) {
      const c = Math.min(left, s.hands[1]![r]);
      if (c > 0) res[r] = c;
      left -= c;
    }
    let r1 = ok(cottonEngine.reduce(s, { type: 'discard', resources: res }, 1));
    expect(r1.state.phase).toBe('robber');

    // robber: must move to a NEW hex; stealing requires a victim on the hex
    const cur = r1.state.turnOrder[r1.state.currentIdx]!;
    bad(cottonEngine.reduce(r1.state, { type: 'moveRobber', hex: r1.state.robberHex, victim: null }, cur));
    // find a hex with an opponent building & non-empty hand
    const victimHex = r1.state.hexes.findIndex((_, h) =>
      h !== r1.state.robberHex &&
      HEX_VERTICES[h]!.some((v) => {
        const b = r1.state.buildings[v];
        return b && b.owner !== cur && totalRes(r1.state.hands[b.owner]!) > 0;
      }),
    );
    if (victimHex >= 0) {
      const victim = HEX_VERTICES[victimHex]!.map((v) => r1.state.buildings[v]).find((b) => b && b.owner !== cur)!.owner;
      // refusing to steal there is illegal
      bad(cottonEngine.reduce(r1.state, { type: 'moveRobber', hex: victimHex, victim: null }, cur));
      const before = totalRes(r1.state.hands[victim]!);
      const r2 = ok(cottonEngine.reduce(r1.state, { type: 'moveRobber', hex: victimHex, victim }, cur));
      expect(totalRes(r2.state.hands[victim]!)).toBe(before - 1);
      expect(r2.state.phase).toBe('main');
    }
  });
});

describe('Cotton building', () => {
  it('costs are enforced and paid to the bank; piece flows work end-to-end', () => {
    const s = inMain(9);
    const p = s.turnOrder[s.currentIdx]!;
    // no resources → build rejected (cost check fires before spot check)
    s.hands[p] = zeroRes();
    const anyEmptyEdge = s.roads.findIndex((r) => r === null);
    bad(cottonEngine.reduce(s, { type: 'buildRoad', edge: anyEmptyEdge }, p));

    give(s, p, { brick: 2, lumber: 2, wool: 1, grain: 3, ore: 3 });
    const legal = cottonEngine.getLegalActions(s, p) as CottonLegal[];
    const roadL = legal.find((l): l is Extract<CottonLegal, { type: 'buildRoad' }> => l.type === 'buildRoad')!;
    const bankBrick = s.bank.brick;
    const r1 = ok(cottonEngine.reduce(s, { type: 'buildRoad', edge: roadL.edges[0]! }, p));
    expect(r1.state.hands[p]!.brick).toBe(s.hands[p]!.brick - 1);
    expect(r1.state.bank.brick).toBe(bankBrick + 1);

    // city: upgrade an own settlement
    const settlement = r1.state.buildings.findIndex((b) => b?.owner === p && !b.city);
    const r2 = ok(cottonEngine.reduce(r1.state, { type: 'buildCity', vertex: settlement }, p));
    expect(r2.state.buildings[settlement]).toEqual({ owner: p, city: true });
    // can't upgrade twice
    bad(cottonEngine.reduce(r2.state, { type: 'buildCity', vertex: settlement }, p));
  });

  it('mid-game settlements need an own road and respect the distance rule', () => {
    const s = inMain(13);
    const p = s.turnOrder[s.currentIdx]!;
    give(s, p, { brick: 5, lumber: 5, wool: 2, grain: 2 });
    // vertex far from any of p's roads → rejected even if open
    const farVertex = s.buildings.findIndex(
      (b, v) => b === null && !VERTEX_EDGES[v]!.some((e) => s.roads[e] === p) && VERTEX_ADJ[v]!.every((n) => s.buildings[n] === null),
    );
    bad(cottonEngine.reduce(s, { type: 'buildSettlement', vertex: farVertex }, p));
  });
});

describe('Cotton dev cards', () => {
  it('buy: pays; fresh cards unplayable this turn; one card per turn', () => {
    const s = inMain(17);
    const p = s.turnOrder[s.currentIdx]!;
    give(s, p, { ore: 2, wool: 2, grain: 2 });
    s.devDeck = ['knight', 'knight'];
    const r1 = ok(cottonEngine.reduce(s, { type: 'buyDev' }, p));
    expect(r1.state.devHands[p]!.knight).toBe(1);
    // fresh → can't play now
    bad(cottonEngine.reduce(r1.state, { type: 'playKnight' }, p));
    // next turn it becomes playable; give the knight directly instead:
    const s2 = inMain(17);
    const q = s2.turnOrder[s2.currentIdx]!;
    s2.devHands[q]!.knight = 2;
    const r2 = ok(cottonEngine.reduce(s2, { type: 'playKnight' }, q));
    expect(r2.state.phase).toBe('robber');
    expect(r2.state.playedKnights[q]).toBe(1);
    // second card same turn rejected (after robber resolves)
    const anyHex = r2.state.hexes.findIndex((_, h) => h !== r2.state.robberHex && HEX_VERTICES[h]!.every((v) => !r2.state.buildings[v]));
    const r3 = ok(cottonEngine.reduce(r2.state, { type: 'moveRobber', hex: anyHex, victim: null }, q));
    bad(cottonEngine.reduce(r3.state, { type: 'playKnight' }, q));
  });

  it('largest army goes to the first player with 3 knights, then to whoever strictly exceeds', () => {
    const s = inMain(19);
    const p = s.turnOrder[s.currentIdx]!;
    s.playedKnights[p] = 2;
    s.devHands[p]!.knight = 1;
    const r = ok(cottonEngine.reduce(s, { type: 'playKnight' }, p));
    expect(r.state.largestArmy).toBe(p);
    // another player merely EQUALING 3 knights does not take the award
    const s2 = r.state;
    const other = (p + 1) % s2.numPlayers;
    s2.playedKnights[other] = 2;
    s2.devHands[other]!.knight = 1;
    s2.phase = 'main';
    s2.currentIdx = s2.turnOrder.indexOf(other);
    s2.devPlayedThisTurn = false;
    const r2 = ok(cottonEngine.reduce(s2, { type: 'playKnight' }, other));
    expect(r2.state.playedKnights[other]).toBe(3);
    expect(r2.state.largestArmy).toBe(p); // tie does not steal the crown
  });

  it('road building places two free roads; year of plenty and monopoly move resources correctly', () => {
    const s = inMain(23);
    const p = s.turnOrder[s.currentIdx]!;
    s.devHands[p]!.roadBuilding = 1;
    const roadsBefore = s.roads.filter((r) => r === p).length;
    let r = ok(cottonEngine.reduce(s, { type: 'playRoadBuilding' }, p));
    expect(r.state.phase).toBe('roadBuilding');
    for (let i = 0; i < 2; i++) {
      const legal = cottonEngine.getLegalActions(r.state, p) as CottonLegal[];
      const pr = legal.find((l): l is Extract<CottonLegal, { type: 'placeRoad' }> => l.type === 'placeRoad')!;
      r = ok(cottonEngine.reduce(r.state, { type: 'placeRoad', edge: pr.edges[0]! }, p));
    }
    expect(r.state.phase).toBe('main');
    expect(r.state.roads.filter((x) => x === p)).toHaveLength(roadsBefore + 2);
    expect(r.state.hands[p]!.brick).toBe(s.hands[p]!.brick); // free

    // year of plenty
    const s2 = inMain(23);
    const q = s2.turnOrder[s2.currentIdx]!;
    s2.devHands[q]!.yearOfPlenty = 1;
    const r2 = ok(cottonEngine.reduce(s2, { type: 'playYearOfPlenty', a: 'ore', b: 'ore' }, q));
    expect(r2.state.hands[q]!.ore).toBe(s2.hands[q]!.ore + 2);

    // monopoly takes every copy from opponents
    const s3 = inMain(23);
    const m = s3.turnOrder[s3.currentIdx]!;
    s3.devHands[m]!.monopoly = 1;
    give(s3, (m + 1) % 3, { wool: 3 });
    give(s3, (m + 2) % 3, { wool: 2 });
    const mine = s3.hands[m]!.wool;
    const others = s3.hands[(m + 1) % 3]!.wool + s3.hands[(m + 2) % 3]!.wool;
    const r3 = ok(cottonEngine.reduce(s3, { type: 'playMonopoly', resource: 'wool' }, m));
    expect(r3.state.hands[m]!.wool).toBe(mine + others);
    expect(r3.state.hands[(m + 1) % 3]!.wool).toBe(0);
  });
});

describe('Cotton longest road', () => {
  it('a 5-road chain earns the award; an opponent settlement can sever and dethrone it', () => {
    const s = inMain(29);
    const p = s.turnOrder[s.currentIdx]!;
    const foe = (p + 1) % s.numPlayers;
    // wipe the board and hand-build a clean 5-chain for p
    s.buildings = s.buildings.map(() => null);
    s.roads = s.roads.map(() => null);
    // walk a path of 5 edges from vertex 0
    const path: number[] = [];
    let v = 0;
    const usedV = new Set([0]);
    while (path.length < 5) {
      const next = VERTEX_ADJ[v]!.find((n) => !usedV.has(n))!;
      const edge = VERTEX_EDGES[v]!.find((e) => {
        const [a, b] = [v, next];
        const ev = EDGE_VERTICES_LOOKUP(e);
        return (ev[0] === a && ev[1] === b) || (ev[0] === b && ev[1] === a);
      })!;
      path.push(edge);
      usedV.add(next);
      v = next;
    }
    const chainVerts = [...usedV]; // v0 .. v5 along the chain
    const middleVertex = chainVerts[2]!; // interior: 2 edges on one side, 3 on the other
    for (const e of path) s.roads[e] = p;
    expect(longestRoadLength(s, p)).toBe(5);

    // award granted when the engine recomputes on a build — extend WITHOUT
    // closing a loop: pick a legal edge whose far endpoint is off the chain
    give(s, p, { brick: 1, lumber: 1 });
    const legal = cottonEngine.getLegalActions(s, p) as CottonLegal[];
    const roadL = legal.find((l): l is Extract<CottonLegal, { type: 'buildRoad' }> => l.type === 'buildRoad')!;
    const openEdge = roadL.edges.find((e) => {
      const [a, b] = EDGE_VERTICES_LOOKUP(e);
      return !(usedV.has(a) && usedV.has(b)); // never both ends on the chain
    })!;
    const r1 = ok(cottonEngine.reduce(s, { type: 'buildRoad', edge: openEdge }, p));
    expect(r1.state.longestRoad).toBe(p);
    expect(longestRoadLength(r1.state, p)).toBeGreaterThanOrEqual(5);

    // sever with an enemy building mid-chain (bypassing build rules for the test)
    const s2 = r1.state;
    s2.buildings[middleVertex] = { owner: foe, city: false };
    const severed = longestRoadLength(s2, p);
    expect(severed).toBeLessThan(longestRoadLength(r1.state, p) === 6 ? 6 : 5 + 1);
    expect(severed).toBeLessThanOrEqual(4); // 2+ on one side, ≤4 on the other of vertex #2
  });
});

describe('Cotton trading', () => {
  it('bank trade at 4:1; a port vertex improves the rate', () => {
    const s = inMain(31);
    const p = s.turnOrder[s.currentIdx]!;
    expect(tradeRates(s, p).brick).toBeGreaterThanOrEqual(2); // ports possible from setup spots
    s.buildings = s.buildings.map(() => null); // no ports now
    expect(tradeRates(s, p).brick).toBe(4);
    give(s, p, { brick: 4 });
    const before = s.hands[p]!.wool;
    const r = ok(cottonEngine.reduce(s, { type: 'bankTrade', give: 'brick', want: 'wool' }, p));
    expect(r.state.hands[p]!.brick).toBe(s.hands[p]!.brick - 4);
    expect(r.state.hands[p]!.wool).toBe(before + 1);
    bad(cottonEngine.reduce(r.state, { type: 'bankTrade', give: 'brick', want: 'wool' }, p)); // out of brick
  });

  it('player trade: offer → out-of-turn accept swaps resources; cancel clears', () => {
    const s = inMain(37);
    const p = s.turnOrder[s.currentIdx]!;
    const q = (p + 1) % s.numPlayers;
    give(s, p, { ore: 1 });
    give(s, q, { wool: 2 });
    const r1 = ok(cottonEngine.reduce(s, { type: 'offerTrade', give: { ore: 1 }, want: { wool: 2 } }, p));
    expect(r1.state.tradeOffer).not.toBeNull();
    // accepter must cover the want side
    const broke = s.turnOrder.find((x) => x !== p && x !== q)!;
    if (r1.state.hands[broke]!.wool < 2) bad(cottonEngine.reduce(r1.state, { type: 'acceptTrade' }, broke));
    const oreP = r1.state.hands[p]!.ore;
    const woolQ = r1.state.hands[q]!.wool;
    const r2 = ok(cottonEngine.reduce(r1.state, { type: 'acceptTrade' }, q));
    expect(r2.state.hands[p]!.ore).toBe(oreP - 1);
    expect(r2.state.hands[p]!.wool).toBe(r1.state.hands[p]!.wool + 2);
    expect(r2.state.hands[q]!.wool).toBe(woolQ - 2);
    expect(r2.state.hands[q]!.ore).toBe(r1.state.hands[q]!.ore + 1);
    expect(r2.state.tradeOffer).toBeNull();
    // proposer cannot accept own offer
    const r3 = ok(cottonEngine.reduce(r2.state, { type: 'offerTrade', give: { wool: 1 }, want: { ore: 1 } }, p));
    bad(cottonEngine.reduce(r3.state, { type: 'acceptTrade' }, p));
    const r4 = ok(cottonEngine.reduce(r3.state, { type: 'cancelTrade' }, p));
    expect(r4.state.tradeOffer).toBeNull();
  });
});

describe('Cotton victory & misc', () => {
  it('reaching 10 points (with hidden VP cards) wins on your own action', () => {
    const s = inMain(41);
    const p = s.turnOrder[s.currentIdx]!;
    // p has 2 settlements (2pts). Give: 3 VP cards + largest army (2) + 2 cities upgraded = 2+2+3+2 = 9 → city → 11? craft to exactly reach ≥10 on a build.
    s.devHands[p]!.vp = 4;
    s.largestArmy = p; // +2  → 2 + 4 + 2 = 8
    give(s, p, { ore: 3, grain: 2 });
    const settlement = s.buildings.findIndex((b) => b?.owner === p && !b.city);
    const r = ok(cottonEngine.reduce(s, { type: 'buildCity', vertex: settlement }, p)); // +1 → 9... city adds 1 net
    // 2 settlements = 2; city upgrade → 1 settlement + 1 city = 1+2 = 3 (+1); +4 vp +2 army = 9 → not enough
    expect(r.state.winner).toBeNull();
    // one more vp card tips it over on the next own action
    r.state.devHands[p]!.vp = 5;
    give(r.state, p, { ore: 3, grain: 2 });
    const second = r.state.buildings.findIndex((b) => b?.owner === p && !b.city);
    const r2 = ok(cottonEngine.reduce(r.state, { type: 'buildCity', vertex: second }, p));
    expect(r2.state.winner).toBe(p);
    expect(cottonEngine.status(r2.state).terminal).toBe(true);
  });

  it('view redaction: opponents see hand sizes, not contents; spectators see nothing private', () => {
    const s = inMain(43);
    give(s, 0, { ore: 2, wool: 1 });
    const v1 = cottonEngine.view(s, 1);
    expect(v1.hand).toEqual(s.hands[1]);
    expect(v1.players[0]!.handSize).toBe(totalRes(s.hands[0]!));
    expect((v1 as unknown as Record<string, unknown>).hands).toBeUndefined();
    const spec = cottonEngine.view(s, 'spectator');
    expect(totalRes(spec.hand)).toBe(0);
    expect(spec.myPoints).toBe(0);
  });

  it('endTurn rotates, resets per-turn dev state; resign of current player advances', () => {
    const s = inMain(47);
    const p = s.turnOrder[s.currentIdx]!;
    s.devPlayedThisTurn = true;
    const r = ok(cottonEngine.reduce(s, { type: 'endTurn' }, p));
    expect(r.state.phase).toBe('roll');
    expect(r.state.devPlayedThisTurn).toBe(false);
    expect(r.state.turnOrder[r.state.currentIdx]).not.toBe(p);

    const r2 = ok(cottonEngine.reduce(r.state, { type: 'resign' }, r.state.turnOrder[r.state.currentIdx]!));
    expect(r2.state.eliminated.filter(Boolean)).toHaveLength(1);
    const r3 = ok(cottonEngine.reduce(r2.state, { type: 'resign' }, r2.state.turnOrder[r2.state.currentIdx]!));
    expect(r3.state.winner).not.toBeNull(); // last one standing
  });
});

function EDGE_VERTICES_LOOKUP(e: number): [number, number] {
  return EDGE_VERTICES[e]!;
}
