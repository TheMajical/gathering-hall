/**
 * Coinflip — a deliberately trivial game used to exercise the platform shell
 * (turns, RNG, events, terminal detection) before/alongside the real games.
 * Players take turns calling a coin flip; first to 3 correct calls wins.
 */
import {
  engineError,
  type EngineStatus,
  type GameEngine,
  type GameSpec,
  type PlayerId,
  type ReduceResult,
  type ResignAction,
  type SetupConfig,
  type Viewer,
} from '../../engine.js';
import { Rng } from '../../rng.js';

const TARGET = 3;

export interface CoinflipState {
  rngState: number;
  numPlayers: number;
  current: PlayerId;
  scores: number[];
  resigned: boolean[];
  winner: PlayerId | null;
}

export type CoinflipAction = { type: 'call'; side: 'heads' | 'tails' } | ResignAction;

export interface CoinflipView {
  numPlayers: number;
  current: PlayerId;
  scores: number[];
  resigned: boolean[];
  winner: PlayerId | null;
  target: number;
}

export type CoinflipLegal = { type: 'call'; sides: ['heads', 'tails'] } | { type: 'resign' };

function living(state: CoinflipState): PlayerId[] {
  return state.scores.map((_, i) => i).filter((i) => !state.resigned[i]);
}

function nextLiving(state: CoinflipState, from: PlayerId): PlayerId {
  let p = from;
  do {
    p = (p + 1) % state.numPlayers;
  } while (state.resigned[p]);
  return p;
}

export const coinflipEngine: GameEngine<CoinflipState, CoinflipAction, CoinflipView, CoinflipLegal> = {
  setup({ numPlayers, seed }: SetupConfig): CoinflipState {
    return {
      rngState: seed >>> 0,
      numPlayers,
      current: 0,
      scores: Array(numPlayers).fill(0),
      resigned: Array(numPlayers).fill(false),
      winner: null,
    };
  },

  getLegalActions(state, player) {
    if (state.winner !== null || state.resigned[player]) return [];
    if (player !== state.current) return [{ type: 'resign' }];
    return [{ type: 'call', sides: ['heads', 'tails'] }, { type: 'resign' }];
  },

  reduce(state, action, player): ReduceResult<CoinflipState> | ReturnType<typeof engineError> {
    if (state.winner !== null) return engineError('ERR_ILLEGAL_ACTION', 'Game is over.');
    if (state.resigned[player]) return engineError('ERR_ILLEGAL_ACTION', 'You have resigned.');

    if (action.type === 'resign') {
      const s = { ...state, resigned: state.resigned.slice() };
      s.resigned[player] = true;
      const alive = living(s);
      const events = [{ type: 'resigned', player }];
      if (alive.length === 1) {
        s.winner = alive[0]!;
        events.push({ type: 'gameOver', player: s.winner });
      } else if (s.current === player) {
        s.current = nextLiving(s, player);
      }
      return { state: s, events };
    }

    if (action.type === 'call') {
      if (player !== state.current) return engineError('ERR_NOT_YOUR_TURN', 'Not your turn.');
      if (action.side !== 'heads' && action.side !== 'tails') {
        return engineError('ERR_ILLEGAL_ACTION', 'Call heads or tails.');
      }
      const rng = new Rng(state.rngState);
      const side = rng.next() < 0.5 ? 'heads' : 'tails';
      const hit = side === action.side;
      const s: CoinflipState = {
        ...state,
        rngState: rng.state,
        scores: state.scores.slice(),
      };
      if (hit) s.scores[player] = (s.scores[player] ?? 0) + 1;
      const events: { type: string; [k: string]: unknown }[] = [
        { type: 'flipped', player, call: action.side, side, hit },
      ];
      if ((s.scores[player] ?? 0) >= TARGET) {
        s.winner = player;
        events.push({ type: 'gameOver', player });
      } else {
        s.current = nextLiving(s, player);
      }
      return { state: s, events };
    }

    return engineError('ERR_ILLEGAL_ACTION', 'Unknown action.');
  },

  view(state, _viewer: Viewer): CoinflipView {
    return {
      numPlayers: state.numPlayers,
      current: state.current,
      scores: state.scores,
      resigned: state.resigned,
      winner: state.winner,
      target: TARGET,
    };
  },

  getCurrentActors(state) {
    return state.winner === null ? [state.current] : [];
  },

  status(state): EngineStatus {
    return {
      phase: state.winner === null ? 'playing' : 'game_over',
      terminal: state.winner !== null,
      winners: state.winner === null ? [] : [state.winner],
      eliminated: state.resigned.map((r, i) => (r ? i : -1)).filter((i) => i >= 0),
    };
  },
};

export const coinflipSpec: GameSpec = {
  id: 'coinflip',
  name: 'Coinflip',
  tagline: 'Call the toss — first to three wins. (test game)',
  minPlayers: 2,
  maxPlayers: 6,
  engineVersion: 1,
  engine: coinflipEngine as GameEngine,
};
