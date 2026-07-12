/**
 * The game-engine contract — the entire integration surface between the
 * platform shell and each game. Engines are pure: no timers, no IO, RNG
 * state serialized inside GameState.
 */

/** Seat index 0..n-1. */
export type PlayerId = number;

export type Viewer = PlayerId | 'spectator';

export interface EngineError {
  error: true;
  code: string;
  message: string;
}

export function engineError(code: string, message: string): EngineError {
  return { error: true, code, message };
}

export function isEngineError(x: unknown): x is EngineError {
  return typeof x === 'object' && x !== null && (x as EngineError).error === true;
}

/** Semantic event for client logs/animations, decoupled from state diffs. */
export interface GameEvent {
  type: string;
  [key: string]: unknown;
}

export interface EngineStatus {
  phase: string;
  terminal: boolean;
  winners: PlayerId[];
  eliminated: PlayerId[];
}

/** Universal action every engine must accept from any living player. */
export interface ResignAction {
  type: 'resign';
}

export interface SetupConfig {
  numPlayers: number;
  seed: number;
  options?: Record<string, unknown>;
}

export interface ReduceResult<S> {
  state: S;
  events: GameEvent[];
}

/**
 * S = full game state (server-only truth)
 * A = action union (must include ResignAction)
 * V = per-player redacted view
 * L = legal-action descriptor union (drives client UI enablement)
 */
export interface GameEngine<S = unknown, A = { type: string }, V = unknown, L = unknown> {
  setup(config: SetupConfig): S;
  getLegalActions(state: S, player: PlayerId): L[];
  reduce(state: S, action: A, player: PlayerId): ReduceResult<S> | EngineError;
  view(state: S, viewer: Viewer): V;
  getCurrentActors(state: S): PlayerId[];
  status(state: S): EngineStatus;
}

export interface GameSpec {
  id: string;
  name: string;
  tagline: string;
  minPlayers: number;
  maxPlayers: number;
  /** Bumped on breaking state-shape changes; gates snapshot restore. */
  engineVersion: number;
  engine: GameEngine<never, never, never, never> | GameEngine;
}
