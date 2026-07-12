import { describe, expect, it } from 'vitest';
import { isEngineError, type GameEvent } from '../engine.js';
import { isPlayable, UNO_DECK_SIZE, unoCard } from '../games/uno/cards.js';
import { unoEngine, type UnoLegal, type UnoState } from '../games/uno/engine.js';
import { Rng } from '../rng.js';

function ok(r: ReturnType<typeof unoEngine.reduce>): { state: UnoState; events: GameEvent[] } {
  if (isEngineError(r)) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
}
function bad(r: ReturnType<typeof unoEngine.reduce>, code?: string): void {
  if (!isEngineError(r)) throw new Error('expected error');
  if (code) expect(r.code).toBe(code);
}

function conserved(s: UnoState): void {
  const all = [...s.deck, ...s.discard, ...s.hands.flat()];
  if (all.length !== UNO_DECK_SIZE || new Set(all).size !== UNO_DECK_SIZE) {
    throw new Error(`card conservation violated: ${all.length} cards, ${new Set(all).size} unique`);
  }
}

/** Craft a controllable state: current player 0, direction 1, known top/hands. */
function craft(over: Partial<UnoState>): UnoState {
  const base = unoEngine.setup({ numPlayers: 3, seed: 1 });
  const used = new Set([...(over.hands ?? []).flat(), ...(over.discard ?? [])]);
  const deck = Array.from({ length: UNO_DECK_SIZE }, (_, i) => i).filter((c) => !used.has(c));
  return {
    ...base,
    current: 0,
    direction: 1,
    drawnCard: null,
    eliminated: [false, false, false],
    winner: null,
    deck,
    ...over,
  };
}

describe('Uno deck', () => {
  it('has the official 108-card composition', () => {
    const counts = { number: 0, skip: 0, reverse: 0, draw2: 0, wild: 0, wild4: 0 };
    const zeros = [0, 0, 0, 0];
    for (let i = 0; i < UNO_DECK_SIZE; i++) {
      const c = unoCard(i);
      counts[c.kind]++;
      if (c.kind === 'number' && c.num === 0) zeros[c.color!]++;
    }
    expect(counts).toEqual({ number: 76, skip: 8, reverse: 8, draw2: 8, wild: 4, wild4: 4 });
    expect(zeros).toEqual([1, 1, 1, 1]); // one 0 per color
  });

  it('playability: color, number, symbol, wild', () => {
    // red 5 (id: red v=9or10 → num5 → v 9 → id 9) on red 3 top
    const red5 = 9, red3 = 5, yellow5 = 25 + 9, yellow7 = 25 + 13, wild = 100, wild4 = 104, yellowSkip = 25 + 19, redSkip = 19;
    expect(unoCard(red5)).toMatchObject({ kind: 'number', color: 0, num: 5 });
    expect(isPlayable(red5, red3, 0)).toBe(true); // color match
    expect(isPlayable(yellow5, red5, 0)).toBe(true); // number match
    expect(isPlayable(yellow7, red5, 0)).toBe(false); // no match
    expect(isPlayable(wild, red5, 0)).toBe(true);
    expect(isPlayable(wild4, red5, 0)).toBe(true);
    expect(isPlayable(yellowSkip, redSkip, 0)).toBe(true); // symbol match
    expect(isPlayable(yellowSkip, red5, 0)).toBe(false);
  });
});

describe('Uno setup', () => {
  it.each([2, 4, 8])('%i players: 7 cards each, number card on top, conservation holds', (n) => {
    const s = unoEngine.setup({ numPlayers: n, seed: 5 });
    for (const h of s.hands) expect(h).toHaveLength(7);
    expect(unoCard(s.discard[s.discard.length - 1]!).kind).toBe('number');
    expect(s.activeColor).toBe(unoCard(s.discard[s.discard.length - 1]!).color);
    conserved(s);
    expect(unoEngine.setup({ numPlayers: n, seed: 5 })).toEqual(s);
  });
});

