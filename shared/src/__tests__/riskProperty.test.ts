/**
 * Property test: seeded random-but-legal full games must run to termination
 * with core invariants holding after EVERY action. This is the strongest
 * "no mistakes" guarantee we have for the engine.
 */
import { describe, expect, it } from 'vitest';
import { isEngineError } from '../engine.js';
import { pickBotAction } from '../games/risk/bot.js';
import { riskEngine } from '../games/risk/engine.js';
import { NUM_CARDS } from '../games/risk/rules/cards.js';
import type { RiskState } from '../games/risk/types.js';
import { Rng } from '../rng.js';

function checkInvariants(s: RiskState, step: number): void {
  // Every territory holds at least one army with a valid owner.
  for (const [i, t] of s.territories.entries()) {
    if (t.armies < 1) throw new Error(`step ${step}: territory ${i} has ${t.armies} armies`);
    if (t.owner < 0 || t.owner >= s.numPlayers) throw new Error(`step ${step}: territory ${i} bad owner`);
  }
  // Card conservation: deck + discard + hands hold each card exactly once.
  const all = [...s.deck, ...s.discard, ...s.hands.flat()];
  if (all.length !== NUM_CARDS || new Set(all).size !== NUM_CARDS) {
    throw new Error(`step ${step}: card conservation violated (${all.length} cards, ${new Set(all).size} unique)`);
  }
  if (s.reinforcementsRemaining < 0) throw new Error(`step ${step}: negative reinforcements`);
  // Eliminated players own no territories... except resigners keep theirs; bots never resign.
  for (let p = 0; p < s.numPlayers; p++) {
    if (s.eliminated[p] && s.hands[p]!.length > 0) throw new Error(`step ${step}: eliminated p${p} holds cards`);
  }
}

describe('Risk property test: full random games', () => {
  const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);
  const MAX_STEPS = 200_000;

  it.each(SEEDS)('seed %i: 4-player game reaches termination with invariants intact', (seed) => {
    let state = riskEngine.setup({ numPlayers: 4, seed });
    const botRng = new Rng(seed * 7919);
    const rand = () => botRng.next();
    let steps = 0;
    while (!riskEngine.status(state).terminal) {
      if (++steps > MAX_STEPS) throw new Error(`game did not terminate in ${MAX_STEPS} steps (phase ${state.phase})`);
      const actors = riskEngine.getCurrentActors(state);
      expect(actors.length).toBeGreaterThan(0);
      const player = actors[0]!;
      const action = pickBotAction(state, player, rand);
      if (!action) throw new Error(`step ${steps}: bot has no action in phase ${state.phase}`);
      const r = riskEngine.reduce(state, action, player);
      if (isEngineError(r)) {
        throw new Error(`step ${steps}: bot played illegal ${JSON.stringify(action)} in ${state.phase}: ${r.message}`);
      }
      state = r.state;
      checkInvariants(state, steps);
    }
    const st = riskEngine.status(state);
    expect(st.winners).toHaveLength(1);
    // exactly one player left standing or owning everything
    const w = st.winners[0]!;
    expect(state.eliminated[w]).toBe(false);
  }, 120_000);

  it('same seed twice → identical final state (full determinism)', () => {
    const run = (seed: number): RiskState => {
      let state = riskEngine.setup({ numPlayers: 3, seed });
      const botRng = new Rng(seed);
      const rand = () => botRng.next();
      let steps = 0;
      while (!riskEngine.status(state).terminal && steps++ < 200_000) {
        const player = riskEngine.getCurrentActors(state)[0]!;
        const action = pickBotAction(state, player, rand)!;
        const r = riskEngine.reduce(state, action, player);
        if (isEngineError(r)) throw new Error('illegal bot action');
        state = r.state;
      }
      return state;
    };
    expect(run(555)).toEqual(run(555));
  }, 120_000);
});
