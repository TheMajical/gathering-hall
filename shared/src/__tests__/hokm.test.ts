import { describe, expect, it } from 'vitest';
import { isEngineError, type GameEvent } from '../engine.js';
import { baseDeck, handSize, rankOf, suitOf, trickWinner } from '../games/hokm/cards.js';
import { hokmEngine, type HokmLegal, type HokmState } from '../games/hokm/engine.js';
import { Rng } from '../rng.js';

function ok(r: ReturnType<typeof hokmEngine.reduce>): { state: HokmState; events: GameEvent[] } {
  if (isEngineError(r)) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
}
function bad(r: ReturnType<typeof hokmEngine.reduce>, code?: string): void {
  if (!isEngineError(r)) throw new Error('expected error');
  if (code) expect(r.code).toBe(code);
}

/** Setup + hakem picks trump 0 → into trick play. */
function started(numPlayers: number, seed = 5): HokmState {
  const s = hokmEngine.setup({ numPlayers, seed });
  return ok(hokmEngine.reduce(s, { type: 'chooseTrump', suit: 0 }, s.hakem)).state;
}

function conserved(s: HokmState): void {
  const inPlay = [...s.hands.flat(), ...s.trick.map((t) => t.card), ...s.undealt];
  expect(new Set(inPlay).size).toBe(inPlay.length); // no duplicates ever
}

describe('Hokm cards', () => {
  it('deck per mode: 52 / 51 (no 2♦) / 52; hand sizes 13/17/13', () => {
    expect(baseDeck(2)).toHaveLength(52);
    expect(baseDeck(4)).toHaveLength(52);
    expect(baseDeck(3)).toHaveLength(51);
    expect(baseDeck(3)).not.toContain(13); // 2♦ removed
    expect(handSize(2)).toBe(13);
    expect(handSize(3)).toBe(17);
    expect(handSize(4)).toBe(13);
  });

  it('trick resolution: follow-suit highest wins; trump cuts; higher trump beats lower', () => {
    // trump = spades (3). led hearts.
    const H = (r: number) => 0 * 13 + r;
    const S = (r: number) => 3 * 13 + r;
    // no trump: highest heart wins
    expect(trickWinner([{ player: 0, card: H(5) }, { player: 1, card: H(9) }, { player: 2, card: H(2) }], 3)).toBe(1);
    // off-suit non-trump can never win
    expect(trickWinner([{ player: 0, card: H(3) }, { player: 1, card: 1 * 13 + 12 }], 3)).toBe(0);
    // trump cuts
    expect(trickWinner([{ player: 0, card: H(12) }, { player: 1, card: S(0) }], 3)).toBe(1);
    // higher trump beats lower trump
    expect(
      trickWinner([{ player: 0, card: S(4) }, { player: 1, card: S(11) }, { player: 2, card: H(12) }], 3),
    ).toBe(1);
  });
});

describe('Hokm dealing & trump', () => {
  it.each([2, 3, 4])('%ip: hakem previews 5 cards, others 0; full deal after trump', (n) => {
    const s = hokmEngine.setup({ numPlayers: n, seed: 9 });
    expect(s.phase).toBe('trump');
    expect(s.hands[s.hakem]).toHaveLength(5);
    for (let p = 0; p < n; p++) if (p !== s.hakem) expect(s.hands[p]).toHaveLength(0);
    // only hakem may act, and only chooseTrump
    const legal = hokmEngine.getLegalActions(s, s.hakem) as HokmLegal[];
    expect(legal.some((l) => l.type === 'chooseTrump')).toBe(true);
    const other = (s.hakem + 1) % n;
    bad(hokmEngine.reduce(s, { type: 'chooseTrump', suit: 1 }, other), 'ERR_NOT_YOUR_TURN');
    bad(hokmEngine.reduce(s, { type: 'play', card: s.hands[s.hakem]![0]! }, s.hakem));

    const r = ok(hokmEngine.reduce(s, { type: 'chooseTrump', suit: 2 }, s.hakem));
    expect(r.state.trump).toBe(2);
    expect(r.state.phase).toBe('trick');
    for (let p = 0; p < n; p++) expect(r.state.hands[p]).toHaveLength(handSize(n));
    expect(r.state.undealt).toHaveLength(0);
    expect(r.state.leader).toBe(s.hakem); // hakem leads the first trick
    conserved(r.state);
    expect(hokmEngine.setup({ numPlayers: n, seed: 9 })).toEqual(s); // deterministic
  });

  it('2p: exactly 26 cards in play, 26 dead', () => {
    const s = started(2);
    const inPlay = s.hands.flat();
    expect(inPlay).toHaveLength(26);
    expect(new Set(inPlay).size).toBe(26);
  });
});

