import type { GameEvent } from '@gamehub/shared';
import type React from 'react';
import type { SoundName } from '../api/sounds.js';
import { ChessUI } from './chess/ChessTable.js';
import { CoinflipUI } from './coinflip/CoinflipTable.js';
import { CottonUI } from './cotton/CottonGame.js';
import { RiskUI } from './risk/RiskGame.js';
import { UnoUI } from './uno/UnoTable.js';

export interface GameUI {
  Table: React.FC<{ extras: React.ReactNode }>;
  /** Turn a semantic engine event into a log line (null → skip). */
  describeEvent(e: GameEvent, name: (playerId: unknown) => string): string | null;
  /** Map a semantic engine event to a sound effect (null → silent). */
  soundFor(e: GameEvent): SoundName | null;
}

export const GAME_UIS: Record<string, GameUI> = {
  cotton: CottonUI,
  risk: RiskUI,
  chess: ChessUI,
  uno: UnoUI,
  coinflip: CoinflipUI,
};
