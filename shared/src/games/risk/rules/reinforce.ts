import type { PlayerId } from '../../../engine.js';
import { CONTINENTS } from '../mapData.js';
import type { TerritoryState } from '../types.js';

export function territoriesOwned(territories: readonly TerritoryState[], player: PlayerId): number[] {
  const out: number[] = [];
  territories.forEach((ts, id) => {
    if (ts.owner === player) out.push(id);
  });
  return out;
}

export function continentBonus(territories: readonly TerritoryState[], player: PlayerId): number {
  let bonus = 0;
  for (const c of CONTINENTS) {
    if (c.territories.every((id) => territories[id]!.owner === player)) bonus += c.bonus;
  }
  return bonus;
}

/** Turn income: max(3, floor(owned/3)) + continent bonuses. Trades are separate. */
export function reinforcementIncome(territories: readonly TerritoryState[], player: PlayerId): number {
  const owned = territoriesOwned(territories, player).length;
  return Math.max(3, Math.floor(owned / 3)) + continentBonus(territories, player);
}
