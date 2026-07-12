/**
 * Uno engine — official core rules, single round (first to empty hand wins):
 * match by color/number/symbol or wild; draw 1 if you can't (you may play the
 * drawn card); Skip / Reverse (acts as Skip with 2 players) / Draw Two /
 * Wild / Wild Draw Four (penalties applied immediately, victim skipped).
 * No jump-ins, challenges, or "Uno!" call penalties — kept single-actor.
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
  type SetupConfig,
  type Viewer,
} from '../../engine.js';
import { Rng } from '../../rng.js';
import { isPlayable, UNO_DECK_SIZE, unoCard, type UnoColor } from './cards.js';

const err = engineError;
const HAND_SIZE = 7;

export interface UnoState {
  rngState: number;
  numPlayers: number;
  direction: 1 | -1;
  current: PlayerId;
  hands: number[][];
  deck: number[]; // last = next draw
  discard: number[]; // last = top
  activeColor: UnoColor;
  /** Card just drawn that may still be played this turn (id, in hand). */
  drawnCard: number | null;
  eliminated: boolean[];
  winner: PlayerId | null;
}

export type UnoAction =
  | { type: 'play'; card: number; color?: UnoColor }
  | { type: 'draw' }
  | { type: 'pass' }
  | { type: 'resign' };

export type UnoLegal =
  | { type: 'play'; cards: number[]; wildCards: number[] }
  | { type: 'draw' }
  | { type: 'pass' }
  | { type: 'resign' };

export interface UnoView {
  numPlayers: number;
  direction: 1 | -1;
  current: PlayerId;
  hand: number[]; // own cards
  handCounts: number[];
  topCard: number;
  activeColor: UnoColor;
  drawnCard: number | null; // own pending drawn card
  deckCount: number;
  eliminated: boolean[];
  winner: PlayerId | null;
}

function living(state: UnoState): PlayerId[] {
  return state.eliminated.map((e, i) => (e ? -1 : i)).filter((i) => i >= 0);
}

function nextLiving(state: UnoState, from: PlayerId, steps: number): PlayerId {
  let p = from;
  for (let s = 0; s < steps; s++) {
    do {
      p = (p + state.numPlayers + state.direction) % state.numPlayers;
    } while (state.eliminated[p]);
  }
  return p;
}

function top(state: UnoState): number {
  return state.discard[state.discard.length - 1]!;
}

/** Draw one card id, reshuffling the discard (minus top) when the deck runs dry. */
function drawOne(state: UnoState): number | null {
  if (state.deck.length === 0) {
    if (state.discard.length <= 1) return null; // pathological: nothing to reshuffle
    const topCard = state.discard.pop()!;
    const rng = new Rng(state.rngState);
    state.deck = rng.shuffle(state.discard);
    state.rngState = rng.state;
    state.discard = [topCard];
  }
  return state.deck.pop() ?? null;
}

function penalize(state: UnoState, victim: PlayerId, count: number, events: GameEvent[]): void {
  let got = 0;
  for (let i = 0; i < count; i++) {
    const c = drawOne(state);
    if (c === null) break;
    state.hands[victim]!.push(c);
    got++;
  }
  events.push({ type: 'penalty', player: victim, count: got });
}

