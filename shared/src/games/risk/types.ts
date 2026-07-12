import type { PlayerId, ResignAction } from '../../engine.js';

export type RiskPhase =
  | 'setup' // alternate placement of initial armies in batches of 3
  | 'reinforce' // income + trades + placement
  | 'attack' // battles (incl. forced mid-phase trades after eliminations)
  | 'move_armies' // mandatory post-conquest move
  | 'fortify' // one optional connected-path move
  | 'game_over';

export interface TerritoryState {
  owner: PlayerId;
  armies: number;
}

export interface RiskState {
  rngState: number;
  numPlayers: number;
  phase: RiskPhase;
  /** Seeded shuffle of seats; fixed for the whole game. */
  turnOrder: PlayerId[];
  /** Index into turnOrder of the acting player. */
  currentIdx: number;
  territories: TerritoryState[]; // indexed by territory id 0..41
  eliminated: boolean[];
  winner: PlayerId | null;

  // --- setup phase ---
  /** Armies each player still has to place during setup. */
  setupRemaining: number[];
  /** Armies the current player may still place in this setup batch. */
  setupBatch: number;

  // --- cards ---
  deck: number[];
  discard: number[];
  hands: number[][];
  /** Global escalating trade counter. */
  tradeCount: number;

  // --- turn context ---
  reinforcementsRemaining: number;
  conqueredThisTurn: boolean;
  pendingMove: { from: number; to: number; min: number } | null;
}

export type RiskAction =
  | { type: 'place'; territoryId: number; count: number }
  | { type: 'trade'; cards: [number, number, number] }
  | { type: 'endReinforce' }
  | { type: 'attack'; from: number; to: number; dice: number; blitz?: boolean }
  | { type: 'moveArmies'; count: number }
  | { type: 'endAttack' }
  | { type: 'fortify'; from: number; to: number; count: number }
  | { type: 'endTurn' }
  | ResignAction;

/** Legal-action descriptors — drive client UI enablement. */
export type RiskLegal =
  | { type: 'place'; territories: number[]; remaining: number }
  | { type: 'trade'; sets: [number, number, number][]; forced: boolean }
  | { type: 'endReinforce' }
  | { type: 'attack'; options: { from: number; to: number; maxDice: number }[] }
  | { type: 'moveArmies'; from: number; to: number; min: number; max: number }
  | { type: 'endAttack' }
  | { type: 'fortify'; options: { from: number; targets: number[]; max: number }[] }
  | { type: 'endTurn' }
  | { type: 'resign' };

export interface RiskPlayerPublic {
  playerId: PlayerId;
  territories: number;
  armies: number;
  cardCount: number;
  eliminated: boolean;
}

export interface RiskView {
  numPlayers: number;
  phase: RiskPhase;
  turnOrder: PlayerId[];
  current: PlayerId;
  territories: TerritoryState[];
  players: RiskPlayerPublic[];
  /** Viewer's own cards (empty for spectators). */
  hand: number[];
  deckCount: number;
  tradeCount: number;
  nextTradeValue: number;
  reinforcementsRemaining: number;
  conqueredThisTurn: boolean;
  pendingMove: { from: number; to: number; min: number } | null;
  setupRemaining: number[];
  setupBatch: number;
  winner: PlayerId | null;
}

export const INITIAL_ARMIES: Record<number, number> = { 3: 35, 4: 30, 5: 25, 6: 20 };
