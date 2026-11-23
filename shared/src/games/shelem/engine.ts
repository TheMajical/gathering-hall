/**
 * Shelem (شلم) Game Engine.
 *
 * Rules:
 * - 4 players in two fixed partnerships: 0&2 (Side 0) vs 1&3 (Side 1).
 * - 52 cards (ranks 2..10, J, Q, K, A in 4 suits ♥, ♦, ♣, ♠).
 * - Standard 165 without jokers (شلم بدون جوکر):
 *   - Each Ace = 10 pts, each 10 = 10 pts, each 5 = 5 pts (total 100 card pts).
 *   - 12 tricks + 1 ground/widow trick = 13 tricks * 5 = 65 trick pts.
 *   - Total = 165 pts per hand.
 * - Phases:
 *   1. Bidding (حراج): 12 cards dealt to each player, 4 to the ground.
 *      Players bid 100..165 in increments of 5, or pass. Highest bidder becomes Hakem.
 *      If all 4 pass, cards are redealt by next dealer.
 *   2. Widow (برداشتن برگ‌های زمین):
 *      Hakem takes 4 ground cards (now 16 cards), selects trump, and buries 4 cards.
 *      Burying counts as Hakem's first won trick (5 pts + card points inside).
 *   3. Trick play:
 *      Hakem leads. Must follow suit if possible; highest trump wins, or highest led suit.
 *      Trick winner leads next trick.
 *   4. Scoring & Contract:
 *      Hakem makes contract if team pts >= bid.
 *      If made: Hakem team gets earned points (or 330 if Shelem bid 165 and took 165).
 *      If failed (kaseh): Hakem team loses bid amount (-bid, or -330 if Shelem).
 *      Defenders always get their earned points.
 *      First team to 660 wins the match.
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
  BID_STEP,
  MAX_BID,
  MIN_BID,
  POINTS_TO_WIN_MATCH,
  SHELEM_BID,
  SHELEM_SCORE,
  TRICK_BONUS,
  cardPointValue,
  shelemDeck,
  suitOf,
  trickScore,
  trickWinner,
  type Suit,
} from './cards.js';

const err = engineError;

export type ShelemPhase = 'bidding' | 'widow' | 'trick' | 'game_over';

export interface ShelemTrickCard {
  player: PlayerId;
  card: number;
}

export interface BidEntry {
  player: PlayerId;
  bid: number | 'pass';
}

export interface ShelemState {
  rngState: number;
  numPlayers: 4;
  phase: ShelemPhase;
  dealer: PlayerId;
  currentActor: PlayerId;
  bids: BidEntry[];
  currentBid: number;
  highestBidder: PlayerId | null;
  passed: boolean[];
  hakem: PlayerId;
  targetBid: number;
  trump: Suit | null;
  hands: number[][];
  ground: number[];
  buriedGround: number[];
  trick: ShelemTrickCard[];
  leader: PlayerId;
  tricksWon: number[];
  handPoints: [number, number]; // [team02, team13]
  matchPoints: [number, number];
  handNumber: number;
  lastTrick: { cards: ShelemTrickCard[]; winner: PlayerId } | null;
  eliminated: boolean[];
  winners: PlayerId[];
}

export type ShelemAction =
  | { type: 'bid'; amount: number }
  | { type: 'pass' }
  | { type: 'chooseTrump'; suit: Suit }
  | { type: 'discardGround'; cards: number[] }
  | { type: 'declareAndDiscard'; suit: Suit; cards: number[] }
  | { type: 'play'; card: number }
  | ResignAction;

export type ShelemLegal =
  | { type: 'bid'; amounts: number[] }
  | { type: 'pass' }
  | { type: 'chooseTrump'; suits: Suit[] }
  | { type: 'discardGround'; count: 4 }
  | { type: 'play'; cards: number[] }
  | { type: 'resign' };

export interface ShelemView {
  numPlayers: 4;
  phase: ShelemPhase;
  dealer: PlayerId;
  currentActor: PlayerId;
  bids: BidEntry[];
  currentBid: number;
  highestBidder: PlayerId | null;
  hakem: PlayerId;
  targetBid: number;
  trump: Suit | null;
  hand: number[];
  handCounts: number[];
  groundCount: number;
  buriedGroundCount: number;
  trick: ShelemTrickCard[];
  leader: PlayerId;
  tricksWon: number[];
  handPoints: [number, number];
  matchPoints: [number, number];
  handNumber: number;
  lastTrick: { cards: ShelemTrickCard[]; winner: PlayerId } | null;
  teams: true;
  eliminated: boolean[];
  winners: PlayerId[];
}

export function sideOf(p: PlayerId): 0 | 1 {
  return (p % 2) as 0 | 1;
}

export function teamMembers(side: 0 | 1): [PlayerId, PlayerId] {
  return [side, (side + 2) as PlayerId];
}

function nextActiveBidder(current: PlayerId, passed: boolean[]): PlayerId {
  let next = (current + 1) % 4;
  while (passed[next]) {
    next = (next + 1) % 4;
  }
  return next as PlayerId;
}

/** Deal 12 cards to each player and 4 to the ground. */
function dealShelemHand(state: ShelemState, events: GameEvent[]): void {
  const rng = new Rng(state.rngState);
  const deck = rng.shuffle(shelemDeck());
  state.rngState = rng.state;

  // 12 cards to each of 4 players (48), last 4 on ground
  state.hands = [
    deck.slice(0, 12),
    deck.slice(12, 24),
    deck.slice(24, 36),
    deck.slice(36, 48),
  ];
  state.ground = deck.slice(48, 52);
  state.buriedGround = [];
  state.bids = [];
  state.currentBid = 0;
  state.highestBidder = null;
  state.passed = [false, false, false, false];
  state.trump = null;
  state.trick = [];
  state.tricksWon = [0, 0, 0, 0];
  state.handPoints = [0, 0];
  state.lastTrick = null;
  state.phase = 'bidding';
  state.currentActor = ((state.dealer + 1) % 4) as PlayerId;

  events.push({
    type: 'handStarted',
    hand: state.handNumber,
    dealer: state.dealer,
    firstBidder: state.currentActor,
  });
}

