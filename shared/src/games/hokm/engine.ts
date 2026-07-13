/**
 * Hokm (حکم) — the classic Persian trick-taking game.
 *
 * Modes: 4 players (two teams, partners sit across: 0&2 vs 1&3, full deck,
 * 13 each), 3 players (solo, 2♦ removed, 17 each), 2 players (solo, 13 each,
 * 26 dead cards never in play).
 *
 * Flow per hand: the hakem is dealt 5 cards and names the trump suit; the
 * rest is dealt; hakem leads the first trick. Follow suit if you can,
 * otherwise anything (trump cuts). First SIDE to 7 tricks wins the hand and
 * scores 1 point — 2 for a 7–0 sweep (kot), 3 if the swept side was the
 * hakem's (hakem kot). Hakem keeps the seat on a win; on a loss it passes to
 * the next player (clockwise) on the winning side. First side to 7 points
 * wins the match.
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
import { baseDeck, handSize, suitOf, trickWinner, type Suit } from './cards.js';

const err = engineError;
const TRICKS_TO_WIN_HAND = 7;
const POINTS_TO_WIN_MATCH = 7;
const HAKEM_PREVIEW = 5;

export type HokmPhase = 'trump' | 'trick' | 'game_over';

export interface TrickCard {
  player: PlayerId;
  card: number;
}

export interface HokmState {
  rngState: number;
  numPlayers: number;
  phase: HokmPhase;
  hakem: PlayerId;
  trump: Suit | null;
  hands: number[][];
  /** Cards not yet dealt this hand (empty once trump is chosen). */
  undealt: number[];
  trick: TrickCard[];
  leader: PlayerId;
  /** Tricks won this hand, per PLAYER. */
  tricksWon: number[];
  /** Match points per SIDE (4p: [team02, team13]; else per player). */
  points: number[];
  handNumber: number;
  lastTrick: { cards: TrickCard[]; winner: PlayerId } | null;
  eliminated: boolean[];
  winners: PlayerId[]; // filled at match end
}

export type HokmAction =
  | { type: 'chooseTrump'; suit: Suit }
  | { type: 'play'; card: number }
  | ResignAction;

export type HokmLegal =
  | { type: 'chooseTrump'; suits: Suit[] }
  | { type: 'play'; cards: number[] }
  | { type: 'resign' };

export interface HokmView {
  numPlayers: number;
  phase: HokmPhase;
  hakem: PlayerId;
  trump: Suit | null;
  current: PlayerId;
  hand: number[];
  handCounts: number[];
  trick: TrickCard[];
  leader: PlayerId;
  tricksWon: number[];
  sideTricks: number[]; // aggregated per side
  points: number[];
  handNumber: number;
  lastTrick: { cards: TrickCard[]; winner: PlayerId } | null;
  teams: boolean; // 4p team mode?
  eliminated: boolean[];
  winners: PlayerId[];
}

function sideCount(n: number): number {
  return n === 4 ? 2 : n;
}

function sideOf(n: number, p: PlayerId): number {
  return n === 4 ? p % 2 : p;
}

function sideMembers(n: number, side: number): PlayerId[] {
  return n === 4 ? [side, side + 2] : [side];
}

function sideTricks(state: HokmState, side: number): number {
  return sideMembers(state.numPlayers, side).reduce((s, p) => s + state.tricksWon[p]!, 0);
}

function currentPlayer(state: HokmState): PlayerId {
  if (state.phase === 'trump') return state.hakem;
  return (state.leader + state.trick.length) % state.numPlayers;
}

/** Deal a new hand: hakem gets their 5-card preview; the rest waits on trump. */
function dealHand(state: HokmState, events: GameEvent[]): void {
  const rng = new Rng(state.rngState);
  const deck = rng.shuffle(baseDeck(state.numPlayers));
  state.rngState = rng.state;
  const size = handSize(state.numPlayers);
  // sequential slices: hakem's preview first, then the remainder per player
  state.hands = Array.from({ length: state.numPlayers }, () => []);
  state.hands[state.hakem] = deck.slice(0, HAKEM_PREVIEW);
  state.undealt = deck.slice(HAKEM_PREVIEW, state.numPlayers * size); // dead cards (2p) simply never dealt
  state.trump = null;
  state.trick = [];
  state.leader = state.hakem;
  state.tricksWon = Array(state.numPlayers).fill(0);
  state.lastTrick = null;
  state.phase = 'trump';
  events.push({ type: 'handStarted', hand: state.handNumber, hakem: state.hakem });
}

