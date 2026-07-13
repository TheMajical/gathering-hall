/**
 * Othello (Reversi) — 8×8, two players. Place a disc to flank one or more
 * straight lines of enemy discs; everything flanked flips. No legal move →
 * automatic pass. Neither side can move (or board full) → most discs wins,
 * equal is a draw. Colors are assigned by seed; Black always moves first.
 */
import {
  engineError,
  type EngineError,
  type EngineStatus,
  type GameEngine,
  type GameEvent,
  type GameSpec,
  type PlayerId,
  type ReduceResult,
  type ResignAction,
  type SetupConfig,
  type Viewer,
} from '../../engine.js';
import { Rng } from '../../rng.js';

export const OTHELLO_SIZE = 8;
const N = OTHELLO_SIZE;
const DIRS: [number, number][] = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

export interface OthelloState {
  rngState: number;
  /** Seat playing Black (moves first). */
  blackSeat: PlayerId;
  /** 64 cells; value = seat id occupying it, or null. */
  board: (PlayerId | null)[];
  current: PlayerId;
  lastMove: number | null;
  resigned: boolean[];
  winner: PlayerId | null;
  drawn: boolean;
}

export type OthelloAction = { type: 'place'; cell: number } | ResignAction;

export type OthelloLegal = { type: 'place'; cells: number[] } | { type: 'resign' };

export interface OthelloView {
  blackSeat: PlayerId;
  board: (PlayerId | null)[];
  current: PlayerId;
  counts: [number, number]; // discs per seat 0/1
  lastMove: number | null;
  winner: PlayerId | null;
  drawn: boolean;
  resigned: boolean[];
}

const idx = (r: number, c: number): number => r * N + c;
const inside = (r: number, c: number): boolean => r >= 0 && r < N && c >= 0 && c < N;

/** Discs flipped by `seat` playing `cell` (empty ⇒ move legality = flips > 0). */
export function flipsFor(board: (PlayerId | null)[], seat: PlayerId, cell: number): number[] {
  if (board[cell] !== null) return [];
  const r0 = Math.floor(cell / N);
  const c0 = cell % N;
  const out: number[] = [];
  for (const [dr, dc] of DIRS) {
    const line: number[] = [];
    let r = r0 + dr;
    let c = c0 + dc;
    while (inside(r, c) && board[idx(r, c)] !== null && board[idx(r, c)] !== seat) {
      line.push(idx(r, c));
      r += dr;
      c += dc;
    }
    if (line.length > 0 && inside(r, c) && board[idx(r, c)] === seat) out.push(...line);
  }
  return out;
}

export function legalCells(board: (PlayerId | null)[], seat: PlayerId): number[] {
  const out: number[] = [];
  for (let cell = 0; cell < N * N; cell++) {
    if (board[cell] === null && flipsFor(board, seat, cell).length > 0) out.push(cell);
  }
  return out;
}

function counts(state: OthelloState): [number, number] {
  let a = 0;
  let b = 0;
  for (const v of state.board) {
    if (v === 0) a++;
    else if (v === 1) b++;
  }
  return [a, b];
}

function terminal(state: OthelloState): boolean {
  return state.winner !== null || state.drawn;
}

function settle(state: OthelloState, events: GameEvent[]): void {
  const [a, b] = counts(state);
  if (a === b) {
    state.drawn = true;
    events.push({ type: 'gameOver', player: null, draw: true, counts: [a, b] });
  } else {
    state.winner = a > b ? 0 : 1;
    events.push({ type: 'gameOver', player: state.winner, draw: false, counts: [a, b] });
  }
}

export const othelloEngine: GameEngine<OthelloState, OthelloAction, OthelloView, OthelloLegal> = {
  setup({ seed }: SetupConfig): OthelloState {
    const rng = new Rng(seed);
    const blackSeat = rng.int(2);
    const whiteSeat = 1 - blackSeat;
    const board: (PlayerId | null)[] = Array(N * N).fill(null);
    board[idx(3, 3)] = whiteSeat;
    board[idx(4, 4)] = whiteSeat;
    board[idx(3, 4)] = blackSeat;
    board[idx(4, 3)] = blackSeat;
    return {
      rngState: rng.state,
      blackSeat,
      board,
      current: blackSeat, // black opens
      lastMove: null,
      resigned: [false, false],
      winner: null,
      drawn: false,
    };
  },

  getLegalActions(state, player): OthelloLegal[] {
    if (terminal(state) || state.resigned[player]) return [];
    if (player !== state.current) return [{ type: 'resign' }];
    return [{ type: 'place', cells: legalCells(state.board, player) }, { type: 'resign' }];
  },

  reduce(prev, action, player): ReduceResult<OthelloState> | EngineError {
    if (terminal(prev)) return engineError('ERR_ILLEGAL_ACTION', 'Game is over.');
    if (prev.resigned[player]) return engineError('ERR_ILLEGAL_ACTION', 'You have resigned.');
    const state = structuredClone(prev);
    const events: GameEvent[] = [];

    if (action.type === 'resign') {
      state.resigned[player] = true;
      state.winner = 1 - player;
      events.push({ type: 'resigned', player });
      events.push({ type: 'gameOver', player: state.winner, draw: false, counts: counts(state) });
      return { state, events };
    }

    if (action.type !== 'place') return engineError('ERR_ILLEGAL_ACTION', 'Unknown action.');
    if (player !== state.current) return engineError('ERR_NOT_YOUR_TURN', 'Not your turn.');
    const { cell } = action;
    if (!Number.isInteger(cell) || cell < 0 || cell >= N * N) {
      return engineError('ERR_ILLEGAL_ACTION', 'Invalid square.');
    }
    const flips = flipsFor(state.board, player, cell);
    if (flips.length === 0) {
      return engineError('ERR_ILLEGAL_ACTION', 'You must flank at least one enemy disc.');
    }
    state.board[cell] = player;
    for (const f of flips) state.board[f] = player;
    state.lastMove = cell;
    events.push({ type: 'placed', player, cell, flipped: flips.length });

    const opponent = 1 - player;
    if (legalCells(state.board, opponent).length > 0) {
      state.current = opponent;
    } else if (legalCells(state.board, player).length > 0) {
      events.push({ type: 'passed', player: opponent }); // opponent has no move
      state.current = player;
    } else {
      settle(state, events); // neither side can move
    }
    return { state, events };
  },

  view(state, _viewer: Viewer): OthelloView {
    return {
      blackSeat: state.blackSeat,
      board: state.board,
      current: state.current,
      counts: counts(state),
      lastMove: state.lastMove,
      winner: state.winner,
      drawn: state.drawn,
      resigned: state.resigned,
    };
  },

  getCurrentActors(state) {
    return terminal(state) ? [] : [state.current];
  },

  status(state): EngineStatus {
    return {
      phase: terminal(state) ? 'game_over' : 'playing',
      terminal: terminal(state),
      winners: state.winner === null ? [] : [state.winner],
      eliminated: state.resigned.map((r, i) => (r ? i : -1)).filter((i) => i >= 0),
    };
  },
};

export const othelloSpec: GameSpec = {
  id: 'othello',
  name: 'Othello',
  tagline: 'Flank and flip — own the most discs when the board fills.',
  minPlayers: 2,
  maxPlayers: 2,
  engineVersion: 1,
  engine: othelloEngine as unknown as GameEngine,
};
