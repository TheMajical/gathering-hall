/**
 * Hokm cards. Card id = suit*13 + rank, suit 0..3 (♥♦♣♠), rank 0..12
 * mapping to 2..10, J, Q, K, A (A = rank 12, highest).
 */

export type Suit = 0 | 1 | 2 | 3;
export const SUITS: Suit[] = [0, 1, 2, 3];
export const SUIT_SYMBOLS = ['♥', '♦', '♣', '♠'] as const;
export const SUIT_NAMES = ['Hearts', 'Diamonds', 'Clubs', 'Spades'] as const;
export const RANK_LABELS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;

export function suitOf(card: number): Suit {
  return Math.floor(card / 13) as Suit;
}

export function rankOf(card: number): number {
  return card % 13;
}

export function cardLabel(card: number): string {
  return `${RANK_LABELS[rankOf(card)]}${SUIT_SYMBOLS[suitOf(card)]}`;
}

/** Full 52-card deck; the 3-player game removes the 2♦ (id 13) → 51 cards. */
export function baseDeck(numPlayers: number): number[] {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  return numPlayers === 3 ? deck.filter((c) => c !== 13) : deck;
}

/** Cards dealt to each player: 2p→13 (26 dead), 3p→17, 4p→13. */
export function handSize(numPlayers: number): number {
  return numPlayers === 3 ? 17 : 13;
}

/**
 * Winner of a completed trick: highest trump if any trump was played,
 * otherwise highest card of the led suit.
 */
export function trickWinner(trick: { player: number; card: number }[], trump: Suit): number {
  const led = suitOf(trick[0]!.card);
  let best = trick[0]!;
  for (const t of trick.slice(1)) {
    const s = suitOf(t.card);
    const bs = suitOf(best.card);
    if (s === bs) {
      if (rankOf(t.card) > rankOf(best.card)) best = t;
    } else if (s === trump) {
      best = t;
    }
  }
  return best.player;
}
