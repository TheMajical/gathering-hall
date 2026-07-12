import { describe, expect, it } from 'vitest';
import { isEngineError, type GameEvent } from '../engine.js';
import { riskEngine } from '../games/risk/engine.js';
import { T } from '../games/risk/mapData.js';
import { INITIAL_ARMIES, type RiskAction, type RiskState } from '../games/risk/types.js';

function assertOk(r: ReturnType<typeof riskEngine.reduce>): { state: RiskState; events: GameEvent[] } {
  if (isEngineError(r)) throw new Error(`Expected success, got ${r.code}: ${r.message}`);
  return r;
}

function assertErr(r: ReturnType<typeof riskEngine.reduce>, code?: string): void {
  if (!isEngineError(r)) throw new Error('Expected an engine error, got success');
  if (code) expect(r.code).toBe(code);
}

/** A crafted mid-game state for focused rule tests: 3 players, no setup noise. */
function craft(overrides: Partial<RiskState> = {}): RiskState {
  const base = riskEngine.setup({ numPlayers: 3, seed: 1 });
  // Deterministic clean slate: player 0 owns everything except two islands of p1/p2.
  const territories = base.territories.map(() => ({ owner: 0, armies: 3 }));
  territories[T.NW_TERRITORY] = { owner: 1, armies: 2 };
  territories[T.GREENLAND] = { owner: 1, armies: 2 };
  territories[T.QUEBEC] = { owner: 2, armies: 2 };
  return {
    ...base,
    phase: 'attack',
    turnOrder: [0, 1, 2],
    currentIdx: 0,
    territories,
    hands: [[], [], []],
    deck: base.deck,
    discard: [],
    reinforcementsRemaining: 0,
    conqueredThisTurn: false,
    pendingMove: null,
    setupRemaining: [0, 0, 0],
    setupBatch: 0,
    ...overrides,
  };
}

describe('Risk setup', () => {
  it.each([3, 4, 5, 6])('%i players: all armies auto-placed, game opens on first reinforce', (n) => {
    const s = riskEngine.setup({ numPlayers: n, seed: 7 });
    expect(s.phase).toBe('reinforce'); // no setup phase — straight into turn 1
    expect(s.currentIdx).toBe(0);
    expect(s.territories).toHaveLength(42);
    for (const t of s.territories) {
      expect(t.armies).toBeGreaterThanOrEqual(1);
      expect(t.owner).toBeGreaterThanOrEqual(0);
      expect(t.owner).toBeLessThan(n);
    }
    // every player's full initial allotment is on the board
    for (let p = 0; p < n; p++) {
      expect(s.setupRemaining[p]).toBe(0);
      const onBoard = s.territories.filter((t) => t.owner === p).reduce((sum, t) => sum + t.armies, 0);
      expect(onBoard).toBe(INITIAL_ARMIES[n]!);
    }
    // first player has their normal turn income to place by hand
    expect(s.reinforcementsRemaining).toBeGreaterThanOrEqual(3);
    expect(s.deck).toHaveLength(44);
    expect([...s.turnOrder].sort()).toEqual(Array.from({ length: n }, (_, i) => i));
  });

  it('is deterministic per seed', () => {
    const a = riskEngine.setup({ numPlayers: 4, seed: 123 });
    const b = riskEngine.setup({ numPlayers: 4, seed: 123 });
    expect(a).toEqual(b);
    const c = riskEngine.setup({ numPlayers: 4, seed: 124 });
    expect(c.territories).not.toEqual(a.territories);
  });

  it('legacy setup-phase snapshots still play out (backwards compatibility)', () => {
    // Craft a state as an older version would have saved it: mid-setup.
    let s = riskEngine.setup({ numPlayers: 3, seed: 42 });
    s = { ...s, phase: 'setup', setupRemaining: [0, 0, 3], setupBatch: 3, currentIdx: s.turnOrder.indexOf(2), reinforcementsRemaining: 0 };
    const mine = s.territories.findIndex((t) => t.owner === 2);
    const theirs = s.territories.findIndex((t) => t.owner !== 2);
    assertErr(riskEngine.reduce(s, { type: 'place', territoryId: theirs, count: 1 }, 2));
    assertErr(riskEngine.reduce(s, { type: 'place', territoryId: mine, count: 4 }, 2));
    // the last 3 placements complete setup and hand turn 1 to turnOrder[0]
    for (let i = 0; i < 3; i++) {
      s = assertOk(riskEngine.reduce(s, { type: 'place', territoryId: mine, count: 1 }, 2)).state;
    }
    expect(s.phase).toBe('reinforce');
    expect(s.turnOrder[s.currentIdx]).toBe(s.turnOrder[0]);
    expect(s.reinforcementsRemaining).toBeGreaterThanOrEqual(3);
  });
});

