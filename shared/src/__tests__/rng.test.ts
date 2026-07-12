import { describe, expect, it } from 'vitest';
import { Rng } from '../rng.js';

describe('Rng (mulberry32)', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('state round-trips through serialization', () => {
    const a = new Rng(999);
    a.next();
    a.next();
    const saved = a.state; // plain number — JSON-safe
    const b = new Rng(saved);
    expect(Array.from({ length: 20 }, () => a.next())).toEqual(
      Array.from({ length: 20 }, () => b.next()),
    );
  });

  it('produces values in [0,1) and d6 in 1..6', () => {
    const rng = new Rng(42);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    const counts = new Map<number, number>();
    for (let i = 0; i < 60_000; i++) {
      const d = rng.d6();
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    for (const c of counts.values()) {
      expect(c).toBeGreaterThan(9_000); // ~10k each, loose fairness bound
      expect(c).toBeLessThan(11_000);
    }
  });

  it('shuffle is a permutation and seed-stable', () => {
    const arr = Array.from({ length: 42 }, (_, i) => i);
    const s1 = new Rng(7).shuffle(arr);
    const s2 = new Rng(7).shuffle(arr);
    expect(s1).toEqual(s2);
    expect([...s1].sort((a, b) => a - b)).toEqual(arr);
    expect(new Rng(8).shuffle(arr)).not.toEqual(s1);
  });
});
