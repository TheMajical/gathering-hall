import { describe, expect, it } from 'vitest';
import { evaluate5CardHand, evaluateHoldemHand } from '../games/poker/evaluator.js';

// Helper to construct cards: H=Hearts(0), D=Diamonds(1), C=Clubs(2), S=Spades(3)
const H = (rank: number) => 0 * 13 + rank;
const D = (rank: number) => 1 * 13 + rank;
const C = (rank: number) => 2 * 13 + rank;
const S = (rank: number) => 3 * 13 + rank;

// Ranks: 2=0, 3=1, 4=2, 5=3, 6=4, 7=5, 8=6, 9=7, 10=8, J=9, Q=10, K=11, A=12

describe('Poker Hand Evaluator (5-card)', () => {
  it('detects Royal Flush and Straight Flush', () => {
    // Royal flush: 10, J, Q, K, A of Spades
    const royal = [S(8), S(9), S(10), S(11), S(12)];
    const royalEval = evaluate5CardHand(royal);
    expect(royalEval.category).toBe('straightFlush');
    expect(royalEval.label).toBe('Royal Flush');

    // 9-high Straight Flush: 5, 6, 7, 8, 9 of Hearts
    const sf = [H(3), H(4), H(5), H(6), H(7)];
    const sfEval = evaluate5CardHand(sf);
    expect(sfEval.category).toBe('straightFlush');
    expect(sfEval.label).toContain('Straight Flush');
    expect(royalEval.score).toBeGreaterThan(sfEval.score);
  });

  it('detects Wheel Straight (A-2-3-4-5) and 6-high straight', () => {
    // Wheel: A(12), 2(0), 3(1), 4(2), 5(3) of mixed suits
    const wheel = [H(12), D(0), C(1), S(2), H(3)];
    const wheelEval = evaluate5CardHand(wheel);
    expect(wheelEval.category).toBe('straight');
    expect(wheelEval.label).toBe('Straight, 5 High');

    // 6-high straight: 2(0), 3(1), 4(2), 5(3), 6(4)
    const sixHigh = [H(0), D(1), C(2), S(3), H(4)];
    const sixEval = evaluate5CardHand(sixHigh);
    expect(sixEval.category).toBe('straight');
    expect(sixEval.label).toBe('Straight, 6 High');

    // 6-high straight beats 5-high wheel straight
    expect(sixEval.score).toBeGreaterThan(wheelEval.score);
  });

  it('detects Four of a Kind, Full House, Flush, Three of a Kind, Two Pair, One Pair, High Card', () => {
    const quads = [H(12), D(12), C(12), S(12), H(11)]; // 4 Aces + King
    const fullHouse = [H(11), D(11), C(11), S(8), H(8)]; // Kings full of 10s
    const flush = [H(0), H(3), H(6), H(9), H(12)]; // Hearts flush (Ace high)
    const straight = [H(6), D(7), C(8), S(9), H(10)]; // 8-9-10-J-Q
    const trips = [H(9), D(9), C(9), S(12), H(11)]; // 3 Jacks + Ace + King
    const twoPair = [H(12), D(12), C(8), S(8), H(11)]; // Aces and 10s + King
    const onePair = [H(10), D(10), C(12), S(11), H(8)]; // Pair of Queens + A, K, 10
    const highCard = [H(12), D(10), C(7), S(4), H(1)]; // A, Q, 9, 6, 3

    const qEval = evaluate5CardHand(quads);
    const fhEval = evaluate5CardHand(fullHouse);
    const fEval = evaluate5CardHand(flush);
    const sEval = evaluate5CardHand(straight);
    const tEval = evaluate5CardHand(trips);
    const tpEval = evaluate5CardHand(twoPair);
    const opEval = evaluate5CardHand(onePair);
    const hcEval = evaluate5CardHand(highCard);

    expect(qEval.category).toBe('fourOfAKind');
    expect(fhEval.category).toBe('fullHouse');
    expect(fEval.category).toBe('flush');
    expect(sEval.category).toBe('straight');
    expect(tEval.category).toBe('threeOfAKind');
    expect(tpEval.category).toBe('twoPair');
    expect(opEval.category).toBe('onePair');
    expect(hcEval.category).toBe('highCard');

    // Invariant: ranking order
    expect(qEval.score).toBeGreaterThan(fhEval.score);
    expect(fhEval.score).toBeGreaterThan(fEval.score);
    expect(fEval.score).toBeGreaterThan(sEval.score);
    expect(sEval.score).toBeGreaterThan(tEval.score);
    expect(tEval.score).toBeGreaterThan(tpEval.score);
    expect(tpEval.score).toBeGreaterThan(opEval.score);
    expect(opEval.score).toBeGreaterThan(hcEval.score);
  });

  it('tiebreaks properly with kickers', () => {
    // Pair of Aces with King kicker beats Pair of Aces with Queen kicker
    const pairAKicker = [H(12), D(12), C(11), S(5), H(2)];
    const pairAQKicker = [H(12), D(12), C(10), S(5), H(2)];
    expect(evaluate5CardHand(pairAKicker).score).toBeGreaterThan(evaluate5CardHand(pairAQKicker).score);

    // Two Pair: Aces & 5s beats Kings & Queens
    const acesAndFives = [H(12), D(12), C(3), S(3), H(11)];
    const kingsAndQueens = [H(11), D(11), C(10), S(10), H(12)];
    expect(evaluate5CardHand(acesAndFives).score).toBeGreaterThan(evaluate5CardHand(kingsAndQueens).score);
  });
});

describe('Holdem 7-card evaluator', () => {
  it('selects best 5 cards from 7 community + hole cards', () => {
    // Hole: Ace of Spades, King of Spades
    const hole = [S(12), S(11)];
    // Community: Queen of Spades, Jack of Spades, 10 of Spades, 2 of Hearts, 3 of Diamonds
    const board = [S(10), S(9), S(8), H(0), D(1)];

    const result = evaluateHoldemHand([...hole, ...board]);
    expect(result.category).toBe('straightFlush');
    expect(result.label).toBe('Royal Flush');
    expect(result.bestCards).toHaveLength(5);
    expect(result.bestCards).not.toContain(H(0));
    expect(result.bestCards).not.toContain(D(1));
  });

  it('handles pocket pairs and board pairing to full house', () => {
    // Hole: 7 of Hearts, 7 of Diamonds
    const hole = [H(5), D(5)];
    // Board: 7 of Clubs, King of Hearts, King of Spades, 2 of Clubs, 3 of Clubs
    const board = [C(5), H(11), S(11), C(0), C(1)];

    const result = evaluateHoldemHand([...hole, ...board]);
    expect(result.category).toBe('fullHouse');
    expect(result.label).toBe('Full House, 7s full of Kings');
  });
});