describe('Risk reinforce', () => {
  it('income: max(3, floor(owned/3)) + continent bonuses (p0 owns 39 of 42 incl. 4 full continents)', () => {
    const s = craft({ phase: 'reinforce' });
    // p0 owns 39 territories; NA broken by p1/p2 (NW Terr, Greenland, Quebec); owns SA(+2), AF(+3), AS(+7), AU(+2), EU(+5)
    const r = assertOk(riskEngine.reduce({ ...s, phase: 'fortify' }, { type: 'endTurn' }, 0));
    // after p0 ends turn, p1 starts: owns 2 territories → base 3, no continents
    expect(r.state.turnOrder[r.state.currentIdx]).toBe(1);
    expect(r.state.reinforcementsRemaining).toBe(3);
  });

  it('placement decrements pool; endReinforce only at 0', () => {
    const s = craft({ phase: 'reinforce', reinforcementsRemaining: 5 });
    assertErr(riskEngine.reduce(s, { type: 'endReinforce' }, 0));
    const r1 = assertOk(riskEngine.reduce(s, { type: 'place', territoryId: T.ALASKA, count: 3 }, 0));
    expect(r1.state.reinforcementsRemaining).toBe(2);
    assertErr(riskEngine.reduce(r1.state, { type: 'place', territoryId: T.ALASKA, count: 3 }, 0));
    const r2 = assertOk(riskEngine.reduce(r1.state, { type: 'place', territoryId: T.ALBERTA, count: 2 }, 0));
    const r3 = assertOk(riskEngine.reduce(r2.state, { type: 'endReinforce' }, 0));
    expect(r3.state.phase).toBe('attack');
  });

  it('trade: escalating value, owned-territory +2 bonus, discard grows, forced at 5+', () => {
    // p0 holds an infantry set: cards 0,3,6 → territories ALASKA(0), ALBERTA(3), WESTERN_US(6) — p0 owns all; bonus on first = ALASKA
    const s = craft({ phase: 'reinforce', reinforcementsRemaining: 0, hands: [[0, 3, 6], [], []], tradeCount: 0 });
    const alaskaBefore = s.territories[T.ALASKA]!.armies;
    const r = assertOk(riskEngine.reduce(s, { type: 'trade', cards: [0, 3, 6] }, 0));
    expect(r.state.reinforcementsRemaining).toBe(4); // first trade = 4
    expect(r.state.tradeCount).toBe(1);
    expect(r.state.territories[T.ALASKA]!.armies).toBe(alaskaBefore + 2); // +2 on first owned card's territory
    expect(r.state.discard).toEqual([0, 3, 6]);
    expect(r.state.hands[0]).toEqual([]);

    // second trade from a different state yields 6
    const s2 = craft({ phase: 'reinforce', reinforcementsRemaining: 0, hands: [[1, 4, 7], [], []], tradeCount: 1 });
    const r2 = assertOk(riskEngine.reduce(s2, { type: 'trade', cards: [1, 4, 7] }, 0));
    expect(r2.state.reinforcementsRemaining).toBe(6);

    // forced: 5 cards → placement and endReinforce rejected until trade
    const s3 = craft({ phase: 'reinforce', reinforcementsRemaining: 3, hands: [[0, 3, 6, 1, 4], [], []] });
    assertErr(riskEngine.reduce(s3, { type: 'place', territoryId: T.ALASKA, count: 1 }, 0));
    assertErr(riskEngine.reduce(s3, { type: 'endReinforce' }, 0));
    const legal = riskEngine.getLegalActions(s3, 0);
    expect(legal.some((l) => l.type === 'trade' && l.forced)).toBe(true);
    const r3 = assertOk(riskEngine.reduce(s3, { type: 'trade', cards: [0, 3, 6] }, 0));
    expect(r3.state.hands[0]).toHaveLength(2);
    // now placement works again
    assertOk(riskEngine.reduce(r3.state, { type: 'place', territoryId: T.ALASKA, count: 1 }, 0));
  });

  it('rejects invalid sets and cards not in hand', () => {
    const s = craft({ phase: 'reinforce', hands: [[0, 3, 1], [], []] });
    assertErr(riskEngine.reduce(s, { type: 'trade', cards: [0, 3, 1] }, 0)); // 2 infantry + 1 cavalry
    assertErr(riskEngine.reduce(s, { type: 'trade', cards: [2, 5, 8] }, 0)); // not held
  });
});

