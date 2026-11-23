import { describe, expect, it } from 'vitest';
import { isEngineError, type GameEvent, type PlayerId } from '../engine.js';
import {
  SHELEM_BID,
  TOTAL_HAND_POINTS,
  cardPointValue,
  shelemDeck,
  trickScore,
} from '../games/shelem/cards.js';
import {
  shelemEngine,
  sideOf,
  type ShelemLegal,
  type ShelemState,
} from '../games/shelem/engine.js';
import { Rng } from '../rng.js';

function ok(r: ReturnType<typeof shelemEngine.reduce>): { state: ShelemState; events: GameEvent[] } {
  if (isEngineError(r)) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
}

function bad(r: ReturnType<typeof shelemEngine.reduce>, code?: string): void {
  if (!isEngineError(r)) throw new Error('expected error');
  if (code) expect(r.code).toBe(code);
}

describe('Shelem cards and point math', () => {
  it('total card points = 100, total tricks = 13 (65 pts), grand total = 165 pts', () => {
    const deck = shelemDeck();
    expect(deck).toHaveLength(52);

    let totalCardPts = 0;
    for (const c of deck) {
      totalCardPts += cardPointValue(c);
    }
    expect(totalCardPts).toBe(100);

    const totalHandPts = totalCardPts + 13 * 5;
    expect(totalHandPts).toBe(TOTAL_HAND_POINTS); // 165
  });

  it('cardPointValue correctly values Aces(10), 10s(10), 5s(5) and others(0)', () => {
    // Suit 0 (Hearts): Ace is card 12, 10 is card 8, 5 is card 3, 2 is card 0, King is card 11
    expect(cardPointValue(12)).toBe(10);
    expect(cardPointValue(8)).toBe(10);
    expect(cardPointValue(3)).toBe(5);
    expect(cardPointValue(0)).toBe(0);
    expect(cardPointValue(11)).toBe(0);
    expect(cardPointValue(10)).toBe(0); // Queen
  });

  it('trickScore adds 5 bonus to card points', () => {
    // 4 cards: Ace (10), 10 (10), 5 (5), 2 (0) -> 25 + 5 = 30
    expect(trickScore([12, 8, 3, 0])).toBe(30);
    // 4 low cards -> 0 + 5 = 5
    expect(trickScore([0, 1, 2, 4])).toBe(5);
  });
});

describe('Shelem bidding and widow', () => {
  it('deals 12 cards to 4 players and 4 to the ground; bidding starts at (dealer+1)%4', () => {
    const s = shelemEngine.setup({ numPlayers: 4, seed: 1234 });
    expect(s.phase).toBe('bidding');
    expect(s.ground).toHaveLength(4);
    for (let p = 0; p < 4; p++) {
      expect(s.hands[p]).toHaveLength(12);
    }
    expect(s.currentActor).toBe((s.dealer + 1) % 4);

    const legal = shelemEngine.getLegalActions(s, s.currentActor) as ShelemLegal[];
    const bidL = legal.find((l): l is Extract<ShelemLegal, { type: 'bid' }> => l.type === 'bid');
    expect(bidL).toBeDefined();
    expect(bidL!.amounts[0]).toBe(100);
    expect(bidL!.amounts[bidL!.amounts.length - 1]).toBe(165);
  });

  it('bidding increments and auction winner gets 4 ground cards and becomes Hakem', () => {
    let s = shelemEngine.setup({ numPlayers: 4, seed: 42 });
    const p1 = s.currentActor;
    // p1 bids 100
    s = ok(shelemEngine.reduce(s, { type: 'bid', amount: 100 }, p1)).state;
    expect(s.currentBid).toBe(100);
    expect(s.highestBidder).toBe(p1);

    const p2 = s.currentActor;
    // p2 cannot bid 100 again or 103 (must be higher, multiple of 5)
    bad(shelemEngine.reduce(s, { type: 'bid', amount: 100 }, p2));
    bad(shelemEngine.reduce(s, { type: 'bid', amount: 103 }, p2));

    // p2 passes
    s = ok(shelemEngine.reduce(s, { type: 'pass' }, p2)).state;

    const p3 = s.currentActor;
    // p3 raises to 110
    s = ok(shelemEngine.reduce(s, { type: 'bid', amount: 110 }, p3)).state;
    expect(s.currentBid).toBe(110);
    expect(s.highestBidder).toBe(p3);

    const p4 = s.currentActor;
    // p4 passes
    s = ok(shelemEngine.reduce(s, { type: 'pass' }, p4)).state;

    // back to p1, p1 passes
    expect(s.currentActor).toBe(p1);
    s = ok(shelemEngine.reduce(s, { type: 'pass' }, p1)).state;

    // Auction won by p3!
    expect(s.phase).toBe('widow');
    expect(s.hakem).toBe(p3);
    expect(s.targetBid).toBe(110);
    expect(s.hands[p3]).toHaveLength(16); // 12 + 4 ground cards
    expect(s.ground).toHaveLength(0);
    expect(s.currentActor).toBe(p3);
  });

  it('widow phase requires choosing trump and discarding 4 cards to start trick play', () => {
    let s = shelemEngine.setup({ numPlayers: 4, seed: 10 });
    const p1 = s.currentActor;
    // p1 bids shelem (165) -> wins auction immediately
    s = ok(shelemEngine.reduce(s, { type: 'bid', amount: SHELEM_BID }, p1)).state;
    expect(s.phase).toBe('widow');
    expect(s.hakem).toBe(p1);

    const hakemHand = [...s.hands[p1]!];
    expect(hakemHand).toHaveLength(16);

    // cannot play cards yet
    bad(shelemEngine.reduce(s, { type: 'play', card: hakemHand[0]! }, p1));

    // Choose trump
    s = ok(shelemEngine.reduce(s, { type: 'chooseTrump', suit: 1 }, p1)).state;
    expect(s.trump).toBe(1);
    expect(s.phase).toBe('widow'); // still need to discard 4 cards

    // Invalid discard (3 cards instead of 4)
    bad(shelemEngine.reduce(s, { type: 'discardGround', cards: hakemHand.slice(0, 3) }, p1));

    // Discard 4 cards
    const discards = hakemHand.slice(0, 4);
    s = ok(shelemEngine.reduce(s, { type: 'discardGround', cards: discards }, p1)).state;
    expect(s.buriedGround).toEqual(discards);
    expect(s.hands[p1]).toHaveLength(12);
    expect(s.phase).toBe('trick');
    expect(s.leader).toBe(p1);
    expect(s.currentActor).toBe(p1);
  });
});