describe('Uno actions', () => {
  it('number play advances turn; wrong cards rejected', () => {
    const s = craft({ hands: [[9, 36], [50], [70]], discard: [5] }); // top red3, p0 holds red5 + yellow6
    bad(unoEngine.reduce(s, { type: 'play', card: 50 }, 0)); // not held... 50 in p1's hand
    bad(unoEngine.reduce(s, { type: 'play', card: 36 }, 0)); // yellow 6 matches neither color nor number
    bad(unoEngine.reduce(s, { type: 'play', card: 9 }, 1), 'ERR_NOT_YOUR_TURN');
    const r = ok(unoEngine.reduce(s, { type: 'play', card: 9 }, 0));
    expect(r.state.current).toBe(1);
    expect(r.state.activeColor).toBe(0);
    conserved(r.state);
  });

  it('skip jumps a player; draw2 penalizes and skips', () => {
    const s = craft({ hands: [[19, 23, 9], [50], [70]], discard: [5] }); // p0: red skip, red draw2, red5
    const r1 = ok(unoEngine.reduce(s, { type: 'play', card: 19 }, 0));
    expect(r1.state.current).toBe(2); // p1 skipped
    expect(r1.events.some((e) => e.type === 'skipped' && e.player === 1)).toBe(true);

    const r2 = ok(unoEngine.reduce(s, { type: 'play', card: 23 }, 0));
    expect(r2.state.hands[1]).toHaveLength(3); // drew 2
    expect(r2.state.current).toBe(2);
    conserved(r2.state);
  });

  it('reverse flips direction (3p) and acts as skip with 2 players', () => {
    const s3 = craft({ hands: [[21, 9], [50], [70]], discard: [5] }); // red reverse
    const r3 = ok(unoEngine.reduce(s3, { type: 'play', card: 21 }, 0));
    expect(r3.state.direction).toBe(-1);
    expect(r3.state.current).toBe(2); // reversed: previous player

    const s2 = craft({ hands: [[21, 9], [50], []], discard: [5], eliminated: [false, false, true] });
    const r2 = ok(unoEngine.reduce(s2, { type: 'play', card: 21 }, 0));
    expect(r2.state.current).toBe(0); // 2p reverse = play again
  });

  it('wild requires a color choice; wild4 penalizes 4 and skips', () => {
    const s = craft({ hands: [[100, 104, 9], [50], [70]], discard: [5] });
    bad(unoEngine.reduce(s, { type: 'play', card: 100 }, 0)); // no color
    const r1 = ok(unoEngine.reduce(s, { type: 'play', card: 100, color: 2 }, 0));
    expect(r1.state.activeColor).toBe(2);
    expect(r1.state.current).toBe(1);

    const r2 = ok(unoEngine.reduce(s, { type: 'play', card: 104, color: 3 }, 0));
    expect(r2.state.hands[1]).toHaveLength(5); // drew 4
    expect(r2.state.current).toBe(2);
    expect(r2.state.activeColor).toBe(3);
    conserved(r2.state);
  });

  it('draw-then-play: playable drawn card may be played or passed; unplayable auto-passes', () => {
    // deck top (last) = red7 (id 13): playable on red3
    const s = craft({ hands: [[36], [50], [70]], discard: [5] }); // p0 has nothing playable (yellow6 on red3)
    const s2 = { ...s, deck: [...s.deck.filter((c) => c !== 13), 13] };
    const r = ok(unoEngine.reduce(s2, { type: 'draw' }, 0));
    expect(r.state.drawnCard).toBe(13);
    expect(r.state.current).toBe(0); // still deciding
    // may not play a different card now
    bad(unoEngine.reduce(r.state, { type: 'play', card: 30 }, 0));
    // playing the drawn card works
    const rPlay = ok(unoEngine.reduce(r.state, { type: 'play', card: 13 }, 0));
    expect(rPlay.state.current).toBe(1);
    // or pass keeps it in hand
    const rPass = ok(unoEngine.reduce(r.state, { type: 'pass' }, 0));
    expect(rPass.state.hands[0]).toContain(13);
    expect(rPass.state.current).toBe(1);

    // unplayable drawn card: put a blue 9 (id 75+18=93? blue v18 → num9 → id 75+18=93) on top of deck
    const s3 = { ...s, deck: [...s.deck.filter((c) => c !== 93), 93] };
    const r3 = ok(unoEngine.reduce(s3, { type: 'draw' }, 0));
    expect(r3.state.drawnCard).toBeNull();
    expect(r3.state.current).toBe(1); // auto-passed
    expect(r3.state.hands[0]).toContain(93);
    conserved(r3.state);
  });

  it('playing the last card wins immediately', () => {
    const s = craft({ hands: [[9], [50, 51], [70, 71]], discard: [5] });
    const r = ok(unoEngine.reduce(s, { type: 'play', card: 9 }, 0));
    expect(r.state.winner).toBe(0);
    expect(unoEngine.status(r.state).terminal).toBe(true);
    expect(r.events.some((e) => e.type === 'gameOver')).toBe(true);
    bad(unoEngine.reduce(r.state, { type: 'draw' }, 1));
  });

  it('deck exhaustion reshuffles the discard minus its top card', () => {
    // crafted, deliberately non-conserved mini-state: 3 hands + 6 discard, empty deck
    const s = craft({ hands: [[36], [50], [70]], discard: [5, 6, 7, 8, 9, 3] });
    const empty = { ...s, deck: [] };
    const r = ok(unoEngine.reduce(empty, { type: 'draw' }, 0));
    // top of discard preserved; the 5 buried cards were reshuffled, 1 drawn
    expect(r.state.discard).toEqual([3]);
    expect(r.state.deck).toHaveLength(4);
    expect(r.state.hands[0]).toHaveLength(2);
  });

  it('resign removes player from rotation; last survivor wins', () => {
    const s = craft({ hands: [[9, 10], [50], [70]], discard: [5] });
    const r1 = ok(unoEngine.reduce(s, { type: 'resign' }, 1));
    expect(r1.state.eliminated[1]).toBe(true);
    conserved(r1.state);
    const r2 = ok(unoEngine.reduce(r1.state, { type: 'play', card: 9 }, 0));
    expect(r2.state.current).toBe(2); // p1 skipped in rotation
    const r3 = ok(unoEngine.reduce(r2.state, { type: 'resign' }, 2));
    expect(r3.state.winner).toBe(0);
  });
});

