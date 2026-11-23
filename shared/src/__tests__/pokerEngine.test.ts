import { describe, expect, it } from 'vitest';
import { isEngineError, type GameEvent } from '../engine.js';
import { STARTING_CHIPS } from '../games/poker/cards.js';
import {
  pokerEngine,
  resolvePots,
  type PokerLegal,
  type PokerState,
} from '../games/poker/engine.js';
import { Rng } from '../rng.js';

function ok(r: ReturnType<typeof pokerEngine.reduce>): { state: PokerState; events: GameEvent[] } {
  if (isEngineError(r)) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
}

function bad(r: ReturnType<typeof pokerEngine.reduce>, code?: string): void {
  if (!isEngineError(r)) throw new Error('expected error');
  if (code) expect(r.code).toBe(code);
}

function totalChips(s: PokerState): number {
  return s.chips.reduce((sum, c) => sum + c, 0) + s.pot;
}

describe('Poker Engine setup and blind posting', () => {
  it('initializes chips, posts blinds, deals 2 hole cards per player, and conserves total chips', () => {
    const s = pokerEngine.setup({ numPlayers: 4, seed: 101 });
    expect(s.phase).toBe('betting');
    expect(s.street).toBe('preflop');
    expect(totalChips(s)).toBe(4 * STARTING_CHIPS);
    expect(s.pot).toBe(30); // 10 SB + 20 BB

    for (let p = 0; p < 4; p++) {
      expect(s.hands[p]).toHaveLength(2);
    }

    // Check player view redaction
    const v0 = pokerEngine.view(s, 0);
    expect(v0.hand).toEqual(s.hands[0]);
    // Opponent hole cards are hidden
    expect(v0.players[1]!.cards).toBeUndefined();
    expect(v0.players[1]!.cardCount).toBe(2);

    const spectator = pokerEngine.view(s, 'spectator');
    expect(spectator.hand).toHaveLength(0);
  });

  it('heads-up (2 players): dealer is SB and acts first pre-flop', () => {
    const s = pokerEngine.setup({ numPlayers: 2, seed: 202 });
    expect(s.currentActor).toBe(s.dealer); // Dealer is SB, acts first preflop in HU
    expect(s.currentBet).toBe(20);

    const legal = pokerEngine.getLegalActions(s, s.dealer) as PokerLegal[];
    expect(legal.some((l) => l.type === 'call')).toBe(true);
    expect(legal.some((l) => l.type === 'fold')).toBe(true);
    expect(legal.some((l) => l.type === 'raise')).toBe(true);
  });
});

describe('Poker betting rounds and streets', () => {
  it('progresses through streets: preflop -> flop -> turn -> river -> showdown', () => {
    let s = pokerEngine.setup({ numPlayers: 2, seed: 303 });
    const p1 = s.currentActor; // SB
    // Call 10 to match BB 20
    s = ok(pokerEngine.reduce(s, { type: 'call' }, p1)).state;

    // BB checks option
    const p2 = s.currentActor;
    expect(p2).not.toBe(p1);
    s = ok(pokerEngine.reduce(s, { type: 'check' }, p2)).state;

    // Now in Flop!
    expect(s.street).toBe('flop');
    expect(s.community).toHaveLength(3);
    expect(totalChips(s)).toBe(2 * STARTING_CHIPS);

    // Flop: check check
    s = ok(pokerEngine.reduce(s, { type: 'check' }, s.currentActor)).state;
    s = ok(pokerEngine.reduce(s, { type: 'check' }, s.currentActor)).state;

    // Now in Turn!
    expect(s.street).toBe('turn');
    expect(s.community).toHaveLength(4);

    // Turn: check check
    s = ok(pokerEngine.reduce(s, { type: 'check' }, s.currentActor)).state;
    s = ok(pokerEngine.reduce(s, { type: 'check' }, s.currentActor)).state;

    // Now in River!
    expect(s.street).toBe('river');
    expect(s.community).toHaveLength(5);

    // River: check check
    s = ok(pokerEngine.reduce(s, { type: 'check' }, s.currentActor)).state;
    s = ok(pokerEngine.reduce(s, { type: 'check' }, s.currentActor)).state;

    // Showdown!
    expect(s.phase).toBe('showdown');
    expect(s.street).toBe('showdown');
    expect(s.showdownWinners).toBeDefined();
    expect(s.showdownWinners!.length).toBeGreaterThan(0);
    expect(totalChips(s)).toBe(2 * STARTING_CHIPS);

    // Both players can see revealed hole cards at showdown
    const v = pokerEngine.view(s, 0);
    expect(v.players[0]!.cards).toBeDefined();
    expect(v.players[1]!.cards).toBeDefined();

    // Advance to next hand
    s = ok(pokerEngine.reduce(s, { type: 'nextHand' }, 0)).state;
    expect(s.handNumber).toBe(2);
    expect(s.street).toBe('preflop');
  });

  it('fold hands: remaining player instantly awarded pot without showdown', () => {
    let s = pokerEngine.setup({ numPlayers: 3, seed: 404 });
    const p1 = s.currentActor;
    s = ok(pokerEngine.reduce(s, { type: 'fold' }, p1)).state;

    const p2 = s.currentActor;
    s = ok(pokerEngine.reduce(s, { type: 'fold' }, p2)).state;

    // Only 1 player left: hand won on fold!
    expect(s.phase).toBe('showdown');
    expect(s.showdownWinners).toHaveLength(1);
    expect(totalChips(s)).toBe(3 * STARTING_CHIPS);
  });
});

