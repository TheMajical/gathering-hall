/**
 * Risk cards. 44-card deck: cards 0..41 map 1:1 to territories (type = id % 3
 * → 14 of each of infantry/cavalry/artillery), cards 42..43 are wild.
 * Trade-in schedule is GLOBAL escalating: 4, 6, 8, 10, 12, 15, then +5.
 */

export const NUM_CARDS = 44;
export const WILD_CARDS = [42, 43];

export type CardType = 'infantry' | 'cavalry' | 'artillery' | 'wild';

export function cardType(id: number): CardType {
  if (id >= 42) return 'wild';
  return (['infantry', 'cavalry', 'artillery'] as const)[id % 3]!;
}

/** Territory printed on the card, or null for wilds. */
export function cardTerritory(id: number): number | null {
  return id < 42 ? id : null;
}

export function tradeValue(tradeCount: number): number {
  const table = [4, 6, 8, 10, 12, 15];
  if (tradeCount < table.length) return table[tradeCount]!;
  return 15 + 5 * (tradeCount - (table.length - 1));
}

/** Valid set: 3 same type, 3 different types, or any set containing a wild. */
export function isValidSet(cards: readonly number[]): boolean {
  if (cards.length !== 3) return false;
  if (new Set(cards).size !== 3) return false;
  if (cards.some((c) => c < 0 || c >= NUM_CARDS)) return false;
  const types = cards.map(cardType);
  if (types.includes('wild')) return true;
  const uniq = new Set(types).size;
  return uniq === 1 || uniq === 3;
}

/** All valid 3-card sets from a hand (hands are ≤ ~9 cards, so brute force). */
export function validSetsFrom(hand: readonly number[]): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < hand.length; i++)
    for (let j = i + 1; j < hand.length; j++)
      for (let k = j + 1; k < hand.length; k++) {
        const set: [number, number, number] = [hand[i]!, hand[j]!, hand[k]!];
        if (isValidSet(set)) out.push(set);
      }
  return out;
}