describe('Hokm trick play', () => {
  it('enforces follow-suit; allows cutting when void', () => {
    const s = started(4, 11);
    const leader = s.leader;
    const lead = s.hands[leader]![0]!;
    const r1 = ok(hokmEngine.reduce(s, { type: 'play', card: lead }, leader));
    const next = (leader + 1) % 4;
    const led = suitOf(lead);
    const hand = r1.state.hands[next]!;
    const followers = hand.filter((c) => suitOf(c) === led);
    if (followers.length > 0) {
      const offSuit = hand.find((c) => suitOf(c) !== led);
      if (offSuit !== undefined) bad(hokmEngine.reduce(r1.state, { type: 'play', card: offSuit }, next));
      ok(hokmEngine.reduce(r1.state, { type: 'play', card: followers[0]! }, next));
    } else {
      ok(hokmEngine.reduce(r1.state, { type: 'play', card: hand[0]! }, next)); // void → anything
    }
    // playing a card you don't hold / out of turn
    bad(hokmEngine.reduce(r1.state, { type: 'play', card: lead }, next));
    bad(hokmEngine.reduce(r1.state, { type: 'play', card: r1.state.hands[leader]![0]! }, leader), 'ERR_NOT_YOUR_TURN');
  });

  it('completed trick: winner collects it and leads the next one', () => {
    let s = started(3, 13);
    for (let i = 0; i < 3; i++) {
      const p = hokmEngine.getCurrentActors(s)[0]!;
      const legal = hokmEngine.getLegalActions(s, p).find((l) => l.type === 'play');
      if (legal?.type !== 'play') throw new Error('no play');
      s = ok(hokmEngine.reduce(s, { type: 'play', card: legal.cards[0]! }, p)).state;
    }
    expect(s.trick).toHaveLength(0);
    expect(s.lastTrick).not.toBeNull();
    expect(s.tricksWon.reduce((a, b) => a + b, 0)).toBe(1);
    expect(s.leader).toBe(s.lastTrick!.winner);
    conserved(s);
  });
});

describe('Hokm scoring', () => {
  /** Play a full hand with a deterministic policy; returns final state + events seen. */
  function playHand(s: HokmState, rng: Rng): { state: HokmState; events: GameEvent[] } {
    let state = s;
    const all: GameEvent[] = [];
    let guard = 0;
    const startHand = state.handNumber;
    while (state.phase !== 'game_over' && state.handNumber === startHand && guard++ < 300) {
      const p = hokmEngine.getCurrentActors(state)[0]!;
      const legal = hokmEngine.getLegalActions(state, p) as HokmLegal[];
      const trump = legal.find((l) => l.type === 'chooseTrump');
      let r;
      if (trump?.type === 'chooseTrump') {
        r = hokmEngine.reduce(state, { type: 'chooseTrump', suit: trump.suits[rng.int(4)]! }, p);
      } else {
        const play = legal.find((l) => l.type === 'play');
        if (play?.type !== 'play') throw new Error('no legal play');
        r = hokmEngine.reduce(state, { type: 'play', card: play.cards[rng.int(play.cards.length)]! }, p);
      }
      const res = ok(r);
      state = res.state;
      all.push(...res.events);
      conserved(state);
    }
    return { state, events: all };
  }

  it('a hand ends when a side reaches 7 tricks; points awarded; hakem rotates correctly', () => {
    const s = hokmEngine.setup({ numPlayers: 4, seed: 21 });
    const rng = new Rng(77);
    const before = s.hakem;
    const { state, events } = playHand(s, rng);
    const handWon = events.find((e) => e.type === 'handWon');
    expect(handWon).toBeDefined();
    const winSide = handWon!.side as number;
    expect(state.points[winSide]).toBeGreaterThanOrEqual(1);
    if (winSide === before % 2) expect(state.hakem).toBe(before); // hakem's side won → stays
    else expect(state.hakem % 2).toBe(winSide); // lost → passed to winning side
    // next hand re-dealt
    expect(state.phase === 'trump' || state.phase === 'game_over').toBe(true);
  });

  it('kot scoring: a 7–0 sweep pays 2, hakem kot pays 3', () => {
    // craft the end of a hand directly: side 0 at 6 tricks, side 1 at 0,
    // player 0 about to win the last trick with the ace of trump.
    const s = started(4, 31);
    s.trump = 3;
    s.tricksWon = [6, 0, 0, 0];
    s.hakem = 0; // winner IS hakem's side → plain kot (2)
    s.leader = 0;
    s.trick = [];
    s.hands = [[3 * 13 + 12], [0], [1], [2]]; // p0 holds A♠ (trump)
    let st = s;
    for (const [p, c] of [[0, 3 * 13 + 12], [1, 0], [2, 1], [3, 2]] as const) {
      st = ok(hokmEngine.reduce(st, { type: 'play', card: c }, p)).state;
    }
    expect(st.points[0]).toBe(2); // kot

    // hakem kot: same but hakem on the SWEPT side
    const s2 = started(4, 31);
    s2.trump = 3;
    s2.tricksWon = [6, 0, 0, 0];
    s2.hakem = 1; // side 1 gets swept while holding the hakem → 3 points
    s2.leader = 0;
    s2.trick = [];
    s2.hands = [[3 * 13 + 12], [0], [1], [2]];
    let st2 = s2;
    for (const [p, c] of [[0, 3 * 13 + 12], [1, 0], [2, 1], [3, 2]] as const) {
      st2 = ok(hokmEngine.reduce(st2, { type: 'play', card: c }, p)).state;
    }
    expect(st2.points[0]).toBe(3); // hakem kot
    expect(st2.hakem % 2).toBe(0); // hakem passed to the winning team
  });

  it('resign forfeits the match: 4p → opposing team wins; 2p → opponent wins', () => {
    const s4 = started(4);
    const r4 = ok(hokmEngine.reduce(s4, { type: 'resign' }, 0));
    expect(r4.state.phase).toBe('game_over');
    expect(r4.state.winners.sort()).toEqual([1, 3]);

    const s2 = started(2);
    const r2 = ok(hokmEngine.reduce(s2, { type: 'resign' }, 1));
    expect(r2.state.winners).toEqual([0]);
  });

  it('view redaction: only your own hand is visible', () => {
    const s = started(4, 41);
    const v = hokmEngine.view(s, 2);
    expect(v.hand).toEqual([...s.hands[2]!].sort((a, b) => a - b));
    expect(v.handCounts).toEqual(s.hands.map((h) => h.length));
    expect((v as unknown as Record<string, unknown>).hands).toBeUndefined();
    expect(hokmEngine.view(s, 'spectator').hand).toEqual([]);
  });
});

