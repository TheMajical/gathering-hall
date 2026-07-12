/**
 * Seeded, serializable PRNG (mulberry32). The entire generator state is a
 * single uint32 carried inside GameState, so snapshots and replays are
 * exactly deterministic.
 */
export class Rng {
  constructor(public state: number) {
    this.state = state >>> 0;
  }

  /** Next float in [0, 1). Advances state. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Six-sided die: 1..6. */
  d6(): number {
    return 1 + this.int(6);
  }

  /** Fisher–Yates shuffle (returns a new array). */
  shuffle<T>(arr: readonly T[]): T[] {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = out[i]!;
      out[i] = out[j]!;
      out[j] = tmp;
    }
    return out;
  }
}

/** Non-deterministic seed for real games (tests pass explicit seeds). */
export function randomSeed(): number {
  return (Math.floor(Math.random() * 0xffffffff) ^ Date.now()) >>> 0;
}