describe('Uno property test: random games terminate with conservation intact', () => {
  it.each([1, 2, 3, 4, 5, 6])('seed %i: 4-player random game to a winner', (seed) => {
    let s = unoEngine.setup({ numPlayers: 4, seed });
    const rng = new Rng(seed * 31);
    let steps = 0;
    while (!unoEngine.status(s).terminal) {
      if (++steps > 20_000) throw new Error('did not terminate');
      const p = unoEngine.getCurrentActors(s)[0]!;
      const legal = unoEngine.getLegalActions(s, p) as UnoLegal[];
      const play = legal.find((l): l is Extract<UnoLegal, { type: 'play' }> => l.type === 'play');
      let r: ReturnType<typeof unoEngine.reduce>;
      if (play && rng.next() < 0.95) {
        const card = play.cards[rng.int(play.cards.length)]!;
        const needsColor = play.wildCards.includes(card);
        r = unoEngine.reduce(s, { type: 'play', card, ...(needsColor ? { color: rng.int(4) as 0 | 1 | 2 | 3 } : {}) }, p);
      } else if (legal.some((l) => l.type === 'pass') && rng.next() < 0.5) {
        r = unoEngine.reduce(s, { type: 'pass' }, p);
      } else if (legal.some((l) => l.type === 'draw')) {
        r = unoEngine.reduce(s, { type: 'draw' }, p);
      } else {
        r = unoEngine.reduce(s, { type: 'pass' }, p);
      }
      if (isEngineError(r)) throw new Error(`step ${steps}: ${r.code} ${r.message}`);
      s = r.state;
      conserved(s);
    }
    expect(unoEngine.status(s).winners).toHaveLength(1);
    expect(s.hands[s.winner!]).toHaveLength(0);
  });
});
