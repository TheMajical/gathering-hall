import type { Rng } from '../../../rng.js';

export interface BattleRoll {
  attackerRolls: number[]; // sorted desc
  defenderRolls: number[]; // sorted desc
  attackerLosses: number;
  defenderLosses: number;
}

/**
 * One battle roll. Attacker rolls `attackDice` (1..3), defender always rolls
 * max dice = min(2, defenderArmies). Pair highest-vs-highest; ties go to the
 * defender.
 */
export function resolveBattle(rng: Rng, attackDice: number, defenderArmies: number): BattleRoll {
  const defendDice = Math.min(2, defenderArmies);
  const attackerRolls = Array.from({ length: attackDice }, () => rng.d6()).sort((a, b) => b - a);
  const defenderRolls = Array.from({ length: defendDice }, () => rng.d6()).sort((a, b) => b - a);
  let attackerLosses = 0;
  let defenderLosses = 0;
  const pairs = Math.min(attackDice, defendDice);
  for (let i = 0; i < pairs; i++) {
    if (attackerRolls[i]! > defenderRolls[i]!) defenderLosses++;
    else attackerLosses++;
  }
  return { attackerRolls, defenderRolls, attackerLosses, defenderLosses };
}