function finishHand(state: HokmState, winnerSide: number, events: GameEvent[]): void {
  const n = state.numPlayers;
  const losers = Array.from({ length: sideCount(n) }, (_, s) => s).filter((s) => s !== winnerSide);
  const swept = losers.every((s) => sideTricks(state, s) === 0);
  const hakemSide = sideOf(n, state.hakem);
  let gained = 1;
  if (swept) gained = winnerSide !== hakemSide ? 3 : 2; // kot / hakem kot
  state.points[winnerSide]! += gained;
  events.push({ type: 'handWon', side: winnerSide, players: sideMembers(n, winnerSide), points: gained, kot: swept, hakemKot: swept && winnerSide !== hakemSide });

  if (state.points[winnerSide]! >= POINTS_TO_WIN_MATCH) {
    state.phase = 'game_over';
    state.winners = sideMembers(n, winnerSide);
    events.push({ type: 'gameOver', players: state.winners });
    return;
  }
  // hakem keeps the seat on a win; otherwise it passes clockwise to the winning side
  if (winnerSide !== hakemSide) {
    let p = state.hakem;
    do {
      p = (p + 1) % n;
    } while (sideOf(n, p) !== winnerSide || state.eliminated[p]);
    state.hakem = p;
    events.push({ type: 'newHakem', player: p });
  }
  state.handNumber++;
  dealHand(state, events);
}