function finishShelemHand(state: ShelemState, events: GameEvent[]): void {
  // Add buried ground points to Hakem's side
  const hakemSide = sideOf(state.hakem);
  const defSide = (1 - hakemSide) as 0 | 1;
  const groundScore = trickScore(state.buriedGround);
  state.handPoints[hakemSide] += groundScore;

  const bid = state.targetBid;
  const hakemMade = state.handPoints[hakemSide] >= bid;
  let hakemGain: number;

  if (hakemMade) {
    if (bid === SHELEM_BID && state.handPoints[hakemSide] === 165) {
      hakemGain = SHELEM_SCORE; // 330
    } else {
      hakemGain = state.handPoints[hakemSide];
    }
  } else {
    // Kaseh (failed contract)
    if (bid === SHELEM_BID) {
      hakemGain = -SHELEM_SCORE; // -330
    } else {
      hakemGain = -bid;
    }
  }

  const defGain = state.handPoints[defSide];
  state.matchPoints[hakemSide] += hakemGain;
  state.matchPoints[defSide] += defGain;

  events.push({
    type: 'handWon',
    hand: state.handNumber,
    hakem: state.hakem,
    hakemSide,
    bid,
    made: hakemMade,
    hakemPoints: state.handPoints[hakemSide],
    defendingPoints: state.handPoints[defSide],
    hakemGain,
    defendingGain: defGain,
    matchPoints: [...state.matchPoints],
  });

  // Check for match winner
  const side0Wins = state.matchPoints[0] >= POINTS_TO_WIN_MATCH;
  const side1Wins = state.matchPoints[1] >= POINTS_TO_WIN_MATCH;

  if (side0Wins || side1Wins) {
    if (state.matchPoints[0] !== state.matchPoints[1]) {
      const winnerSide = state.matchPoints[0] > state.matchPoints[1] ? 0 : 1;
      state.phase = 'game_over';
      state.winners = teamMembers(winnerSide as 0 | 1);
      events.push({ type: 'gameOver', winners: state.winners, matchPoints: [...state.matchPoints] });
      return;
    }
    // If tied at/above 660, continue next hand to break tie
  }

  // Next hand: dealer rotates clockwise
  state.dealer = ((state.dealer + 1) % 4) as PlayerId;
  state.handNumber++;
  dealShelemHand(state, events);
}

