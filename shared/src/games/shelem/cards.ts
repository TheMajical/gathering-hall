/**
 * Shelem (شلم) card definitions and scoring.
 * Uses standard 52-card deck (same encoding as Hokm: suit*13 + rank).
 * Suits: 0=Hearts(♥), 1=Diamonds(♦), 2=Clubs(♣), 3=Spades(♠).
 * Ranks: 0..12 -> 2..10, J, Q, K, A.
 *
 * Scoring in standard 165 Shelem (بدون جوکر):
 * - Each Ace (rank 12): 10 points (4 * 10 = 40)
 * - Each 10 (rank 8):   10 points (4 * 10 = 40)
 * - Each 5 (rank 3):    5 points  (4 * 5 = 20)
 * Total card points = 100 points.
 *
 * Each won trick: 5 points.
 * 12 played tricks + 1 ground/widow trick = 13 * 5 = 65 points.
 * Grand total per hand = 100 + 65 = 165 points.
 */
import {
  RANK_LABELS,
  SUIT_NAMES,
  SUIT_SYMBOLS,
  rankOf,
  suitOf,
  trickWinner,
  type Suit,
} from '../hokm/cards.js';

export {
  RANK_LABELS,
  SUIT_NAMES,
  SUIT_SYMBOLS,
  rankOf,
  suitOf,
  trickWinner,
  type Suit,
};

export const TOTAL_HAND_POINTS = 165;
export const TRICK_BONUS = 5;
export const MIN_BID = 100;
export const MAX_BID = 165;
export const BID_STEP = 5;
export const SHELEM_BID = 165;
export const SHELEM_SCORE = 330;
export const POINTS_TO_WIN_MATCH = 660;

/** Card points: Ace=10, 10=10, 5=5, others=0. */
export function cardPointValue(card: number): number {
  const r = rankOf(card);
  if (r === 12) return 10; // Ace
  if (r === 8) return 10;  // 10
  if (r === 3) return 5;   // 5
  return 0;
}

/** Total points in a set of cards (including the 5 trick points). */
export function trickScore(cards: number[]): number {
  const cardPts = cards.reduce((sum, c) => sum + cardPointValue(c), 0);
  return TRICK_BONUS + cardPts;
}

/** Full 52-card deck. */
export function shelemDeck(): number[] {
  return Array.from({ length: 52 }, (_, i) => i);
}
