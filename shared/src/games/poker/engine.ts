/**
 * Texas Hold'em Poker Game Engine.
 *
 * Rules:
 * - 2 to 8 players.
 * - Standard 52-card deck.
 * - Starting chips: 1000 per player.
 * - Blinds: Small Blind 10, Big Blind 20.
 * - Dealer button rotates clockwise after each hand.
 * - Rounds: Pre-flop (2 hole cards) -> Flop (3 community) -> Turn (1 community) -> River (1 community) -> Showdown.
 * - Actions: Fold, Check, Call, Raise, All-in.
 * - Exact side-pot calculation and hand evaluation.
 * - Elimination at 0 chips; last player standing wins the match.
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
import {
  BIG_BLIND,
  SMALL_BLIND,
  STARTING_CHIPS,
  pokerDeck,
} from './cards.js';
import { evaluateHoldemHand, type HandEvaluation } from './evaluator.js';

const err = engineError;

export type PokerStreet = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
export type PokerPhase = 'betting' | 'showdown' | 'game_over';

export interface ShowdownWinner {
  player: PlayerId;
  evaluation: HandEvaluation;
  wonChips: number;
}

export interface PokerState {
  rngState: number;
  numPlayers: number;
  phase: PokerPhase;
  street: PokerStreet;
  dealer: PlayerId;
  deck: number[];
  hands: number[][]; // 2 hole cards per player
  community: number[]; // 0, 3, 4, or 5 cards
  chips: number[]; // chip stack per player
  pot: number;
  currentBets: number[]; // chips put in during current street
  totalBets: number[]; // chips put in across entire hand
  currentBet: number; // highest current bet on the board
  minRaise: number; // minimum raise increment
  folded: boolean[];
  allIn: boolean[];
  actedThisRound: boolean[];
  currentActor: PlayerId;
  handNumber: number;
  eliminated: boolean[];
  winners: PlayerId[];
  showdownWinners: ShowdownWinner[] | null;
  lastAction: { player: PlayerId; action: string; amount?: number } | null;
}

export type PokerAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise'; amount: number }
  | { type: 'allIn' }
  | { type: 'nextHand' }
  | ResignAction;

export type PokerLegal =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call'; amount: number }
  | { type: 'raise'; min: number; max: number }
  | { type: 'allIn'; amount: number }
  | { type: 'nextHand' }
  | { type: 'resign' };

export interface PokerPlayerView {
  playerId: PlayerId;
  chips: number;
  currentBet: number;
  folded: boolean;
  allIn: boolean;
  eliminated: boolean;
  cardCount: number;
  cards?: number[]; // revealed at showdown or for self
}

export interface PokerView {
  numPlayers: number;
  phase: PokerPhase;
  street: PokerStreet;
  dealer: PlayerId;
  community: number[];
  pot: number;
  currentBet: number;
  currentActor: PlayerId;
  hand: number[]; // viewer's 2 hole cards
  myEvaluation?: HandEvaluation; // viewer's current hand rank
  players: PokerPlayerView[];
  handNumber: number;
  showdownWinners: ShowdownWinner[] | null;
  lastAction: { player: PlayerId; action: string; amount?: number } | null;
  eliminated: boolean[];
  winners: PlayerId[];
}

function nextActiveClockwise(current: PlayerId, n: number, eliminated: boolean[], folded: boolean[]): PlayerId {
  let next = (current + 1) % n;
  while (eliminated[next] || folded[next]) {
    next = (next + 1) % n;
  }
  return next as PlayerId;
}

function nextNonEliminated(current: PlayerId, n: number, eliminated: boolean[]): PlayerId {
  let next = (current + 1) % n;
  while (eliminated[next]) {
    next = (next + 1) % n;
  }
  return next as PlayerId;
}

function nonEliminatedCount(eliminated: boolean[]): number {
  return eliminated.filter((e) => !e).length;
}

function activeInHandCount(eliminated: boolean[], folded: boolean[]): number {
  return eliminated.filter((e, i) => !e && !folded[i]).length;
}

function canActCount(eliminated: boolean[], folded: boolean[], allIn: boolean[]): number {
  return eliminated.filter((e, i) => !e && !folded[i] && !allIn[i]).length;
}

/** Distribute the pot with exact side-pot handling. */
export function resolvePots(
  totalBets: number[],
  folded: boolean[],
  community: number[],
  hands: number[][],
  dealer: PlayerId,
): ShowdownWinner[] {
  const n = totalBets.length;
  const remainingContributions = [...totalBets];
  const wonMap = new Map<PlayerId, number>();

  while (true) {
    // Find min non-zero contribution
    let minContribution = Infinity;
    for (let p = 0; p < n; p++) {
      if (remainingContributions[p]! > 0 && remainingContributions[p]! < minContribution) {
        minContribution = remainingContributions[p]!;
      }
    }
    if (minContribution === Infinity || minContribution === 0) break;

    // Form sub-pot
    let subPot = 0;
    const contributors: PlayerId[] = [];
    for (let p = 0; p < n; p++) {
      if (remainingContributions[p]! > 0) {
        subPot += minContribution;
        remainingContributions[p]! -= minContribution;
        contributors.push(p as PlayerId);
      }
    }

    // Eligible players: contributors who did not fold
    const eligible = contributors.filter((p) => !folded[p]);
    if (eligible.length === 0) {
      // If everyone in this tier folded (should not happen normally), give to last non-folded
      continue;
    }

    if (eligible.length === 1) {
      const winner = eligible[0]!;
      wonMap.set(winner, (wonMap.get(winner) ?? 0) + subPot);
      continue;
    }

    // Evaluate hands of eligible players
    let bestScore = -1;
    let winners: PlayerId[] = [];

    for (const p of eligible) {
      const evaluation = evaluateHoldemHand([...hands[p]!, ...community]);
      if (evaluation.score > bestScore) {
        bestScore = evaluation.score;
        winners = [p];
      } else if (evaluation.score === bestScore) {
        winners.push(p);
      }
    }

    // Split subPot equally
    const share = Math.floor(subPot / winners.length);
    let remainder = subPot % winners.length;

    // Distribute remainder clockwise from dealer
    for (let step = 0; step < n && remainder > 0; step++) {
      const p = ((dealer + 1 + step) % n) as PlayerId;
      if (winners.includes(p)) {
        wonMap.set(p, (wonMap.get(p) ?? 0) + 1);
        remainder--;
      }
    }

    for (const p of winners) {
      wonMap.set(p, (wonMap.get(p) ?? 0) + share);
    }
  }

  // Build result list
  const results: ShowdownWinner[] = [];
  for (const [player, wonChips] of wonMap.entries()) {
    const evaluation = evaluateHoldemHand([...hands[player]!, ...community]);
    results.push({ player, evaluation, wonChips });
  }
  return results;
}