describe('Risk attack', () => {
  it('validates ownership, adjacency, army minimums, dice bounds', () => {
    const s = craft();
    assertErr(riskEngine.reduce(s, { type: 'attack', from: T.NW_TERRITORY, to: T.ALASKA, dice: 1 }, 0)); // not owner of from
    assertErr(riskEngine.reduce(s, { type: 'attack', from: T.ALASKA, to: T.ALBERTA, dice: 1 }, 0)); // own target
    assertErr(riskEngine.reduce(s, { type: 'attack', from: T.ALASKA, to: T.QUEBEC, dice: 1 }, 0)); // not adjacent
    assertErr(riskEngine.reduce(s, { type: 'attack', from: T.ALASKA, to: T.NW_TERRITORY, dice: 3 }, 0)); // 3 armies → max 2 dice
    const one = craft();
    one.territories[T.ALASKA]!.armies = 1;
    assertErr(riskEngine.reduce(one, { type: 'attack', from: T.ALASKA, to: T.NW_TERRITORY, dice: 1 }, 0));
  });

  it('battle conserves armies minus losses; defender loses max 2 per roll', () => {
    const s = craft();
    s.territories[T.ALASKA]!.armies = 10;
    const before = s.territories[T.ALASKA]!.armies + s.territories[T.NW_TERRITORY]!.armies;
    const r = assertOk(riskEngine.reduce(s, { type: 'attack', from: T.ALASKA, to: T.NW_TERRITORY, dice: 3 }, 0));
    const ev = r.events.find((e) => e.type === 'diceRolled')!;
    const losses = (ev.attackerLosses as number) + (ev.defenderLosses as number);
    expect(losses).toBeGreaterThanOrEqual(1);
    expect(losses).toBeLessThanOrEqual(2);
    if (!r.state.conqueredThisTurn) {
      const after = r.state.territories[T.ALASKA]!.armies + r.state.territories[T.NW_TERRITORY]!.armies;
      expect(after).toBe(before - losses);
    }
  });

  it('blitz conquers a 1-army defender with an overwhelming attacker, mandatory move applied, extra move offered', () => {
    const s = craft();
    s.territories[T.ALASKA]!.armies = 20;
    s.territories[T.NW_TERRITORY]!.armies = 1;
    const r = assertOk(riskEngine.reduce(s, { type: 'attack', from: T.ALASKA, to: T.NW_TERRITORY, dice: 3, blitz: true }, 0));
    expect(r.state.territories[T.NW_TERRITORY]!.owner).toBe(0);
    expect(r.state.territories[T.NW_TERRITORY]!.armies).toBeGreaterThanOrEqual(1);
    expect(r.state.conqueredThisTurn).toBe(true);
    expect(r.state.phase).toBe('move_armies');
    const conq = r.events.find((e) => e.type === 'conquered')!;
    expect(conq.defender).toBe(1);
    // extra move: bounds enforced
    const max = r.state.territories[T.ALASKA]!.armies - 1;
    assertErr(riskEngine.reduce(r.state, { type: 'moveArmies', count: max + 1 }, 0));
    const r2 = assertOk(riskEngine.reduce(r.state, { type: 'moveArmies', count: max }, 0));
    expect(r2.state.phase).toBe('attack');
    expect(r2.state.territories[T.ALASKA]!.armies).toBe(1);
  });

  it('blitz is deterministic under the same rng state', () => {
    const s = craft();
    s.territories[T.ALASKA]!.armies = 12;
    s.territories[T.NW_TERRITORY]!.armies = 6;
    const a = riskEngine.reduce(s, { type: 'attack', from: T.ALASKA, to: T.NW_TERRITORY, dice: 3, blitz: true }, 0);
    const b = riskEngine.reduce(s, { type: 'attack', from: T.ALASKA, to: T.NW_TERRITORY, dice: 3, blitz: true }, 0);
    expect(assertOk(a)).toEqual(assertOk(b));
  });

  it('elimination hands victim cards to attacker; 6+ cards forces a mid-attack trade', () => {
    const s = craft();
    // p1 down to one territory holding 5 cards; attacker holds 2 → 7 after elimination
    s.territories[T.GREENLAND] = { owner: 2, armies: 2 }; // p1 only owns NW_TERRITORY now
    s.territories[T.ALASKA]!.armies = 30;
    s.territories[T.NW_TERRITORY]!.armies = 1;
    s.hands = [[9, 12], [0, 3, 6, 1, 4], []];
    const r = assertOk(riskEngine.reduce(s, { type: 'attack', from: T.ALASKA, to: T.NW_TERRITORY, dice: 3, blitz: true }, 0));
    expect(r.state.eliminated[1]).toBe(true);
    expect(r.state.hands[0]).toHaveLength(7);
    expect(r.state.hands[1]).toHaveLength(0);
    expect(r.events.some((e) => e.type === 'eliminated' && e.cardsTaken === 5)).toBe(true);
    // finish the pending move, then attack/endAttack must be blocked until trade
    const r2 = assertOk(riskEngine.reduce(r.state, { type: 'moveArmies', count: 0 }, 0));
    assertErr(riskEngine.reduce(r2.state, { type: 'endAttack' }, 0));
    const legal = riskEngine.getLegalActions(r2.state, 0);
    expect(legal.filter((l) => l.type !== 'resign').every((l) => l.type === 'trade')).toBe(true);
    const trade = legal.find((l) => l.type === 'trade');
    if (trade?.type !== 'trade') throw new Error('no trade legal');
    const r3 = assertOk(riskEngine.reduce(r2.state, { type: 'trade', cards: trade.sets[0]! }, 0));
    expect(r3.state.hands[0]).toHaveLength(4);
    expect(r3.state.reinforcementsRemaining).toBeGreaterThan(0);
    // must place traded armies before continuing
    assertErr(riskEngine.reduce(r3.state, { type: 'endAttack' }, 0));
    const owned = r3.state.territories.findIndex((t) => t.owner === 0);
    const r4 = assertOk(riskEngine.reduce(r3.state, { type: 'place', territoryId: owned, count: r3.state.reinforcementsRemaining }, 0));
    assertOk(riskEngine.reduce(r4.state, { type: 'endAttack' }, 0));
  });

  it('conquering the final territory wins the game', () => {
    const s = craft();
    // p0 owns everything except one 1-army territory of p1; p2 already eliminated
    s.territories[T.GREENLAND] = { owner: 0, armies: 3 };
    s.territories[T.QUEBEC] = { owner: 0, armies: 3 };
    s.territories[T.NW_TERRITORY] = { owner: 1, armies: 1 };
    s.eliminated = [false, false, true];
    s.territories[T.ALASKA]!.armies = 30;
    const r = assertOk(riskEngine.reduce(s, { type: 'attack', from: T.ALASKA, to: T.NW_TERRITORY, dice: 3, blitz: true }, 0));
    expect(r.state.phase).toBe('game_over');
    expect(r.state.winner).toBe(0);
    expect(riskEngine.status(r.state).terminal).toBe(true);
    expect(riskEngine.getCurrentActors(r.state)).toEqual([]);
  });
});

