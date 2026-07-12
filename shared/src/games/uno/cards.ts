/**
 * Uno deck — 108 cards encoded as ids 0..107.
 * Per color c (0=red 1=yellow 2=green 3=blue), ids c*25 .. c*25+24:
 *   v = id % 25: 0 → the single "0"; 1..18 → numbers 1-9 (two copies each,
 *   number = ceil(v/2)); 19,20 → Skip; 21,22 → Reverse; 23,24 → Draw Two.
 * Ids 100..103 → Wild, 104..107 → Wild Draw Four.
 */

export const UNO_DECK_SIZE = 108;

export type UnoColor = 0 | 1 | 2 | 3;
export type UnoKind = 'number' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4';

export interface UnoCard {
  id: number;
  kind: UnoKind;
  color: UnoColor | null; // null for wilds
  num: number | null; // 0-9 for number cards
}

export function unoCard(id: number): UnoCard {
  if (id >= 104) return { id, kind: 'wild4', color: null, num: null };
  if (id >= 100) return { id, kind: 'wild', color: null, num: null };
  const color = Math.floor(id / 25) as UnoColor;
  const v = id % 25;
  if (v === 0) return { id, kind: 'number', color, num: 0 };
  if (v <= 18) return { id, kind: 'number', color, num: Math.ceil(v / 2) };
  if (v <= 20) return { id, kind: 'skip', color, num: null };
  if (v <= 22) return { id, kind: 'reverse', color, num: null };
  return { id, kind: 'draw2', color, num: null };
}

/** May `card` be played on top card `top` given the active color? */
export function isPlayable(cardId: number, topId: number, activeColor: UnoColor): boolean {
  const c = unoCard(cardId);
  if (c.kind === 'wild' || c.kind === 'wild4') return true;
  if (c.color === activeColor) return true;
  const t = unoCard(topId);
  if (c.kind === 'number' && t.kind === 'number') return c.num === t.num;
  // symbol match (skip on skip, reverse on reverse, draw2 on draw2)
  return c.kind === t.kind;
}

export const UNO_COLOR_NAMES = ['Red', 'Yellow', 'Green', 'Blue'] as const;