export const shelemEngine: GameEngine<ShelemState, ShelemAction, ShelemView, ShelemLegal> = {
  setup({ seed }: SetupConfig): ShelemState {
    const rng = new Rng(seed);
    const state: ShelemState = {
      rngState: rng.state,
      numPlayers: 4,
      phase: 'bidding',
      dealer: rng.int(4) as PlayerId,
      currentActor: 0,
      bids: [],
      currentBid: 0,
      highestBidder: null,
      passed: [false, false, false, false],
      hakem: 0,
      targetBid: 0,
      trump: null,
      hands: [[], [], [], []],
      ground: [],
      buriedGround: [],
      trick: [],
      leader: 0,
      tricksWon: [0, 0, 0, 0],
      handPoints: [0, 0],
      matchPoints: [0, 0],
      handNumber: 1,
      lastTrick: null,
      eliminated: [false, false, false, false],
      winners: [],
    };
    state.rngState = rng.state;
    dealShelemHand(state, []);
    return state;
  },

  getLegalActions(state, player): ShelemLegal[] {
    if (state.phase === 'game_over' || state.eliminated[player]) return [];
    const resign: ShelemLegal = { type: 'resign' };

    if (player !== state.currentActor) return [resign];

    if (state.phase === 'bidding') {
      const minBid = state.currentBid === 0 ? MIN_BID : state.currentBid + BID_STEP;
      const amounts: number[] = [];
      for (let a = minBid; a <= MAX_BID; a += BID_STEP) {
        amounts.push(a);
      }
      return [{ type: 'bid', amounts }, { type: 'pass' }, resign];
    }

    if (state.phase === 'widow') {
      const actions: ShelemLegal[] = [];
      if (state.trump === null) {
        actions.push({ type: 'chooseTrump', suits: [0, 1, 2, 3] });
      }
      if (state.hands[player]!.length === 16) {
        actions.push({ type: 'discardGround', count: 4 });
      }
      actions.push(resign);
      return actions;
    }

    if (state.phase === 'trick') {
      const hand = state.hands[player]!;
      let cards = hand;
      if (state.trick.length > 0) {
        const led = suitOf(state.trick[0]!.card);
        const followers = hand.filter((c) => suitOf(c) === led);
        if (followers.length > 0) cards = followers;
      }
      return [{ type: 'play', cards }, resign];
    }

    return [resign];
  },

  reduce(prev, action, player): ReduceResult<ShelemState> | EngineError {
    if (prev.phase === 'game_over') return err('ERR_ILLEGAL_ACTION', 'The match is over.');
    if (prev.eliminated[player]) return err('ERR_ILLEGAL_ACTION', 'You are eliminated.');
    const state = structuredClone(prev);
    const events: GameEvent[] = [];

    if (action.type === 'resign') {
      state.eliminated[player] = true;
      events.push({ type: 'resigned', player });
      const opposingSide = (1 - sideOf(player)) as 0 | 1;
      state.phase = 'game_over';
      state.winners = teamMembers(opposingSide);
      events.push({ type: 'gameOver', winners: state.winners, forfeit: true });
      return { state, events };
    }

    if (player !== state.currentActor) {
      return err('ERR_NOT_YOUR_TURN', 'It is not your turn to act.');
    }

    if (state.phase === 'bidding') {
      if (action.type === 'pass') {
        state.passed[player] = true;
        state.bids.push({ player, bid: 'pass' });
        events.push({ type: 'playerPassed', player });

        const passCount = state.passed.filter(Boolean).length;
        if (passCount === 4) {
          // All passed without a bid: re-deal with next dealer
          events.push({ type: 'allPassed' });
          state.dealer = ((state.dealer + 1) % 4) as PlayerId;
          dealShelemHand(state, events);
          return { state, events };
        }

        if (passCount === 3 && state.highestBidder !== null) {
          // Auction complete!
          const hakem = state.highestBidder;
          state.hakem = hakem;
          state.targetBid = state.currentBid;
          // Hakem takes ground cards into hand
          state.hands[hakem]!.push(...state.ground);
          state.ground = [];
          state.phase = 'widow';
          state.currentActor = hakem;
          events.push({
            type: 'auctionWon',
            hakem,
            bid: state.targetBid,
          });
          return { state, events };
        }

        // Advance to next non-passed bidder
        state.currentActor = nextActiveBidder(player, state.passed);
        return { state, events };
      }

      if (action.type === 'bid') {
        const minBid = state.currentBid === 0 ? MIN_BID : state.currentBid + BID_STEP;
        if (action.amount < minBid || action.amount > MAX_BID || action.amount % BID_STEP !== 0) {
          return err('ERR_ILLEGAL_ACTION', `Bid must be between ${minBid} and ${MAX_BID} in increments of ${BID_STEP}.`);
        }
        state.currentBid = action.amount;
        state.highestBidder = player;
        state.bids.push({ player, bid: action.amount });
        events.push({ type: 'bidPlaced', player, amount: action.amount });

        if (action.amount === SHELEM_BID) {
          // Max bid reached! All other players automatically pass
          for (let p = 0; p < 4; p++) {
            if (p !== player) state.passed[p] = true;
          }
          state.hakem = player;
          state.targetBid = action.amount;
          state.hands[player]!.push(...state.ground);
          state.ground = [];
          state.phase = 'widow';
          state.currentActor = player;
          events.push({
            type: 'auctionWon',
            hakem: player,
            bid: action.amount,
          });
          return { state, events };
        }

        // Advance to next non-passed bidder
        state.currentActor = nextActiveBidder(player, state.passed);
        return { state, events };
      }

      return err('ERR_ILLEGAL_ACTION', 'Must bid or pass.');
    }

    if (state.phase === 'widow') {
      if (player !== state.hakem) {
        return err('ERR_NOT_YOUR_TURN', 'Only the Hakem may manage the widow.');
      }

      if (action.type === 'chooseTrump') {
        if (![0, 1, 2, 3].includes(action.suit)) return err('ERR_ILLEGAL_ACTION', 'Invalid suit.');
        state.trump = action.suit;
        events.push({ type: 'trumpChosen', player, suit: action.suit });

        if (state.buriedGround.length === 4) {
          // Both chosen: start tricks!
          state.phase = 'trick';
          state.leader = state.hakem;
          state.currentActor = state.hakem;
        }
        return { state, events };
      }

      if (action.type === 'discardGround') {
        if (!Array.isArray(action.cards) || action.cards.length !== 4) {
          return err('ERR_ILLEGAL_ACTION', 'Must discard exactly 4 cards to the ground.');
        }
        const hand = state.hands[player]!;
        for (const c of action.cards) {
          if (!hand.includes(c)) {
            return err('ERR_ILLEGAL_ACTION', 'Discarded card is not in your hand.');
          }
        }
        const unique = new Set(action.cards);
        if (unique.size !== 4) return err('ERR_ILLEGAL_ACTION', 'Duplicate discarded cards.');

        state.hands[player] = hand.filter((c) => !unique.has(c));
        state.buriedGround = [...action.cards];
        events.push({ type: 'groundBuried', player, count: 4 });

        if (state.trump !== null) {
          state.phase = 'trick';
          state.leader = state.hakem;
          state.currentActor = state.hakem;
        }
        return { state, events };
      }

      if (action.type === 'declareAndDiscard') {
        if (![0, 1, 2, 3].includes(action.suit)) return err('ERR_ILLEGAL_ACTION', 'Invalid suit.');
        if (!Array.isArray(action.cards) || action.cards.length !== 4) {
          return err('ERR_ILLEGAL_ACTION', 'Must discard exactly 4 cards to the ground.');
        }
        const hand = state.hands[player]!;
        for (const c of action.cards) {
          if (!hand.includes(c)) {
            return err('ERR_ILLEGAL_ACTION', 'Discarded card is not in your hand.');
          }
        }
        const unique = new Set(action.cards);
        if (unique.size !== 4) return err('ERR_ILLEGAL_ACTION', 'Duplicate discarded cards.');

        state.trump = action.suit;
        events.push({ type: 'trumpChosen', player, suit: action.suit });

        state.hands[player] = hand.filter((c) => !unique.has(c));
        state.buriedGround = [...action.cards];
        events.push({ type: 'groundBuried', player, count: 4 });

        state.phase = 'trick';
        state.leader = state.hakem;
        state.currentActor = state.hakem;
        return { state, events };
      }

      return err('ERR_ILLEGAL_ACTION', 'Expected chooseTrump or discardGround.');
    }

    if (state.phase === 'trick') {
      if (action.type !== 'play') return err('ERR_ILLEGAL_ACTION', 'Action must be play.');
      const hand = state.hands[player]!;
      if (!hand.includes(action.card)) return err('ERR_ILLEGAL_ACTION', 'Card not in hand.');

      if (state.trick.length > 0) {
        const led = suitOf(state.trick[0]!.card);
        if (suitOf(action.card) !== led && hand.some((c) => suitOf(c) === led)) {
          return err('ERR_ILLEGAL_ACTION', 'You must follow suit.');
        }
      }

      state.hands[player] = hand.filter((c) => c !== action.card);
      state.trick.push({ player, card: action.card });
      events.push({ type: 'cardPlayed', player, card: action.card });

      if (state.trick.length === 4) {
        // Trick complete
        const winner = trickWinner(state.trick, state.trump!);
        const winSide = sideOf(winner);
        const pts = trickScore(state.trick.map((t) => t.card));

        state.tricksWon[winner]!++;
        state.handPoints[winSide] += pts;
        state.lastTrick = { cards: state.trick, winner };
        state.trick = [];
        state.leader = winner;
        state.currentActor = winner;

        events.push({
          type: 'trickWon',
          player: winner,
          side: winSide,
          points: pts,
          handPoints: [...state.handPoints],
        });

        // 12 tricks completed?
        if (state.hands.every((h) => h.length === 0)) {
          finishShelemHand(state, events);
        }
      } else {
        // Next player in trick
        state.currentActor = ((state.currentActor + 1) % 4) as PlayerId;
      }

      return { state, events };
    }

    return err('ERR_ILLEGAL_ACTION', 'Unknown action.');
  },

  view(state, viewer: Viewer): ShelemView {
    const me = viewer === 'spectator' ? null : viewer;
    const sortHand = (h: number[]) => [...h].sort((a, b) => a - b);
    return {
      numPlayers: 4,
      phase: state.phase,
      dealer: state.dealer,
      currentActor: state.currentActor,
      bids: state.bids,
      currentBid: state.currentBid,
      highestBidder: state.highestBidder,
      hakem: state.hakem,
      targetBid: state.targetBid,
      trump: state.trump,
      hand: me === null ? [] : sortHand(state.hands[me] ?? []),
      handCounts: state.hands.map((h) => h.length),
      groundCount: state.ground.length,
      buriedGroundCount: state.buriedGround.length,
      trick: state.trick,
      leader: state.leader,
      tricksWon: state.tricksWon,
      handPoints: state.handPoints,
      matchPoints: state.matchPoints,
      handNumber: state.handNumber,
      lastTrick: state.lastTrick,
      teams: true,
      eliminated: state.eliminated,
      winners: state.winners,
    };
  },

  getCurrentActors(state) {
    return state.phase === 'game_over' ? [] : [state.currentActor];
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

export const shelemSpec: GameSpec = {
  id: 'shelem',
  name: 'Shelem',
  tagline: 'شلم — 4-player Persian trick-taking with bidding, widow and 165 total points.',
  minPlayers: 4,
  maxPlayers: 4,
  engineVersion: 1,
  engine: shelemEngine as unknown as GameEngine,
};
