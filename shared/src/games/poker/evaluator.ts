/**
 * Texas Hold'em 5-card & 7-card Poker Hand Evaluator.
 * Pure TypeScript, zero dependencies.
 */
import { cardRankName, rankOf, suitOf } from './cards.js';

export type HandCategory =
  | 'highCard'
  | 'onePair'
  | 'twoPair'
  | 'threeOfAKind'
  | 'straight'
  | 'flush'
  | 'fullHouse'
  | 'fourOfAKind'
  | 'straightFlush';

export interface HandEvaluation {
  category: HandCategory;
  categoryRank: number; // 0..8
  score: number;        // integer for exact comparison
  label: string;        // human-readable description
  bestCards: number[];  // the 5 cards forming the hand
}

/** Check if 5 sorted ranks (descending) form a straight. Returns high card rank or null. */
function checkStraight(ranks: number[]): number | null {
  // Normal straight: 5 consecutive ranks
  if (
    ranks[0]! - 1 === ranks[1]! &&
    ranks[1]! - 1 === ranks[2]! &&
    ranks[2]! - 1 === ranks[3]! &&
    ranks[3]! - 1 === ranks[4]!
  ) {
    return ranks[0]!;
  }
  // Wheel straight: Ace-2-3-4-5 (ranks 12, 3, 2, 1, 0) -> high card is 5 (rank 3)
  if (
    ranks[0] === 12 &&
    ranks[1] === 3 &&
    ranks[2] === 2 &&
    ranks[3] === 1 &&
    ranks[4] === 0
  ) {
    return 3;
  }
  return null;
}

/** Score a single 5-card hand. */
export function evaluate5CardHand(cards: number[]): HandEvaluation {
  if (cards.length !== 5) {
    throw new Error(`Expected 5 cards, got ${cards.length}`);
  }

  // Group by rank
  const counts = new Map<number, number>();
  for (const c of cards) {
    const r = rankOf(c);
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }

  // Sort groups by count descending, then rank descending
  const groups = Array.from(counts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });

  const isFlush = cards.every((c) => suitOf(c) === suitOf(cards[0]!));
  const sortedRanks = cards.map(rankOf).sort((a, b) => b - a);
  const straightHigh = checkStraight(sortedRanks);
  const isStraight = straightHigh !== null;

  // Encode tiebreak score helper: category * 16^5 + r0 * 16^4 + r1 * 16^3 + ...
  const encodeScore = (cat: number, tiebreakers: number[]) => {
    let s = cat;
    for (let i = 0; i < 5; i++) {
      s = s * 16 + (tiebreakers[i] ?? 0);
    }
    return s;
  };

  // 1. Straight Flush / Royal Flush
  if (isFlush && isStraight) {
    const isRoyal = straightHigh === 12;
    const label = isRoyal ? 'Royal Flush' : `Straight Flush, ${cardRankName(straightHigh)} High`;
    return {
      category: 'straightFlush',
      categoryRank: 8,
      score: encodeScore(8, [straightHigh]),
      label,
      bestCards: cards,
    };
  }

  // 2. Four of a Kind
  if (groups[0]![1] === 4) {
    const quadRank = groups[0]![0];
    const kicker = groups[1]![0];
    return {
      category: 'fourOfAKind',
      categoryRank: 7,
      score: encodeScore(7, [quadRank, kicker]),
      label: `Four of a Kind, ${cardRankName(quadRank, true)}`,
      bestCards: cards,
    };
  }

  // 3. Full House
  if (groups[0]![1] === 3 && groups[1]![1] === 2) {
    const tripRank = groups[0]![0];
    const pairRank = groups[1]![0];
    return {
      category: 'fullHouse',
      categoryRank: 6,
      score: encodeScore(6, [tripRank, pairRank]),
      label: `Full House, ${cardRankName(tripRank, true)} full of ${cardRankName(pairRank, true)}`,
      bestCards: cards,
    };
  }

  // 4. Flush
  if (isFlush) {
    return {
      category: 'flush',
      categoryRank: 5,
      score: encodeScore(5, sortedRanks),
      label: `Flush, ${cardRankName(sortedRanks[0]!)} High`,
      bestCards: cards,
    };
  }

  // 5. Straight
  if (isStraight) {
    return {
      category: 'straight',
      categoryRank: 4,
      score: encodeScore(4, [straightHigh]),
      label: `Straight, ${cardRankName(straightHigh)} High`,
      bestCards: cards,
    };
  }

  // 6. Three of a Kind
  if (groups[0]![1] === 3) {
    const tripRank = groups[0]![0];
    const kickers = [groups[1]![0], groups[2]![0]];
    return {
      category: 'threeOfAKind',
      categoryRank: 3,
      score: encodeScore(3, [tripRank, ...kickers]),
      label: `Three of a Kind, ${cardRankName(tripRank, true)}`,
      bestCards: cards,
    };
  }

  // 7. Two Pair
  if (groups[0]![1] === 2 && groups[1]![1] === 2) {
    const highPair = Math.max(groups[0]![0], groups[1]![0]);
    const lowPair = Math.min(groups[0]![0], groups[1]![0]);
    const kicker = groups[2]![0];
    return {
      category: 'twoPair',
      categoryRank: 2,
      score: encodeScore(2, [highPair, lowPair, kicker]),
      label: `Two Pair, ${cardRankName(highPair, true)} and ${cardRankName(lowPair, true)}`,
      bestCards: cards,
    };
  }

  // 8. One Pair
  if (groups[0]![1] === 2) {
    const pairRank = groups[0]![0];
    const kickers = [groups[1]![0], groups[2]![0], groups[3]![0]];
    return {
      category: 'onePair',
      categoryRank: 1,
      score: encodeScore(1, [pairRank, ...kickers]),
      label: `Pair of ${cardRankName(pairRank, true)}`,
      bestCards: cards,
    };
  }

  // 9. High Card
  return {
    category: 'highCard',
    categoryRank: 0,
    score: encodeScore(0, sortedRanks),
    label: `High Card, ${cardRankName(sortedRanks[0]!)}`,
    bestCards: cards,
  };
}