describe('Hokm property test: full random matches', () => {
  it.each([
    [2, 1], [2, 2],
    [3, 1], [3, 2],
    [4, 1], [4, 2], [4, 3],
  ])('%ip match (seed %i) runs to a winner with cards conserved', (n, seed) => {
    let s = hokmEngine.setup({ numPlayers: n, seed });
    const rng = new Rng(seed * 7919);
    let steps = 0;
    while (!hokmEngine.status(s).terminal) {
      if (++steps > 30_000) throw new Error(`no winner after ${steps} steps (hand ${s.handNumber})`);
      const p = hokmEngine.getCurrentActors(s)[0]!;
      const legal = hokmEngine.getLegalActions(s, p) as HokmLegal[];
      const trump = legal.find((l) => l.type === 'chooseTrump');
      let r;
      if (trump?.type === 'chooseTrump') {
        r = hokmEngine.reduce(s, { type: 'chooseTrump', suit: (rng.int(4) as 0 | 1 | 2 | 3) }, p);
      } else {
        const play = legal.find((l) => l.type === 'play');
        if (play?.type !== 'play') throw new Error(`no play for p${p}`);
        r = hokmEngine.reduce(s, { type: 'play', card: play.cards[rng.int(play.cards.length)]! }, p);
      }
      if (isEngineError(r)) throw new Error(`step ${steps}: ${r.code} ${r.message}`);
      s = r.state;
      const inPlay = [...s.hands.flat(), ...s.trick.map((t) => t.card), ...s.undealt];
      if (new Set(inPlay).size !== inPlay.length) throw new Error(`step ${steps}: duplicate card`);
      // side points can only be < POINTS+3
      for (const pt of s.points) if (pt < 0 || pt > 9) throw new Error(`bad points ${pt}`);
    }
    expect(s.winners.length).toBeGreaterThan(0);
    const winnerSide = n === 4 ? s.winners[0]! % 2 : s.winners[0]!;
    expect(s.points[winnerSide]).toBeGreaterThanOrEqual(7);
    // determinism
    if (seed === 1) {
      const rerun = hokmEngine.setup({ numPlayers: n, seed });
      expect(rerun).toEqual(hokmEngine.setup({ numPlayers: n, seed }));
    }
  }, 60_000);

  it('rank ordering sanity: ace beats king within a suit', () => {
    expect(rankOf(12)).toBeGreaterThan(rankOf(11));
  });
});