/** Start a new Texas Hold'em hand. */
function startPokerHand(state: PokerState, events: GameEvent[]): void {
  const n = state.numPlayers;
  const nonElim = nonEliminatedCount(state.eliminated);
  if (nonElim <= 1) {
    state.phase = 'game_over';
    state.winners = Array.from({ length: n }, (_, i) => i as PlayerId).filter((i) => !state.eliminated[i]);
    events.push({ type: 'gameOver', winners: state.winners });
    return;
  }

  const rng = new Rng(state.rngState);
  const deck = rng.shuffle(pokerDeck());
  state.rngState = rng.state;

  state.deck = deck;
  state.community = [];
  state.pot = 0;
  state.currentBets = Array(n).fill(0);
  state.totalBets = Array(n).fill(0);
  state.folded = Array(n).fill(false);
  state.allIn = Array(n).fill(false);
  state.actedThisRound = Array(n).fill(false);
  state.showdownWinners = null;
  state.lastAction = null;
  state.phase = 'betting';
  state.street = 'preflop';

  // For eliminated players, mark them folded
  for (let p = 0; p < n; p++) {
    if (state.eliminated[p]) {
      state.folded[p] = true;
      state.hands[p] = [];
    }
  }

  // Deal 2 hole cards to each non-eliminated player
  let cardIdx = 0;
  for (let p = 0; p < n; p++) {
    if (!state.eliminated[p]) {
      state.hands[p] = [deck[cardIdx++]!, deck[cardIdx++]!];
    }
  }
  state.deck = deck.slice(cardIdx);

  // Blinds determination:
  // Heads-up (2 active players): Dealer is SB, next is BB
  let sbPlayer: PlayerId;
  let bbPlayer: PlayerId;
  let firstActor: PlayerId;

  if (nonElim === 2) {
    sbPlayer = state.dealer;
    bbPlayer = nextNonEliminated(state.dealer, n, state.eliminated);
    firstActor = sbPlayer; // SB acts first pre-flop heads-up
  } else {
    sbPlayer = nextNonEliminated(state.dealer, n, state.eliminated);
    bbPlayer = nextNonEliminated(sbPlayer, n, state.eliminated);
    firstActor = nextNonEliminated(bbPlayer, n, state.eliminated); // UTG acts first
  }

  // Post Small Blind
  const sbAmount = Math.min(state.chips[sbPlayer]!, SMALL_BLIND);
  state.chips[sbPlayer]! -= sbAmount;
  state.currentBets[sbPlayer] = sbAmount;
  state.totalBets[sbPlayer] = sbAmount;
  state.pot += sbAmount;
  if (state.chips[sbPlayer] === 0) state.allIn[sbPlayer] = true;

  // Post Big Blind
  const bbAmount = Math.min(state.chips[bbPlayer]!, BIG_BLIND);
  state.chips[bbPlayer]! -= bbAmount;
  state.currentBets[bbPlayer] = bbAmount;
  state.totalBets[bbPlayer] = bbAmount;
  state.pot += bbAmount;
  if (state.chips[bbPlayer] === 0) state.allIn[bbPlayer] = true;

  state.currentBet = Math.max(sbAmount, bbAmount);
  state.minRaise = BIG_BLIND;
  state.currentActor = firstActor;

  events.push({
    type: 'handStarted',
    hand: state.handNumber,
    dealer: state.dealer,
    smallBlind: { player: sbPlayer, amount: sbAmount },
    bigBlind: { player: bbPlayer, amount: bbAmount },
  });
}