export const unoEngine: GameEngine<UnoState, UnoAction, UnoView, UnoLegal> = {
  setup({ numPlayers, seed }: SetupConfig): UnoState {
    const rng = new Rng(seed);
    let deck = rng.shuffle(Array.from({ length: UNO_DECK_SIZE }, (_, i) => i));
    const hands = Array.from({ length: numPlayers }, () => deck.splice(-HAND_SIZE, HAND_SIZE));
    // Flip until a number card starts the pile (avoids first-card action edge cases).
    const discard: number[] = [];
    for (;;) {
      const c = deck.pop()!;
      discard.push(c);
      if (unoCard(c).kind === 'number') break;
      // non-number starters sink to the bottom of the deck
      deck = [c, ...deck];
      discard.pop();
    }
    return {
      rngState: rng.state,
      numPlayers,
      direction: 1,
      current: rng.int(numPlayers),
      hands,
      deck,
      discard,
      activeColor: unoCard(discard[0]!).color!,
      drawnCard: null,
      eliminated: Array(numPlayers).fill(false),
      winner: null,
    };
  },

  getLegalActions(state, player): UnoLegal[] {
    if (state.winner !== null || state.eliminated[player]) return [];
    const resign: UnoLegal = { type: 'resign' };
    if (player !== state.current) return [resign];
    const hand = state.hands[player]!;
    const t = top(state);

    if (state.drawnCard !== null) {
      // Just drew a playable card: play it or pass.
      return [{ type: 'play', cards: [state.drawnCard], wildCards: wilds([state.drawnCard]) }, { type: 'pass' }, resign];
    }
    const playable = hand.filter((c) => isPlayable(c, t, state.activeColor));
    const legal: UnoLegal[] = [];
    if (playable.length > 0) legal.push({ type: 'play', cards: playable, wildCards: wilds(playable) });
    legal.push({ type: 'draw' }, resign);
    return legal;
  },

  reduce(prev, action, player): ReduceResult<UnoState> | EngineError {
    if (prev.winner !== null) return err('ERR_ILLEGAL_ACTION', 'Game is over.');
    if (prev.eliminated[player]) return err('ERR_ILLEGAL_ACTION', 'You are out of the game.');
    const state = structuredClone(prev);
    const events: GameEvent[] = [];

    if (action.type === 'resign') {
      state.eliminated[player] = true;
      // resigned cards slide under the top of the discard pile
      state.discard.splice(state.discard.length - 1, 0, ...state.hands[player]!);
      state.hands[player] = [];
      events.push({ type: 'resigned', player });
      const alive = living(state);
      if (alive.length === 1) {
        state.winner = alive[0]!;
        events.push({ type: 'gameOver', player: state.winner });
      } else if (state.current === player) {
        state.drawnCard = null;
        state.current = nextLiving(state, player, 1);
        events.push({ type: 'turn', player: state.current });
      }
      return { state, events };
    }

    if (player !== state.current) return err('ERR_NOT_YOUR_TURN', 'Not your turn.');

    switch (action.type) {
      case 'play': {
        const { card } = action;
        const hand = state.hands[player]!;
        if (!hand.includes(card)) return err('ERR_ILLEGAL_ACTION', 'You do not hold that card.');
        if (state.drawnCard !== null && card !== state.drawnCard) {
          return err('ERR_ILLEGAL_ACTION', 'You may only play the card you just drew (or pass).');
        }
        if (!isPlayable(card, top(state), state.activeColor)) {
          return err('ERR_ILLEGAL_ACTION', 'That card does not match.');
        }
        const info = unoCard(card);
        let color: UnoColor;
        if (info.kind === 'wild' || info.kind === 'wild4') {
          if (action.color === undefined || ![0, 1, 2, 3].includes(action.color)) {
            return err('ERR_ILLEGAL_ACTION', 'Choose a color for the wild card.');
          }
          color = action.color;
        } else {
          color = info.color!;
        }

        state.hands[player] = hand.filter((c) => c !== card);
        state.discard.push(card);
        state.activeColor = color;
        state.drawnCard = null;
        events.push({ type: 'played', player, card, color });
        if (state.hands[player]!.length === 1) events.push({ type: 'uno', player });

        if (state.hands[player]!.length === 0) {
          state.winner = player;
          events.push({ type: 'gameOver', player });
          return { state, events };
        }

        const twoLeft = living(state).length === 2;
        switch (info.kind) {
          case 'skip': {
            const skipped = nextLiving(state, player, 1);
            events.push({ type: 'skipped', player: skipped });
            state.current = nextLiving(state, player, 2);
            break;
          }
          case 'reverse': {
            if (twoLeft) {
              // official 2-player rule: reverse acts as skip
              const skipped = nextLiving(state, player, 1);
              events.push({ type: 'skipped', player: skipped });
              state.current = player;
            } else {
              state.direction = state.direction === 1 ? -1 : 1;
              events.push({ type: 'reversed', player });
              state.current = nextLiving(state, player, 1);
            }
            break;
          }
          case 'draw2': {
            const victim = nextLiving(state, player, 1);
            penalize(state, victim, 2, events);
            state.current = nextLiving(state, player, 2);
            break;
          }
          case 'wild4': {
            const victim = nextLiving(state, player, 1);
            penalize(state, victim, 4, events);
            state.current = nextLiving(state, player, 2);
            break;
          }
          default:
            state.current = nextLiving(state, player, 1);
        }
        events.push({ type: 'turn', player: state.current });
        return { state, events };
      }

      case 'draw': {
        if (state.drawnCard !== null) return err('ERR_ILLEGAL_ACTION', 'Play or pass your drawn card first.');
        const c = drawOne(state);
        if (c === null) {
          // nothing left anywhere — turn simply passes
          state.current = nextLiving(state, player, 1);
          events.push({ type: 'turn', player: state.current });
          return { state, events };
        }
        state.hands[player]!.push(c);
        events.push({ type: 'drew', player, count: 1 });
        if (isPlayable(c, top(state), state.activeColor)) {
          state.drawnCard = c; // may play it or pass
        } else {
          state.current = nextLiving(state, player, 1);
          events.push({ type: 'turn', player: state.current });
        }
        return { state, events };
      }

      case 'pass': {
        if (state.drawnCard === null) return err('ERR_ILLEGAL_ACTION', 'You must draw if you cannot play.');
        state.drawnCard = null;
        state.current = nextLiving(state, player, 1);
        events.push({ type: 'turn', player: state.current });
        return { state, events };
      }

      default:
        return err('ERR_ILLEGAL_ACTION', 'Unknown action.');
    }
  },

  view(state, viewer: Viewer): UnoView {
    const me = viewer === 'spectator' ? null : viewer;
    return {
      numPlayers: state.numPlayers,
      direction: state.direction,
      current: state.current,
      hand: me === null ? [] : [...(state.hands[me] ?? [])].sort((a, b) => a - b),
      handCounts: state.hands.map((h) => h.length),
      topCard: top(state),
      activeColor: state.activeColor,
      drawnCard: me === state.current ? state.drawnCard : null,
      deckCount: state.deck.length,
      eliminated: state.eliminated,
      winner: state.winner,
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
      eliminated: state.eliminated.map((e, i) => (e ? i : -1)).filter((i) => i >= 0),
    };
  },
};

function wilds(cards: number[]): number[] {
  return cards.filter((c) => {
    const k = unoCard(c).kind;
    return k === 'wild' || k === 'wild4';
  });
}

export const unoSpec: GameSpec = {
  id: 'uno',
  name: 'Uno',
  tagline: 'Match colors and numbers — first to empty their hand wins.',
  minPlayers: 2,
  maxPlayers: 8,
  engineVersion: 1,
  engine: unoEngine as unknown as GameEngine,
};