/** Combinations helper: choose k elements from array. */
function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [head, ...tail] = arr;
  const withHead = combinations(tail, k - 1).map((c) => [head!, ...c]);
  const withoutHead = combinations(tail, k);
  return [...withHead, ...withoutHead];
}

/** Evaluate the best 5-card hand out of 5 to 7 cards (e.g., Texas Hold'em 2 hole + 5 community). */
export function evaluateHoldemHand(cards: number[]): HandEvaluation {
  if (cards.length < 5) {
    // If fewer than 5 cards (e.g. preflop 2 cards or partial), evaluate whatever cards exist
    const ranks = cards.map(rankOf).sort((a, b) => b - a);
    if (cards.length === 2 && ranks[0] === ranks[1]) {
      return {
        category: 'onePair',
        categoryRank: 1,
        score: ranks[0]!,
        label: `Pocket ${cardRankName(ranks[0]!, true)}`,
        bestCards: cards,
      };
    }
    return {
      category: 'highCard',
      categoryRank: 0,
      score: ranks[0] ?? 0,
      label: cards.length > 0 ? `${cardRankName(ranks[0]!)} High` : 'Empty',
      bestCards: cards,
    };
  }

  if (cards.length === 5) {
    return evaluate5CardHand(cards);
  }

  // 6 or 7 cards: find combination of 5 with maximum score
  const allCombos = combinations(cards, 5);
  let bestEval: HandEvaluation | null = null;

  for (const combo of allCombos) {
    const curEval = evaluate5CardHand(combo);
    if (!bestEval || curEval.score > bestEval.score) {
      bestEval = curEval;
    }
  }

  return bestEval!;
}