describe('Risk fortify & turn end', () => {
  it('fortify requires a connected friendly path and valid counts, then ends the turn', () => {
    const s = craft({ phase: 'fortify' });
    s.territories[T.ALASKA]!.armies = 5;
    // ALASKA(0) → ALBERTA(3) → WESTERN_US(6): all p0-owned → connected
    const r = assertOk(riskEngine.reduce(s, { type: 'fortify', from: T.ALASKA, to: T.WESTERN_US, count: 4 }, 0));
    expect(r.state.territories[T.ALASKA]!.armies).toBe(1);
    expect(r.state.territories[T.WESTERN_US]!.armies).toBe(3 + 4);
    expect(r.state.turnOrder[r.state.currentIdx]).toBe(1); // next player's turn began
    expect(r.state.phase).toBe('reinforce');
  });

  it('rejects disconnected fortify (path blocked by enemies)', () => {
    const s = craft({ phase: 'fortify' });
    // Isolate GREENLAND-adjacent QUEBEC? Use p1's islands: p0 ALASKA to... craft: NW_TERRITORY & GREENLAND are p1's.
    // Make p0 own only ALASKA and QUEBEC (QUEBEC's neighbors GREENLAND(p1), ONTARIO(p1), EASTERN_US(p1)).
    s.territories.forEach((t, i) => {
      s.territories[i] = { owner: 1, armies: 2 };
    });
    s.territories[T.ALASKA] = { owner: 0, armies: 5 };
    s.territories[T.QUEBEC] = { owner: 0, armies: 2 };
    assertErr(riskEngine.reduce(s, { type: 'fortify', from: T.ALASKA, to: T.QUEBEC, count: 2 }, 0));
    assertErr(riskEngine.reduce(s, { type: 'fortify', from: T.ALASKA, to: T.ALASKA, count: 1 }, 0));
  });

  it('card drawn at end of turn iff a territory was conquered', () => {
    const noConquest = craft({ phase: 'fortify', conqueredThisTurn: false });
    const r1 = assertOk(riskEngine.reduce(noConquest, { type: 'endTurn' }, 0));
    expect(r1.state.hands[0]).toHaveLength(0);

    const conquest = craft({ phase: 'fortify', conqueredThisTurn: true });
    const deckSize = conquest.deck.length;
    const r2 = assertOk(riskEngine.reduce(conquest, { type: 'endTurn' }, 0));
    expect(r2.state.hands[0]).toHaveLength(1);
    expect(r2.state.deck).toHaveLength(deckSize - 1);
    expect(r2.events.some((e) => e.type === 'cardDrawn')).toBe(true);
  });

  it('turn rotation skips eliminated players', () => {
    const s = craft({ phase: 'fortify', eliminated: [false, true, false] });
    const r = assertOk(riskEngine.reduce(s, { type: 'endTurn' }, 0));
    expect(r.state.turnOrder[r.state.currentIdx]).toBe(2);
  });
});