function advanceStreet(state: PokerState, events: GameEvent[]): void {
  const n = state.numPlayers;
  state.currentBets = Array(n).fill(0);
  state.currentBet = 0;
  state.minRaise = BIG_BLIND;
  state.actedThisRound = Array(n).fill(false);

  // Check if hand can be decided immediately because all but 1 folded
  if (activeInHandCount(state.eliminated, state.folded) === 1) {
    resolveImmediateFoldWinner(state, events);
    return;
  }

  // Deal community cards depending on current street
  if (state.street === 'preflop') {
    state.street = 'flop';
    state.community.push(...state.deck.splice(0, 3));
    events.push({ type: 'streetDealt', street: 'flop', cards: [...state.community] });
  } else if (state.street === 'flop') {
    state.street = 'turn';
    state.community.push(...state.deck.splice(0, 1));
    events.push({ type: 'streetDealt', street: 'turn', cards: [...state.community] });
  } else if (state.street === 'turn') {
    state.street = 'river';
    state.community.push(...state.deck.splice(0, 1));
    events.push({ type: 'streetDealt', street: 'river', cards: [...state.community] });
  } else if (state.street === 'river') {
    // Showdown!
    state.street = 'showdown';
    state.phase = 'showdown';
    performShowdown(state, events);
    return;
  }

  // Check if 0 or 1 players can act (others are all-in)
  if (canActCount(state.eliminated, state.folded, state.allIn) <= 1) {
    // Fast-forward to showdown: deal remaining community cards
    while (state.community.length < 5) {
      state.community.push(...state.deck.splice(0, 1));
    }
    state.street = 'showdown';
    state.phase = 'showdown';
    events.push({ type: 'allInRunout', cards: [...state.community] });
    performShowdown(state, events);
    return;
  }

  // First actor post-flop: first active player clockwise from dealer
  state.currentActor = nextActiveClockwise(state.dealer, n, state.eliminated, state.folded);
}