describe('Shelem property test: full random matches', () => {
  it.each([1, 2, 3])('match (seed %i) runs to a winner with cards conserved', (seed) => {
    let s = shelemEngine.setup({ numPlayers: 4, seed });
    const rng = new Rng(seed * 7919);
    let steps = 0;

    while (!shelemEngine.status(s).terminal) {
      if (++steps > 25_000) throw new Error(`no winner after ${steps} steps (hand ${s.handNumber})`);
      const actor = shelemEngine.getCurrentActors(s)[0]!;
      const legals = shelemEngine.getLegalActions(s, actor);
      expect(legals.length).toBeGreaterThan(0);

      if (s.phase === 'bidding') {
        const bidAction = legals.find((l): l is Extract<ShelemLegal, { type: 'bid' }> => l.type === 'bid');
        // If someone already bid, 60% chance to pass to let auctions finish cleanly
        if (bidAction && bidAction.amounts.length > 0 && (s.currentBid === 0 || rng.next() > 0.6)) {
          const amount = bidAction.amounts[0]!;
          s = ok(shelemEngine.reduce(s, { type: 'bid', amount }, actor)).state;
        } else {
          s = ok(shelemEngine.reduce(s, { type: 'pass' }, actor)).state;
        }
      } else if (s.phase === 'widow') {
        if (s.trump === null) {
          const suit = rng.int(4) as 0 | 1 | 2 | 3;
          s = ok(shelemEngine.reduce(s, { type: 'chooseTrump', suit }, actor)).state;
        } else {
          const cards = s.hands[actor]!.slice(0, 4);
          s = ok(shelemEngine.reduce(s, { type: 'discardGround', cards }, actor)).state;
        }
      } else if (s.phase === 'trick') {
        const playAction = legals.find((l): l is Extract<ShelemLegal, { type: 'play' }> => l.type === 'play');
        expect(playAction).toBeDefined();
        const card = playAction!.cards[rng.int(playAction!.cards.length)]!;
        s = ok(shelemEngine.reduce(s, { type: 'play', card }, actor)).state;
      }

      // Check card conservation
      const inPlay = [...s.hands.flat(), ...s.trick.map((t) => t.card), ...s.ground];
      expect(new Set(inPlay).size).toBe(inPlay.length);
    }

    expect(shelemEngine.status(s).terminal).toBe(true);
    expect(s.winners.length).toBe(2);
    expect(sideOf(s.winners[0]!)).toBe(sideOf(s.winners[1]!));
  });
});
