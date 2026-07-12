import { describe, expect, it } from 'vitest';
import { cardTerritory, cardType, isValidSet, tradeValue, validSetsFrom } from '../games/risk/rules/cards.js';

describe('Risk cards', () => {
  it('deck composition: 14 of each type + 2 wilds, cards map to territories', () => {
    const counts = { infantry: 0, cavalry: 0, artillery: 0, wild: 0 };
    for (let i = 0; i < 44; i++) counts[cardType(i)]++;
    expect(counts).toEqual({ infantry: 14, cavalry: 14, artillery: 14, wild: 2 });
    expect(cardTerritory(0)).toBe(0);
    expect(cardTerritory(41)).toBe(41);
    expect(cardTerritory(42)).toBeNull();
    expect(cardTerritory(43)).toBeNull();
  });

  it('escalating global trade schedule: 4,6,8,10,12,15 then +5', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(tradeValue)).toEqual([4, 6, 8, 10, 12, 15, 20, 25, 30]);
  });

  it('validates sets: 3 same, 3 different, or any with a wild', () => {
    expect(isValidSet([0, 3, 6])).toBe(true); // all infantry (ids % 3 === 0)
    expect(isValidSet([0, 1, 2])).toBe(true); // infantry, cavalry, artillery
    expect(isValidSet([0, 3, 1])).toBe(false); // two infantry + one cavalry
    expect(isValidSet([42, 0, 3])).toBe(true); // wild + any
    expect(isValidSet([42, 43, 0])).toBe(true); // two wilds
    expect(isValidSet([0, 0, 3])).toBe(false); // duplicate card
    expect(isValidSet([0, 3])).toBe(false); // wrong size
  });

  it('enumerates valid sets from a hand', () => {
    expect(validSetsFrom([0, 3, 6, 1])).toContainEqual([0, 3, 6]);
    expect(validSetsFrom([0, 1, 2])).toEqual([[0, 1, 2]]);
    expect(validSetsFrom([0, 3])).toEqual([]);
    expect(validSetsFrom([0, 3, 1]).length).toBe(0);
  });
});