function resolveImmediateFoldWinner(state: PokerState, events: GameEvent[]): void {
  const n = state.numPlayers;
  const winner = Array.from({ length: n }, (_, i) => i as PlayerId).find(
    (p) => !state.eliminated[p] && !state.folded[p],
  )!;

  state.chips[winner]! += state.pot;
  events.push({
    type: 'potWonFold',
    player: winner,
    amount: state.pot,
  });

  state.phase = 'showdown';
  state.street = 'showdown';
  state.showdownWinners = [
    {
      player: winner,
      evaluation: evaluateHoldemHand([...state.hands[winner]!, ...state.community]),
      wonChips: state.pot,
    },
  ];
  state.pot = 0;
  checkEliminations(state, events);
}

function performShowdown(state: PokerState, events: GameEvent[]): void {
  const winners = resolvePots(
    state.totalBets,
    state.folded,
    state.community,
    state.hands,
    state.dealer,
  );

  state.showdownWinners = winners;
  for (const w of winners) {
    state.chips[w.player]! += w.wonChips;
  }
  state.pot = 0;

  events.push({
    type: 'showdown',
    winners: winners.map((w) => ({
      player: w.player,
      label: w.evaluation.label,
      wonChips: w.wonChips,
      cards: state.hands[w.player],
    })),
  });

  checkEliminations(state, events);
}

function checkEliminations(state: PokerState, events: GameEvent[]): void {
  const n = state.numPlayers;
  for (let p = 0; p < n; p++) {
    if (!state.eliminated[p] && state.chips[p] === 0) {
      state.eliminated[p] = true;
      events.push({ type: 'playerEliminated', player: p });
    }
  }

  const remaining = nonEliminatedCount(state.eliminated);
  if (remaining <= 1) {
    state.phase = 'game_over';
    state.winners = Array.from({ length: n }, (_, i) => i as PlayerId).filter((i) => !state.eliminated[i]);
    events.push({ type: 'gameOver', winners: state.winners });
  }
}

