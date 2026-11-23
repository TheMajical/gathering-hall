/**
 * Poker card utilities and constants.
 * Uses the standard 52-card encoding (same as Hokm: suit * 13 + rank).
 * Suits: 0=Hearts(♥), 1=Diamonds(♦), 2=Clubs(♣), 3=Spades(♠).
 * Ranks: 0..12 -> 2..10, J, Q, K, A.
 */
import {
  RANK_LABELS,
  SUIT_NAMES,
  SUIT_SYMBOLS,
  rankOf,
  suitOf,
  type Suit,
} from '../hokm/cards.js';

export {
  RANK_LABELS,
  SUIT_NAMES,
  SUIT_SYMBOLS,
  rankOf,
  suitOf,
  type Suit,
};

export const STARTING_CHIPS = 1000;
export const SMALL_BLIND = 10;
export const BIG_BLIND = 20;

export function pokerDeck(): number[] {
  return Array.from({ length: 52 }, (_, i) => i);
}

export function cardRankName(rank: number, plural = false): string {
  switch (rank) {
    case 12: return plural ? 'Aces' : 'Ace';
    case 11: return plural ? 'Kings' : 'King';
    case 10: return plural ? 'Queens' : 'Queen';
    case 9:  return plural ? 'Jacks' : 'Jack';
    case 8:  return plural ? '10s' : '10';
    case 7:  return plural ? '9s' : '9';
    case 6:  return plural ? '8s' : '8';
    case 5:  return plural ? '7s' : '7';
    case 4:  return plural ? '6s' : '6';
    case 3:  return plural ? '5s' : '5';
    case 2:  return plural ? '4s' : '4';
    case 1:  return plural ? '3s' : '3';
    case 0:  return plural ? '2s' : '2';
    default: return String(rank);
  }
}
