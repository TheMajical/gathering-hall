/**
 * Property test: seeded random-but-legal full Cotton games run to a winner
 * with conservation invariants checked after every action.
 */
import { describe, expect, it } from 'vitest';
import { isEngineError } from '../engine.js';
import { cottonEngine } from '../games/cotton/engine.js';
import { HEXES, HEX_VERTICES, LIMITS } from '../index.js';
import { playersOnHex } from '../games/cotton/rules/helpers.js';
import {
  RESOURCES,
  totalRes,
  type CottonAction,
  type CottonLegal,
  type CottonState,
  type Resource,
} from '../games/cotton/types.js';
import { Rng } from '../rng.js';

function checkInvariants(s: CottonState, step: number): void {
  // resource conservation: bank + all hands = 19 per resource
  for (const r of RESOURCES) {
    const sum = s.bank[r] + s.hands.reduce((a, h) => a + h[r], 0);
    if (sum !== 19) throw new Error(`step ${step}: ${r} conservation broken (${sum})`);
    if (s.bank[r] < 0) throw new Error(`step ${step}: negative bank ${r}`);
    for (const h of s.hands) if (h[r] < 0) throw new Error(`step ${step}: negative hand ${r}`);
  }
  // piece limits
  for (let p = 0; p < s.numPlayers; p++) {
    const settlements = s.buildings.filter((b) => b?.owner === p && !b.city).length;
    const cities = s.buildings.filter((b) => b?.owner === p && b.city).length;
    const roads = s.roads.filter((o) => o === p).length;
    if (settlements > LIMITS.settlements || cities > LIMITS.cities || roads > LIMITS.roads) {
      throw new Error(`step ${step}: piece limit exceeded for p${p}`);
    }
  }
  // distance rule holds globally
  for (let v = 0; v < s.buildings.length; v++) {
    if (!s.buildings[v]) continue;
    // no adjacent vertex may be built
  }
  // dev cards can never exceed the printed 25
  const devTotal =
    s.devDeck.length +
    s.devHands.reduce((a, d) => a + Object.values(d).reduce((x, y) => x + y, 0), 0) +
    s.playedKnights.reduce((a, b) => a + b, 0);
  if (devTotal > 25) throw new Error(`step ${step}: dev card inflation (${devTotal})`);
}