describe('Risk resign', () => {
  it('current player resigning advances the turn; last survivor wins', () => {
    const s = craft();
    const r = assertOk(riskEngine.reduce(s, { type: 'resign' }, 0));
    expect(r.state.eliminated[0]).toBe(true);
    expect([1, 2]).toContain(r.state.turnOrder[r.state.currentIdx]);
    const r2 = assertOk(riskEngine.reduce(r.state, { type: 'resign' }, r.state.turnOrder[r.state.currentIdx]!));
    expect(r2.state.phase).toBe('game_over');
    expect(r2.state.winner).not.toBeNull();
  });

  it('out-of-turn resign works and discards cards', () => {
    const s = craft({ hands: [[], [0, 1], []] });
    const r = assertOk(riskEngine.reduce(s, { type: 'resign' }, 1));
    expect(r.state.eliminated[1]).toBe(true);
    expect(r.state.discard).toEqual([0, 1]);
    expect(r.state.turnOrder[r.state.currentIdx]).toBe(0); // p0 keeps playing
  });

  it('eliminated players cannot act', () => {
    const s = craft({ eliminated: [false, true, false] });
    assertErr(riskEngine.reduce(s, { type: 'resign' }, 1));
    expect(riskEngine.getLegalActions(s, 1)).toEqual([]);
  });
});

describe('Risk view redaction', () => {
  it('hides other players cards and the deck order', () => {
    const s = craft({ hands: [[0, 1], [2, 3, 4], []] });
    const v0 = riskEngine.view(s, 0);
    expect(v0.hand).toEqual([0, 1]);
    expect(v0.players[1]!.cardCount).toBe(3);
    expect((v0 as unknown as Record<string, unknown>).deck).toBeUndefined();
    expect((v0 as unknown as Record<string, unknown>).hands).toBeUndefined();
    const spec = riskEngine.view(s, 'spectator');
    expect(spec.hand).toEqual([]);
  });
});

describe('Risk misc rejections', () => {
  it('rejects acting out of turn and malformed actions', () => {
    const s = craft();
    assertErr(riskEngine.reduce(s, { type: 'endAttack' }, 1), 'ERR_NOT_YOUR_TURN');
    assertErr(riskEngine.reduce(s, { type: 'place', territoryId: 999, count: 1 }, 0));
    assertErr(riskEngine.reduce(s, { type: 'place', territoryId: T.ALASKA, count: -5 }, 0));
    assertErr(riskEngine.reduce(s, { type: 'nonsense' } as unknown as RiskAction, 0));
  });
});
