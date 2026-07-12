import type { PlayerId } from '../../../engine.js';
import { TERRITORIES } from '../mapData.js';
import type { TerritoryState } from '../types.js';

/**
 * BFS over friendly territories: all territories connected to `from` through
 * territories owned by `player` (fortify uses connected-path rules).
 * Result excludes `from` itself.
 */
export function connectedOwned(
  territories: readonly TerritoryState[],
  player: PlayerId,
  from: number,
): number[] {
  if (territories[from]?.owner !== player) return [];
  const seen = new Set<number>([from]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nb of TERRITORIES[cur]!.adjacent) {
      if (!seen.has(nb) && territories[nb]!.owner === player) {
        seen.add(nb);
        queue.push(nb);
      }
    }
  }
  seen.delete(from);
  return [...seen].sort((a, b) => a - b);
}