export const hokmEngine: GameEngine<HokmState, HokmAction, HokmView, HokmLegal> = {
  setup({ numPlayers, seed }: SetupConfig): HokmState {
    if (numPlayers < 2 || numPlayers > 4) throw new Error(`Hokm supports 2-4 players, got ${numPlayers}`);
    const rng = new Rng(seed);
    const state: HokmState = {
      rngState: rng.state,
      numPlayers,
      phase: 'trump',
      hakem: rng.int(numPlayers),
      trump: null,
      hands: [],
      undealt: [],
      trick: [],
      leader: 0,
      tricksWon: Array(numPlayers).fill(0),
      points: Array(sideCount(numPlayers)).fill(0),
      handNumber: 1,
      lastTrick: null,
      eliminated: Array(numPlayers).fill(false),
      winners: [],
    };
    state.rngState = rng.state;
    dealHand(state, []);
    return state;
  },

  getLegalActions(state, player): HokmLegal[] {
    if (state.phase === 'game_over' || state.eliminated[player]) return [];
    const resign: HokmLegal = { type: 'resign' };
    if (player !== currentPlayer(state)) return [resign];
    if (state.phase === 'trump') return [{ type: 'chooseTrump', suits: [0, 1, 2, 3] }, resign];
    // trick phase: follow suit when possible
    const hand = state.hands[player]!;
    let cards = hand;
    if (state.trick.length > 0) {
      const led = suitOf(state.trick[0]!.card);
      const followers = hand.filter((c) => suitOf(c) === led);
      if (followers.length > 0) cards = followers;
    }
    return [{ type: 'play', cards }, resign];
  },

  reduce(prev, action, player): ReduceResult<HokmState> | EngineError {
    if (prev.phase === 'game_over') return err('ERR_ILLEGAL_ACTION', 'The match is over.');
    if (prev.eliminated[player]) return err('ERR_ILLEGAL_ACTION', 'You are out of the game.');
    const state = structuredClone(prev);
    const events: GameEvent[] = [];

    if (action.type === 'resign') {
      // Hokm hands cannot continue with a missing player: resigning forfeits
      // the MATCH. 4p: the opposing team wins; 2p/3p: best-placed opponent wins.
      state.eliminated[player] = true;
      events.push({ type: 'resigned', player });
      const n = state.numPlayers;
      let winnerSide: number;
      if (n === 4) {
        winnerSide = 1 - sideOf(n, player);
      } else {
        const rivals = Array.from({ length: n }, (_, p) => p).filter((p) => p !== player && !state.eliminated[p]);
        rivals.sort(
          (a, b) =>
            state.points[b]! - state.points[a]! ||
            state.tricksWon[b]! - state.tricksWon[a]! ||
            a - b,
        );
        winnerSide = rivals[0]!;
      }
      state.phase = 'game_over';
      state.winners = sideMembers(n, winnerSide).filter((p) => !state.eliminated[p]);
      events.push({ type: 'gameOver', players: state.winners, forfeit: true });
      return { state, events };
    }

    if (player !== currentPlayer(state)) return err('ERR_NOT_YOUR_TURN', 'Not your turn.');

    if (action.type === 'chooseTrump') {
      if (state.phase !== 'trump') return err('ERR_ILLEGAL_ACTION', 'Trump is already set.');
      if (![0, 1, 2, 3].includes(action.suit)) return err('ERR_ILLEGAL_ACTION', 'Pick a suit.');
      state.trump = action.suit;
      // deal the rest of the hand
      const size = handSize(state.numPlayers);
      for (let p = 0; p < state.numPlayers; p++) {
        const need = size - state.hands[p]!.length;
        state.hands[p]!.push(...state.undealt.splice(0, need));
      }
      state.undealt = [];
      state.phase = 'trick';
      events.push({ type: 'trumpChosen', player, suit: action.suit });
      return { state, events };
    }

    if (action.type === 'play') {
      if (state.phase !== 'trick') return err('ERR_ILLEGAL_ACTION', 'Waiting for the hakem to choose trump.');
      const hand = state.hands[player]!;
      if (!hand.includes(action.card)) return err('ERR_ILLEGAL_ACTION', 'You do not hold that card.');
      if (state.trick.length > 0) {
        const led = suitOf(state.trick[0]!.card);
        if (suitOf(action.card) !== led && hand.some((c) => suitOf(c) === led)) {
          return err('ERR_ILLEGAL_ACTION', 'You must follow suit.');
        }
      }
      state.hands[player] = hand.filter((c) => c !== action.card);
      state.trick.push({ player, card: action.card });
      events.push({ type: 'cardPlayed', player, card: action.card });

      if (state.trick.length === state.numPlayers) {
        const winner = trickWinner(state.trick, state.trump!);
        state.tricksWon[winner]!++;
        state.lastTrick = { cards: state.trick, winner };
        state.trick = [];
        state.leader = winner;
        events.push({ type: 'trickWon', player: winner });

        const n = state.numPlayers;
        const winSide = sideOf(n, winner);
        if (sideTricks(state, winSide) >= TRICKS_TO_WIN_HAND) {
          finishHand(state, winSide, events);
        } else if (state.hands.every((h) => h.length === 0)) {
          // 3p can exhaust all 17 tricks at 6/6/5 — most tricks wins,
          // ties broken in the hakem's favor, then by seat order
          const sides = Array.from({ length: sideCount(n) }, (_, s) => s);
          sides.sort(
            (a, b) =>
              sideTricks(state, b) - sideTricks(state, a) ||
              (b === sideOf(n, state.hakem) ? 1 : 0) - (a === sideOf(n, state.hakem) ? 1 : 0) ||
              a - b,
          );
          finishHand(state, sides[0]!, events);
        }
      }
      return { state, events };
    }

    return err('ERR_ILLEGAL_ACTION', 'Unknown action.');
  },

  view(state, viewer: Viewer): HokmView {
    const me = viewer === 'spectator' ? null : viewer;
    const n = state.numPlayers;
    const sortHand = (h: number[]) => [...h].sort((a, b) => a - b);
    return {
      numPlayers: n,
      phase: state.phase,
      hakem: state.hakem,
      trump: state.trump,
      current: currentPlayer(state),
      hand: me === null ? [] : sortHand(state.hands[me] ?? []),
      handCounts: state.hands.map((h) => h.length),
      trick: state.trick,
      leader: state.leader,
      tricksWon: state.tricksWon,
      sideTricks: Array.from({ length: sideCount(n) }, (_, s) => sideTricks(state, s)),
      points: state.points,
      handNumber: state.handNumber,
      lastTrick: state.lastTrick,
      teams: n === 4,
      eliminated: state.eliminated,
      winners: state.winners,
    };
  },

  getCurrentActors(state) {
    return state.phase === 'game_over' ? [] : [currentPlayer(state)];
  },

  status(state): EngineStatus {
    return {
      phase: state.phase,
      terminal: state.phase === 'game_over',
      winners: state.winners,
      eliminated: state.eliminated.map((e, i) => (e ? i : -1)).filter((i) => i >= 0),
    };
  },
};

export const hokmSpec: GameSpec = {
  id: 'hokm',
  name: 'Hokm',
  tagline: 'حکم — the hakem calls trump; first side to 7 tricks takes the hand.',
  minPlayers: 2,
  maxPlayers: 4,
  engineVersion: 1,
  engine: hokmEngine as unknown as GameEngine,
};