export const pokerEngine: GameEngine<PokerState, PokerAction, PokerView, PokerLegal> = {
  setup({ numPlayers, seed }: SetupConfig): PokerState {
    if (numPlayers < 2 || numPlayers > 8) {
      throw new Error(`Poker supports 2-8 players, got ${numPlayers}`);
    }
    const rng = new Rng(seed);
    const state: PokerState = {
      rngState: rng.state,
      numPlayers,
      phase: 'betting',
      street: 'preflop',
      dealer: rng.int(numPlayers) as PlayerId,
      deck: [],
      hands: Array.from({ length: numPlayers }, () => []),
      community: [],
      chips: Array(numPlayers).fill(STARTING_CHIPS),
      pot: 0,
      currentBets: Array(numPlayers).fill(0),
      totalBets: Array(numPlayers).fill(0),
      currentBet: 0,
      minRaise: BIG_BLIND,
      folded: Array(numPlayers).fill(false),
      allIn: Array(numPlayers).fill(false),
      actedThisRound: Array(numPlayers).fill(false),
      currentActor: 0,
      handNumber: 1,
      eliminated: Array(numPlayers).fill(false),
      winners: [],
      showdownWinners: null,
      lastAction: null,
    };
    state.rngState = rng.state;
    startPokerHand(state, []);
    return state;
  },

  getLegalActions(state, player): PokerLegal[] {
    if (state.phase === 'game_over' || state.eliminated[player]) return [];
    const resign: PokerLegal = { type: 'resign' };

    if (state.phase === 'showdown') {
      return [{ type: 'nextHand' }, resign];
    }

    if (player !== state.currentActor) return [resign];

    const actions: PokerLegal[] = [];
    actions.push({ type: 'fold' });

    const playerBet = state.currentBets[player]!;
    const toCall = state.currentBet - playerBet;
    const chips = state.chips[player]!;

    if (toCall === 0) {
      actions.push({ type: 'check' });
    } else {
      actions.push({ type: 'call', amount: Math.min(chips, toCall) });
    }

    // Can raise if player has chips beyond toCall
    if (chips > toCall) {
      const minRaiseTotal = state.currentBet + state.minRaise;
      const maxRaiseTotal = playerBet + chips;
      actions.push({
        type: 'raise',
        min: Math.min(minRaiseTotal, maxRaiseTotal),
        max: maxRaiseTotal,
      });
    }

    if (chips > 0) {
      actions.push({ type: 'allIn', amount: chips });
    }

    actions.push(resign);
    return actions;
  },

  reduce(prev, action, player): ReduceResult<PokerState> | EngineError {
    if (prev.phase === 'game_over') return err('ERR_ILLEGAL_ACTION', 'The game is over.');
    if (prev.eliminated[player]) return err('ERR_ILLEGAL_ACTION', 'You are eliminated.');
    const state = structuredClone(prev);
    const events: GameEvent[] = [];
    const n = state.numPlayers;

    if (action.type === 'resign') {
      state.eliminated[player] = true;
      state.folded[player] = true;
      events.push({ type: 'resigned', player });

      const remaining = nonEliminatedCount(state.eliminated);
      if (remaining <= 1) {
        state.phase = 'game_over';
        state.winners = Array.from({ length: n }, (_, i) => i as PlayerId).filter((i) => !state.eliminated[i]);
        events.push({ type: 'gameOver', winners: state.winners, forfeit: true });
        return { state, events };
      }

      // If active actor resigned mid-round, pass turn
      if (state.phase === 'betting' && state.currentActor === player) {
        state.currentActor = nextActiveClockwise(player, n, state.eliminated, state.folded);
      }
      return { state, events };
    }

    if (state.phase === 'showdown') {
      if (action.type === 'nextHand') {
        state.dealer = nextNonEliminated(state.dealer, n, state.eliminated);
        state.handNumber++;
        startPokerHand(state, events);
        return { state, events };
      }
      return err('ERR_ILLEGAL_ACTION', 'Action must be nextHand.');
    }

    if (player !== state.currentActor) {
      return err('ERR_NOT_YOUR_TURN', 'It is not your turn to act.');
    }

    const playerBet = state.currentBets[player]!;
    const toCall = state.currentBet - playerBet;
    const chips = state.chips[player]!;

    if (action.type === 'fold') {
      state.folded[player] = true;
      state.actedThisRound[player] = true;
      state.lastAction = { player, action: 'fold' };
      events.push({ type: 'playerFolded', player });

      if (activeInHandCount(state.eliminated, state.folded) === 1) {
        resolveImmediateFoldWinner(state, events);
        return { state, events };
      }
    } else if (action.type === 'check') {
      if (toCall > 0) return err('ERR_ILLEGAL_ACTION', 'Cannot check, there is an active bet to call.');
      state.actedThisRound[player] = true;
      state.lastAction = { player, action: 'check' };
      events.push({ type: 'playerChecked', player });
    } else if (action.type === 'call') {
      const callAmount = Math.min(chips, toCall);
      state.chips[player]! -= callAmount;
      state.currentBets[player]! += callAmount;
      state.totalBets[player]! += callAmount;
      state.pot += callAmount;
      state.actedThisRound[player] = true;
      if (state.chips[player] === 0) state.allIn[player] = true;

      state.lastAction = { player, action: 'call', amount: callAmount };
      events.push({ type: 'playerCalled', player, amount: callAmount });
    } else if (action.type === 'raise') {
      const targetBet = action.amount;
      const minRaiseTotal = state.currentBet + state.minRaise;
      const maxRaiseTotal = playerBet + chips;

      if (targetBet < Math.min(minRaiseTotal, maxRaiseTotal) || targetBet > maxRaiseTotal) {
        return err('ERR_ILLEGAL_ACTION', `Raise must be between ${Math.min(minRaiseTotal, maxRaiseTotal)} and ${maxRaiseTotal}.`);
      }

      const raiseDiff = targetBet - state.currentBet;
      if (raiseDiff > state.minRaise) {
        state.minRaise = raiseDiff;
      }

      const chipCommitment = targetBet - playerBet;
      state.chips[player]! -= chipCommitment;
      state.currentBets[player] = targetBet;
      state.totalBets[player]! += chipCommitment;
      state.pot += chipCommitment;
      state.currentBet = targetBet;

      if (state.chips[player] === 0) state.allIn[player] = true;

      // Re-open betting for other active non-all-in players
      for (let p = 0; p < n; p++) {
        if (p !== player && !state.eliminated[p] && !state.folded[p] && !state.allIn[p]) {
          state.actedThisRound[p] = false;
        }
      }
      state.actedThisRound[player] = true;

      state.lastAction = { player, action: 'raise', amount: targetBet };
      events.push({ type: 'playerRaised', player, amount: targetBet });
    } else if (action.type === 'allIn') {
      const allInAmount = chips;
      const newTotalBet = playerBet + allInAmount;

      state.chips[player] = 0;
      state.currentBets[player] = newTotalBet;
      state.totalBets[player]! += allInAmount;
      state.pot += allInAmount;
      state.allIn[player] = true;
      state.actedThisRound[player] = true;

      if (newTotalBet > state.currentBet) {
        const diff = newTotalBet - state.currentBet;
        if (diff >= state.minRaise) {
          state.minRaise = diff;
        }
        state.currentBet = newTotalBet;
        // Re-open betting
        for (let p = 0; p < n; p++) {
          if (p !== player && !state.eliminated[p] && !state.folded[p] && !state.allIn[p]) {
            state.actedThisRound[p] = false;
          }
        }
      }

      state.lastAction = { player, action: 'allIn', amount: allInAmount };
      events.push({ type: 'playerAllIn', player, amount: allInAmount });
    } else {
      return err('ERR_ILLEGAL_ACTION', 'Unknown action.');
    }

    // Check if betting round is complete:
    // Every active non-all-in player has acted AND has bet equal to currentBet
    const canAct = Array.from({ length: n }, (_, p) => p as PlayerId).filter(
      (p) => !state.eliminated[p] && !state.folded[p] && !state.allIn[p],
    );

    const roundFinished = canAct.every(
      (p) => state.actedThisRound[p] && state.currentBets[p] === state.currentBet,
    );

    if (roundFinished || canAct.length === 0) {
      advanceStreet(state, events);
    } else {
      state.currentActor = nextActiveClockwise(player, n, state.eliminated, state.folded);
    }

    return { state, events };
  },

  view(state, viewer: Viewer): PokerView {
    const me = viewer === 'spectator' ? null : viewer;
    const isShowdown = state.phase === 'showdown' || state.phase === 'game_over';

    const playerViews: PokerPlayerView[] = state.chips.map((chips, p) => {
      const isMe = me === p;
      const shouldReveal = isMe || (isShowdown && !state.folded[p]);
      return {
        playerId: p as PlayerId,
        chips,
        currentBet: state.currentBets[p]!,
        folded: state.folded[p]!,
        allIn: state.allIn[p]!,
        eliminated: state.eliminated[p]!,
        cardCount: state.hands[p]!.length,
        cards: shouldReveal ? state.hands[p] : undefined,
      };
    });

    const myHand = me === null ? [] : (state.hands[me] ?? []);
    let myEvaluation: HandEvaluation | undefined;
    if (me !== null && myHand.length === 2) {
      myEvaluation = evaluateHoldemHand([...myHand, ...state.community]);
    }

    return {
      numPlayers: state.numPlayers,
      phase: state.phase,
      street: state.street,
      dealer: state.dealer,
      community: state.community,
      pot: state.pot,
      currentBet: state.currentBet,
      currentActor: state.currentActor,
      hand: myHand,
      myEvaluation,
      players: playerViews,
      handNumber: state.handNumber,
      showdownWinners: state.showdownWinners,
      lastAction: state.lastAction,
      eliminated: state.eliminated,
      winners: state.winners,
    };
  },

  getCurrentActors(state) {
    if (state.phase === 'game_over') return [];
    if (state.phase === 'showdown') {
      // Anyone non-eliminated can advance to next hand
      return Array.from({ length: state.numPlayers }, (_, i) => i as PlayerId).filter((i) => !state.eliminated[i]);
    }
    return [state.currentActor];
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

export const pokerSpec: GameSpec = {
  id: 'poker',
  name: 'Texas Hold\'em Poker',
  tagline: 'Classic No-Limit Texas Hold\'em — hole cards, flop, turn, river and side-pots.',
  minPlayers: 2,
  maxPlayers: 8,
  engineVersion: 1,
  engine: pokerEngine as unknown as GameEngine,
};
