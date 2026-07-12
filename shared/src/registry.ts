import type { GameSpec } from './engine.js';
import { chessSpec } from './games/chess/engine.js';
import { coinflipSpec } from './games/coinflip/engine.js';
import { cottonSpec } from './games/cotton/engine.js';
import { riskSpec } from './games/risk/engine.js';
import { unoSpec } from './games/uno/engine.js';

export const GAMES: GameSpec[] = [cottonSpec, riskSpec, chessSpec, unoSpec, coinflipSpec];

export function getGameSpec(id: string): GameSpec | undefined {
  return GAMES.find((g) => g.id === id);
}