describe('Poker side pots calculation', () => {
  it('correctly calculates main and side pots for all-in players with unequal stacks', () => {
    // Player 0 has 100, Player 1 has 200, Player 2 has 200
    // Total contributions: [100, 200, 200]
    // P0: Pair of Aces (best hand) -> wins main pot of 300
    // P1: Pair of Kings (beats P2's Pair of Queens) -> wins side pot of 200
    // P2: Pair of Queens -> wins 0
    const H = (rank: number) => 0 * 13 + rank;
    const D = (rank: number) => 1 * 13 + rank;
    const S = (rank: number) => 3 * 13 + rank;

    const community = [H(8), D(6), S(4), H(2), D(0)]; // 10, 8, 6, 4, 2
    const hands = [
      [H(12), D(12)], // P0: Pair of Aces
      [H(11), D(11)], // P1: Pair of Kings
      [H(10), D(10)], // P2: Pair of Queens
    ];

    const totalBets = [100, 200, 200];
    const folded = [false, false, false];

    const results = resolvePots(totalBets, folded, community, hands, 0);

    // P0 should win main pot of 300
    const p0Win = results.find((r) => r.player === 0);
    expect(p0Win).toBeDefined();
    expect(p0Win!.wonChips).toBe(300);

    // P1 should win side pot of 200
    const p1Win = results.find((r) => r.player === 1);
    expect(p1Win).toBeDefined();
    expect(p1Win!.wonChips).toBe(200);

    // Total won = 500
    const totalWon = results.reduce((sum, r) => sum + r.wonChips, 0);
    expect(totalWon).toBe(500);
  });
});

describe('Poker property test: random bot games', () => {
  it.each([2, 3, 4])('%ip matches run to completion with chip conservation invariant', (numPlayers) => {
    const rng = new Rng(numPlayers * 12345);
    let s = pokerEngine.setup({ numPlayers, seed: rng.int(100000) });
    let steps = 0;

    while (!pokerEngine.status(s).terminal) {
      if (++steps > 15_000) throw new Error(`no winner after ${steps} steps`);
      // Invariant: total chips conserved across every single step!
      expect(totalChips(s)).toBe(numPlayers * STARTING_CHIPS);

      const actors = pokerEngine.getCurrentActors(s);
      expect(actors.length).toBeGreaterThan(0);
      const actor = actors[0]!;
      const legals = pokerEngine.getLegalActions(s, actor);

      if (s.phase === 'showdown') {
        s = ok(pokerEngine.reduce(s, { type: 'nextHand' }, actor)).state;
      } else {
        // Pick an action: prefer check/call/fold/raise randomly
        const check = legals.find((l) => l.type === 'check');
        const call = legals.find((l) => l.type === 'call');
        const fold = legals.find((l) => l.type === 'fold');
        const raise = legals.find((l): l is Extract<PokerLegal, { type: 'raise' }> => l.type === 'raise');

        const roll = rng.next();
        if (check) {
          // If check is available, 70% check, 30% raise
          if (raise && roll > 0.7) {
            s = ok(pokerEngine.reduce(s, { type: 'raise', amount: raise.min }, actor)).state;
          } else {
            s = ok(pokerEngine.reduce(s, { type: 'check' }, actor)).state;
          }
        } else if (call) {
          // Call available: 60% call, 25% fold, 15% raise
          if (roll < 0.6) {
            s = ok(pokerEngine.reduce(s, { type: 'call' }, actor)).state;
          } else if (roll < 0.85 && fold) {
            s = ok(pokerEngine.reduce(s, { type: 'fold' }, actor)).state;
          } else if (raise) {
            s = ok(pokerEngine.reduce(s, { type: 'raise', amount: raise.min }, actor)).state;
          } else {
            s = ok(pokerEngine.reduce(s, { type: 'call' }, actor)).state;
          }
        } else if (fold) {
          s = ok(pokerEngine.reduce(s, { type: 'fold' }, actor)).state;
        }
      }
    }

    expect(pokerEngine.status(s).terminal).toBe(true);
    expect(s.winners.length).toBe(1);
    expect(s.chips[s.winners[0]!]).toBe(numPlayers * STARTING_CHIPS);
  });
});
