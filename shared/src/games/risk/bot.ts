/**
 * A random-but-legal Risk bot used by the property test and the socket
 * integration test. Policy is tuned so games terminate: always trade,
 * concentrate placements, attack when favorable, always blitz.
 */
import type { PlayerId } from '../../engine.js';
import { riskEngine } from './engine.js';
import { TERRITORIES } from './mapData.js';
import type { RiskAction, RiskState } from './types.js';

/** rand() must return floats in [0,1). Returns null if the bot has no move. */
export function pickBotAction(
  state: RiskState,
  player: PlayerId,
  rand: () => number,
): RiskAction | null {
  const legal = riskEngine.getLegalActions(state, player);
  if (legal.length === 0) return null;
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;

  // Forced or voluntary trades: always trade (keeps escalation going).
  const trade = legal.find((l) => l.type === 'trade');
  if (trade && trade.type === 'trade' && trade.sets.length > 0) {
    return { type: 'trade', cards: pick(trade.sets) };
  }

  const place = legal.find((l) => l.type === 'place');
  if (place && place.type === 'place') {
    // Concentrate: prefer a territory that borders an enemy.
    const frontier = place.territories.filter((tid) => hasEnemyNeighbor(state, tid, player));
    const target = frontier.length > 0 ? pick(frontier) : pick(place.territories);
    return { type: 'place', territoryId: target, count: place.remaining };
  }

  const move = legal.find((l) => l.type === 'moveArmies');
  if (move && move.type === 'moveArmies') {
    // Push forward: move everything most of the time.
    const count = rand() < 0.8 ? move.max : Math.floor(rand() * (move.max + 1));
    return { type: 'moveArmies', count };
  }

  const attack = legal.find((l) => l.type === 'attack');
  if (attack && attack.type === 'attack') {
    const favorable = attack.options.filter(
      (o) => state.territories[o.from]!.armies > state.territories[o.to]!.armies + 1,
    );
    if (favorable.length > 0) {
      const o = pick(favorable);
      return { type: 'attack', from: o.from, to: o.to, dice: o.maxDice, blitz: true };
    }
    // Occasionally attack anyway so early games make progress.
    if (rand() < 0.15) {
      const o = pick(attack.options);
      return { type: 'attack', from: o.from, to: o.to, dice: o.maxDice, blitz: true };
    }
  }

  if (legal.some((l) => l.type === 'endReinforce')) return { type: 'endReinforce' };
  if (legal.some((l) => l.type === 'endAttack')) return { type: 'endAttack' };

  const fortify = legal.find((l) => l.type === 'fortify');
  if (fortify && fortify.type === 'fortify' && rand() < 0.5) {
    const o = pick(fortify.options);
    return { type: 'fortify', from: o.from, to: pick(o.targets), count: o.max };
  }
  if (legal.some((l) => l.type === 'endTurn')) return { type: 'endTurn' };

  return null;
}

function hasEnemyNeighbor(state: RiskState, tid: number, player: PlayerId): boolean {
  return TERRITORIES[tid]!.adjacent.some((nb) => state.territories[nb]!.owner !== player);
}