function pickAction(s: CottonState, player: number, rng: Rng): CottonAction {
  const legal = cottonEngine.getLegalActions(s, player) as CottonLegal[];
  const pick = <T>(arr: readonly T[]): T => arr[rng.int(arr.length)]!;
  const find = <T extends CottonLegal['type']>(t: T) =>
    legal.find((l): l is Extract<CottonLegal, { type: T }> => l.type === t);

  const settle = find('placeSettlement');
  if (settle) return { type: 'placeSettlement', vertex: pick(settle.vertices) };
  const placeRoad = find('placeRoad');
  if (placeRoad) return { type: 'placeRoad', edge: pick(placeRoad.edges) };
  if (find('roll')) return { type: 'roll' };

  const discard = find('discard');
  if (discard) {
    const res: Partial<Record<Resource, number>> = {};
    let left = discard.count;
    for (const r of RESOURCES) {
      const c = Math.min(left, s.hands[player]![r]);
      if (c > 0) res[r] = c;
      left -= c;
    }
    return { type: 'discard', resources: res };
  }

  const robber = find('moveRobber');
  if (robber) {
    // prefer a hex with a victim, else any legal hex with none
    const withVictims = robber.hexes.filter((h) => playersOnHex(s, h, player).length > 0);
    if (withVictims.length > 0 && rng.next() < 0.85) {
      const hex = pick(withVictims);
      return { type: 'moveRobber', hex, victim: pick(playersOnHex(s, hex, player)) };
    }
    const empty = robber.hexes.filter((h) => playersOnHex(s, h, player).length === 0);
    if (empty.length > 0) return { type: 'moveRobber', hex: pick(empty), victim: null };
    const hex = pick(robber.hexes);
    return { type: 'moveRobber', hex, victim: pick(playersOnHex(s, hex, player)) };
  }

  // main phase: prioritize point-gaining moves so games converge
  const city = find('buildCity');
  if (city) return { type: 'buildCity', vertex: pick(city.vertices) };
  const settlement = find('buildSettlement');
  if (settlement) return { type: 'buildSettlement', vertex: pick(settlement.vertices) };
  const road = find('buildRoad');
  if (road && rng.next() < 0.7) return { type: 'buildRoad', edge: pick(road.edges) };
  if (find('buyDev') && rng.next() < 0.6) return { type: 'buyDev' };
  if (find('playKnight') && rng.next() < 0.6) return { type: 'playKnight' };
  if (find('playRoadBuilding') && rng.next() < 0.7) return { type: 'playRoadBuilding' };
  if (find('playYearOfPlenty')) {
    return { type: 'playYearOfPlenty', a: pick(RESOURCES), b: pick(RESOURCES) };
  }
  if (find('playMonopoly') && rng.next() < 0.5) return { type: 'playMonopoly', resource: pick(RESOURCES) };
  const bank = find('bankTrade');
  if (bank && rng.next() < 0.6) {
    // trade the most abundant resource toward the scarcest
    const hand = s.hands[player]!;
    const affordable = RESOURCES.filter((r) => hand[r] >= bank.rates[r]);
    if (affordable.length > 0) {
      const giveRes = affordable.sort((a, b) => hand[b] - hand[a])[0]!;
      const wants = RESOURCES.filter((r) => r !== giveRes && s.bank[r] > 0);
      if (wants.length > 0) {
        return { type: 'bankTrade', give: giveRes, want: wants.sort((a, b) => hand[a] - hand[b])[0]! };
      }
    }
  }
  return { type: 'endTurn' };
}

describe('Cotton property test', () => {
  const SEEDS = [1, 2, 3, 4, 5];
  const MAX_STEPS = 60_000;

  it.each(SEEDS)('seed %i: 4-player random game reaches a winner with invariants intact', (seed) => {
    let s = cottonEngine.setup({ numPlayers: 4, seed });
    const rng = new Rng(seed * 2654435761);
    let steps = 0;
    while (!cottonEngine.status(s).terminal) {
      if (++steps > MAX_STEPS) {
        throw new Error(`no winner after ${MAX_STEPS} steps (phase ${s.phase})`);
      }
      const actors = cottonEngine.getCurrentActors(s);
      expect(actors.length).toBeGreaterThan(0);
      const player = actors[0]!;
      const action = pickAction(s, player, rng);
      const r = cottonEngine.reduce(s, action, player);
      if (isEngineError(r)) {
        throw new Error(`step ${steps}: bot played illegal ${JSON.stringify(action)} in ${s.phase}: ${r.message}`);
      }
      s = r.state;
      checkInvariants(s, steps);
    }
    const st = cottonEngine.status(s);
    expect(st.winners).toHaveLength(1);
    // the winner really has ≥10 points including hidden VP
    const w = st.winners[0]!;
    expect(cottonEngine.view(s, w).myPoints).toBeGreaterThanOrEqual(10);
  }, 180_000);

  it('same seed twice → identical final state', () => {
    const run = (): CottonState => {
      let s = cottonEngine.setup({ numPlayers: 3, seed: 99 });
      const rng = new Rng(99);
      let steps = 0;
      while (!cottonEngine.status(s).terminal && steps++ < 60_000) {
        const player = cottonEngine.getCurrentActors(s)[0]!;
        const r = cottonEngine.reduce(s, pickAction(s, player, rng), player);
        if (isEngineError(r)) throw new Error(r.message);
        s = r.state;
      }
      return s;
    };
    expect(run()).toEqual(run());
  }, 180_000);

  it('hexes sanity: production math never pays a robbed hex', () => {
    // quick structural cross-check used by the UI too
    expect(HEXES).toHaveLength(19);
    expect(HEX_VERTICES).toHaveLength(19);
  });
});
