import { describe, expect, it } from 'vitest';
import { CONTINENTS, NUM_TERRITORIES, TERRITORIES } from '../games/risk/mapData.js';

describe('Risk map data invariants', () => {
  it('has exactly 42 territories with ids 0..41 in order', () => {
    expect(TERRITORIES).toHaveLength(NUM_TERRITORIES);
    TERRITORIES.forEach((t, i) => expect(t.id).toBe(i));
  });

  it('adjacency is symmetric, irreflexive, and duplicate-free', () => {
    for (const t of TERRITORIES) {
      expect(new Set(t.adjacent).size).toBe(t.adjacent.length);
      expect(t.adjacent).not.toContain(t.id);
      for (const nb of t.adjacent) {
        expect(TERRITORIES[nb]!.adjacent, `${TERRITORIES[nb]!.name} should link back to ${t.name}`).toContain(t.id);
      }
    }
  });

  it('the graph is fully connected', () => {
    const seen = new Set<number>([0]);
    const queue = [0];
    while (queue.length) {
      for (const nb of TERRITORIES[queue.shift()!]!.adjacent) {
        if (!seen.has(nb)) {
          seen.add(nb);
          queue.push(nb);
        }
      }
    }
    expect(seen.size).toBe(NUM_TERRITORIES);
  });

  it('continents partition the 42 territories with classic sizes and bonuses', () => {
    const all = CONTINENTS.flatMap((c) => c.territories);
    expect(all).toHaveLength(NUM_TERRITORIES);
    expect(new Set(all).size).toBe(NUM_TERRITORIES);
    const byName = Object.fromEntries(CONTINENTS.map((c) => [c.name, c]));
    expect(byName['North America']!.territories).toHaveLength(9);
    expect(byName['South America']!.territories).toHaveLength(4);
    expect(byName['Europe']!.territories).toHaveLength(7);
    expect(byName['Africa']!.territories).toHaveLength(6);
    expect(byName['Asia']!.territories).toHaveLength(12);
    expect(byName['Australia']!.territories).toHaveLength(4);
    expect(byName['North America']!.bonus).toBe(5);
    expect(byName['South America']!.bonus).toBe(2);
    expect(byName['Europe']!.bonus).toBe(5);
    expect(byName['Africa']!.bonus).toBe(3);
    expect(byName['Asia']!.bonus).toBe(7);
    expect(byName['Australia']!.bonus).toBe(2);
    // every territory's continent field matches its continent's list
    for (const c of CONTINENTS) {
      for (const tid of c.territories) expect(TERRITORIES[tid]!.continent).toBe(c.id);
    }
  });

  it('classic sea links exist', () => {
    const names = Object.fromEntries(TERRITORIES.map((t) => [t.name, t]));
    const linked = (a: string, b: string) => names[a]!.adjacent.includes(names[b]!.id);
    expect(linked('Alaska', 'Kamchatka')).toBe(true);
    expect(linked('Greenland', 'Iceland')).toBe(true);
    expect(linked('Brazil', 'North Africa')).toBe(true);
    expect(linked('East Africa', 'Middle East')).toBe(true);
    expect(linked('Siam', 'Indonesia')).toBe(true);
  });
});
