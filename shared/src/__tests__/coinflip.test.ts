import { describe, expect, it } from 'vitest';
import { isEngineError } from '../engine.js';
import { coinflipEngine } from '../games/coinflip/engine.js';

describe('Coinflip engine', () => {
  it('plays a deterministic game to completion', () => {
    let s = coinflipEngine.setup({ numPlayers: 2, seed: 99 });
    let guard = 0;
    while (!coinflipEngine.status(s).terminal && guard++ < 500) {
      const p = coinflipEngine.getCurrentActors(s)[0]!;
      const r = coinflipEngine.reduce(s, { type: 'call', side: 'heads' }, p);
      if (isEngineError(r)) throw new Error(r.message);
      s = r.state;
    }
    expect(coinflipEngine.status(s).terminal).toBe(true);
    expect(s.winner).not.toBeNull();
    expect(Math.max(...s.scores)).toBe(3);
  });

  it('rejects out-of-turn calls; resign ends a 2p game', () => {
    const s = coinflipEngine.setup({ numPlayers: 2, seed: 1 });
    const other = (s.current + 1) % 2;
    const r = coinflipEngine.reduce(s, { type: 'call', side: 'tails' }, other);
    expect(isEngineError(r)).toBe(true);
    const rr = coinflipEngine.reduce(s, { type: 'resign' }, other);
    if (isEngineError(rr)) throw new Error(rr.message);
    expect(rr.state.winner).toBe(s.current);
  });
});
