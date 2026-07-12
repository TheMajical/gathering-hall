/**
 * Chess engine — rules delegated to the battle-tested chess.js library.
 * State stores the move list (plus optional custom start FEN for tests) and
 * is replayed to rebuild the position, so draw rules that need full history
 * (threefold repetition, 50-move) are exact. Colors are assigned by seed.
 */
import { Chess, type Move } from 'chess.js';
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

const err = engineError;

export interface ChessMoveInput {
  from: string;
  to: string;
  promotion?: string;
}

export interface ChessState {
  rngState: number;
  /** Seat (0 or 1) playing white. */
  whiteSeat: PlayerId;
  startFen: string | null; // non-null only for custom starts (tests)
  moves: ChessMoveInput[];
  fen: string; // cached current position
  san: string[]; // move history in SAN for display
  /** Piece letters captured BY each seat. */
  captured: string[][];
  resigned: boolean[];
  winner: PlayerId | null;
  drawn: boolean;
  drawReason: string | null;
  lastMove: { from: string; to: string } | null;
}

export type ChessAction = ({ type: 'move' } & ChessMoveInput) | ResignAction;

export type ChessLegal =
  | { type: 'move'; moves: ChessMoveInput[] }
  | { type: 'resign' };

export interface ChessView {
  fen: string;
  whiteSeat: PlayerId;
  turnSeat: PlayerId;
  san: string[];
  captured: string[][];
  inCheck: boolean;
  lastMove: { from: string; to: string } | null;
  winner: PlayerId | null;
  drawn: boolean;
  drawReason: string | null;
  resigned: boolean[];
}

function rebuild(state: ChessState): Chess {
  const c = new Chess(state.startFen ?? undefined);
  for (const m of state.moves) c.move(m);
  return c;
}

function turnSeat(state: ChessState, c: Chess): PlayerId {
  return c.turn() === 'w' ? state.whiteSeat : 1 - state.whiteSeat;
}

function terminal(state: ChessState): boolean {
  return state.winner !== null || state.drawn;
}

export const chessEngine: GameEngine<ChessState, ChessAction, ChessView, ChessLegal> = {
  setup({ seed, options }: SetupConfig): ChessState {
    const rng = new Rng(seed);
    const startFen = typeof options?.fen === 'string' ? options.fen : null;
    const c = new Chess(startFen ?? undefined);
    return {
      rngState: rng.state,
      whiteSeat: rng.int(2),
      startFen,
      moves: [],
      fen: c.fen(),
      san: [],
      captured: [[], []],
      resigned: [false, false],
      winner: null,
      drawn: false,
      drawReason: null,
      lastMove: null,
    };
  },

  getLegalActions(state, player): ChessLegal[] {
    if (terminal(state) || state.resigned[player]) return [];
    const c = rebuild(state);
    if (turnSeat(state, c) !== player) return [{ type: 'resign' }];
    const moves = c.moves({ verbose: true }).map((m: Move) => ({
      from: m.from,
      to: m.to,
      ...(m.promotion ? { promotion: m.promotion } : {}),
    }));
    return [{ type: 'move', moves }, { type: 'resign' }];
  },

  reduce(prev, action, player): ReduceResult<ChessState> | EngineError {
    if (terminal(prev)) return err('ERR_ILLEGAL_ACTION', 'Game is over.');
    if (prev.resigned[player]) return err('ERR_ILLEGAL_ACTION', 'You have resigned.');
    const state: ChessState = structuredClone(prev);
    const events: GameEvent[] = [];

    if (action.type === 'resign') {
      state.resigned[player] = true;
      state.winner = 1 - player;
      events.push({ type: 'resigned', player });
      events.push({ type: 'gameOver', player: state.winner, draw: false });
      return { state, events };
    }

    if (action.type === 'move') {
      const c = rebuild(state);
      if (turnSeat(state, c) !== player) return err('ERR_NOT_YOUR_TURN', 'Not your turn.');
      let made: Move;
      try {
        made = c.move({ from: action.from, to: action.to, promotion: action.promotion });
      } catch {
        return err('ERR_ILLEGAL_ACTION', 'Illegal move.');
      }
      state.moves.push({ from: made.from, to: made.to, ...(made.promotion ? { promotion: made.promotion } : {}) });
      state.san.push(made.san);
      state.fen = c.fen();
      state.lastMove = { from: made.from, to: made.to };
      if (made.captured) state.captured[player]!.push(made.captured);
      events.push({
        type: 'moved',
        player,
        san: made.san,
        capture: made.captured ?? null,
        check: c.inCheck(),
      });

      if (c.isCheckmate()) {
        state.winner = player;
        events.push({ type: 'gameOver', player, draw: false });
      } else if (c.isDraw() || c.isStalemate()) {
        state.drawn = true;
        state.drawReason = c.isStalemate()
          ? 'stalemate'
          : c.isThreefoldRepetition()
            ? 'threefold repetition'
            : c.isInsufficientMaterial()
              ? 'insufficient material'
              : '50-move rule';
        events.push({ type: 'gameOver', player: null, draw: true, reason: state.drawReason });
      }
      return { state, events };
    }

    return err('ERR_ILLEGAL_ACTION', 'Unknown action.');
  },

  view(state, _viewer: Viewer): ChessView {
    const c = rebuild(state);
    return {
      fen: state.fen,
      whiteSeat: state.whiteSeat,
      turnSeat: turnSeat(state, c),
      san: state.san,
      captured: state.captured,
      inCheck: c.inCheck(),
      lastMove: state.lastMove,
      winner: state.winner,
      drawn: state.drawn,
      drawReason: state.drawReason,
      resigned: state.resigned,
    };
  },

  getCurrentActors(state) {
    if (terminal(state)) return [];
    return [turnSeat(state, rebuild(state))];
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

export const chessSpec: GameSpec = {
  id: 'chess',
  name: 'Chess',
  tagline: 'The royal game. Checkmate the enemy king.',
  minPlayers: 2,
  maxPlayers: 2,
  engineVersion: 1,
  engine: chessEngine as unknown as GameEngine,
};
