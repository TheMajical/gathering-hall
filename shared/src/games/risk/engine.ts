/**
 * Risk engine — classic World Domination, 3–6 players, per the approved spec:
 * random deal, batch-of-3 setup, escalating global trades (4,6,8,10,12,15,+5),
 * defender auto-rolls max dice, blitz, connected-path fortify, card handover
 * on elimination with forced mid-attack trades at 6+ cards.
 *
 * On conquest the mandatory move (= dice used) is applied automatically so
 * every territory always holds ≥1 army; the follow-up `moveArmies` action
 * moves EXTRA armies (0..max) before combat may continue.
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
import { isAdjacent, NUM_TERRITORIES, TERRITORIES } from './mapData.js';
import { cardTerritory, isValidSet, NUM_CARDS, tradeValue, validSetsFrom } from './rules/cards.js';
import { resolveBattle } from './rules/attack.js';
import { connectedOwned } from './rules/fortify.js';
import { reinforcementIncome, territoriesOwned } from './rules/reinforce.js';
import {
  INITIAL_ARMIES,
  type RiskAction,
  type RiskLegal,
  type RiskState,
  type RiskView,
} from './types.js';

const err = engineError;

function clone(state: RiskState): RiskState {
  return structuredClone(state);
}

function current(state: RiskState): PlayerId {
  return state.turnOrder[state.currentIdx]!;
}

function livingPlayers(state: RiskState): PlayerId[] {
  return state.eliminated.map((e, i) => (e ? -1 : i)).filter((i) => i >= 0);
}

function advanceToNextLiving(state: RiskState): void {
  do {
    state.currentIdx = (state.currentIdx + 1) % state.turnOrder.length;
  } while (state.eliminated[current(state)]);
}

function beginTurn(state: RiskState, events: GameEvent[]): void {
  const p = current(state);
  state.phase = 'reinforce';
  state.reinforcementsRemaining = reinforcementIncome(state.territories, p);
  state.conqueredThisTurn = false;
  state.pendingMove = null;
  events.push({ type: 'turnStarted', player: p, income: state.reinforcementsRemaining });
}

function drawCard(state: RiskState, player: PlayerId, events: GameEvent[]): void {
  if (state.deck.length === 0 && state.discard.length > 0) {
    const rng = new Rng(state.rngState);
    state.deck = rng.shuffle(state.discard);
    state.discard = [];
    state.rngState = rng.state;
  }
  const card = state.deck.pop();
  if (card !== undefined) {
    state.hands[player]!.push(card);
    events.push({ type: 'cardDrawn', player });
  }
}

function checkVictory(state: RiskState, events: GameEvent[]): void {
  const alive = livingPlayers(state);
  const ownsAll = alive.find((p) => territoriesOwned(state.territories, p).length === NUM_TERRITORIES);
  let winner: PlayerId | null = null;
  if (alive.length === 1) winner = alive[0]!;
  else if (ownsAll !== undefined) winner = ownsAll;
  if (winner !== null) {
    state.winner = winner;
    state.phase = 'game_over';
    events.push({ type: 'gameOver', player: winner });
  }
}

function applyTrade(
  state: RiskState,
  player: PlayerId,
  cards: [number, number, number],
  events: GameEvent[],
): EngineError | null {
  const hand = state.hands[player]!;
  if (!isValidSet(cards)) return err('ERR_ILLEGAL_ACTION', 'Not a valid card set.');
  if (!cards.every((c) => hand.includes(c))) return err('ERR_ILLEGAL_ACTION', 'You do not hold those cards.');
  const value = tradeValue(state.tradeCount);
  state.tradeCount++;
  state.hands[player] = hand.filter((c) => !cards.includes(c));
  state.discard.push(...cards);
  state.reinforcementsRemaining += value;
  events.push({ type: 'cardsTraded', player, value });
  // Territory bonus: first card in the set whose territory the trader owns → +2 armies there.
  for (const c of cards) {
    const tid = cardTerritory(c);
    if (tid !== null && state.territories[tid]!.owner === player) {
      state.territories[tid]!.armies += 2;
      events.push({ type: 'territoryBonus', player, territory: tid, armies: 2 });
      break;
    }
  }
  return null;
}

/** Setup: batch of `setupBatch` armies; advance to next player with armies left. */
function advanceSetup(state: RiskState, events: GameEvent[]): void {
  if (state.setupRemaining.every((r) => r === 0)) {
    // Setup complete — first turn begins with turnOrder[0].
    state.currentIdx = 0;
    beginTurn(state, events);
    return;
  }
  do {
    state.currentIdx = (state.currentIdx + 1) % state.turnOrder.length;
  } while (state.setupRemaining[current(state)] === 0);
  state.setupBatch = Math.min(3, state.setupRemaining[current(state)]!);
}

export const riskEngine: GameEngine<RiskState, RiskAction, RiskView, RiskLegal> = {
  setup({ numPlayers, seed }: SetupConfig): RiskState {
    const initial = INITIAL_ARMIES[numPlayers];
    if (!initial) throw new Error(`Risk supports 3-6 players, got ${numPlayers}`);
    const rng = new Rng(seed);
    const turnOrder = rng.shuffle(Array.from({ length: numPlayers }, (_, i) => i));
    // Random deal: shuffle all territories, hand out round-robin in turn order.
    const dealt = rng.shuffle(Array.from({ length: NUM_TERRITORIES }, (_, i) => i));
    const territories = Array.from({ length: NUM_TERRITORIES }, () => ({ owner: 0, armies: 1 }));
    const dealtCount = Array(numPlayers).fill(0);
    const ownedBy: number[][] = Array.from({ length: numPlayers }, () => []);
    dealt.forEach((tid, i) => {
      const owner = turnOrder[i % numPlayers]!;
      territories[tid] = { owner, armies: 1 };
      dealtCount[owner]++;
      ownedBy[owner]!.push(tid);
    });
    // ALL starting armies are auto-placed randomly — no setup phase at all.
    // The game opens directly on the first player's reinforce (their normal
    // turn income), which is where the real decisions start.
    for (let p = 0; p < numPlayers; p++) {
      let auto = initial - dealtCount[p];
      const mine = ownedBy[p]!;
      while (auto-- > 0) territories[mine[rng.int(mine.length)]!]!.armies++;
    }
    const setupRemaining = Array.from({ length: numPlayers }, () => 0);
    const deck = rng.shuffle(Array.from({ length: NUM_CARDS }, (_, i) => i));
    const state: RiskState = {
      rngState: rng.state,
      numPlayers,
      phase: 'reinforce',
      turnOrder,
      currentIdx: 0,
      territories,
      eliminated: Array(numPlayers).fill(false),
      winner: null,
      setupRemaining,
      setupBatch: 0,
      deck,
      discard: [],
      hands: Array.from({ length: numPlayers }, () => []),
      tradeCount: 0,
      reinforcementsRemaining: reinforcementIncome(territories, turnOrder[0]!),
      conqueredThisTurn: false,
      pendingMove: null,
    };
    return state;
    // NOTE: the 'setup' phase handling in reduce/getLegalActions is kept so
    // snapshots from older versions still resume correctly.
  },

  getLegalActions(state, player): RiskLegal[] {
    if (state.phase === 'game_over' || state.eliminated[player]) return [];
    const resign: RiskLegal = { type: 'resign' };
    if (player !== current(state)) return [resign];
    const owned = territoriesOwned(state.territories, player);
    const hand = state.hands[player]!;

    switch (state.phase) {
      case 'setup': {
        const remaining = Math.min(state.setupBatch, state.setupRemaining[player]!);
        return [{ type: 'place', territories: owned, remaining }, resign];
      }
      case 'reinforce': {
        if (hand.length >= 5) return [{ type: 'trade', sets: validSetsFrom(hand), forced: true }, resign];
        const legal: RiskLegal[] = [];
        if (state.reinforcementsRemaining > 0) {
          legal.push({ type: 'place', territories: owned, remaining: state.reinforcementsRemaining });
        }
        const sets = validSetsFrom(hand);
        if (sets.length > 0) legal.push({ type: 'trade', sets, forced: false });
        if (state.reinforcementsRemaining === 0) legal.push({ type: 'endReinforce' });
        legal.push(resign);
        return legal;
      }
      case 'attack': {
        if (hand.length >= 6) return [{ type: 'trade', sets: validSetsFrom(hand), forced: true }, resign];
        if (state.reinforcementsRemaining > 0) {
          return [{ type: 'place', territories: owned, remaining: state.reinforcementsRemaining }, resign];
        }
        const options: { from: number; to: number; maxDice: number }[] = [];
        for (const from of owned) {
          const armies = state.territories[from]!.armies;
          if (armies < 2) continue;
          for (const to of TERRITORIES[from]!.adjacent) {
            if (state.territories[to]!.owner !== player) {
              options.push({ from, to, maxDice: Math.min(3, armies - 1) });
            }
          }
        }
        const legal: RiskLegal[] = [];
        if (options.length > 0) legal.push({ type: 'attack', options });
        legal.push({ type: 'endAttack' }, resign);
        return legal;
      }
      case 'move_armies': {
        const pm = state.pendingMove!;
        const max = state.territories[pm.from]!.armies - 1;
        return [{ type: 'moveArmies', from: pm.from, to: pm.to, min: 0, max }, resign];
      }
      case 'fortify': {
        const options: { from: number; targets: number[]; max: number }[] = [];
        for (const from of owned) {
          const armies = state.territories[from]!.armies;
          if (armies < 2) continue;
          const targets = connectedOwned(state.territories, player, from);
          if (targets.length > 0) options.push({ from, targets, max: armies - 1 });
        }
        const legal: RiskLegal[] = [];
        if (options.length > 0) legal.push({ type: 'fortify', options });
        legal.push({ type: 'endTurn' }, resign);
        return legal;
      }
      default:
        return [];
    }
  },

  reduce(prev, action, player): ReduceResult<RiskState> | EngineError {
    if (prev.phase === 'game_over') return err('ERR_ILLEGAL_ACTION', 'Game is over.');
    if (prev.eliminated[player]) return err('ERR_ILLEGAL_ACTION', 'You are eliminated.');
    const state = clone(prev);
    const events: GameEvent[] = [];

    // --- resign: allowed from any living player at any time ---
    if (action.type === 'resign') {
      state.eliminated[player] = true;
      state.discard.push(...state.hands[player]!);
      state.hands[player] = [];
      events.push({ type: 'resigned', player });
      if (state.phase === 'setup') {
        state.setupRemaining[player] = 0;
        if (current(state) === player) {
          // hand the batch to the next player still placing
          advanceSetup(state, events);
        }
      } else if (current(state) === player) {
        state.pendingMove = null;
        state.reinforcementsRemaining = 0;
        advanceToNextLiving(state);
        beginTurn(state, events);
      }
      checkVictory(state, events);
      return { state, events };
    }

    if (player !== current(state)) return err('ERR_NOT_YOUR_TURN', 'Not your turn.');

    switch (action.type) {
      case 'place': {
        const { territoryId, count } = action;
        if (!Number.isInteger(territoryId) || !Number.isInteger(count) || count < 1) {
          return err('ERR_ILLEGAL_ACTION', 'Invalid placement.');
        }
        const terr = state.territories[territoryId];
        if (!terr || terr.owner !== player) return err('ERR_ILLEGAL_ACTION', 'You do not own that territory.');

        if (state.phase === 'setup') {
          const allowed = Math.min(state.setupBatch, state.setupRemaining[player]!);
          if (count > allowed) return err('ERR_ILLEGAL_ACTION', `You may place at most ${allowed} now.`);
          terr.armies += count;
          state.setupBatch -= count;
          state.setupRemaining[player]! -= count;
          events.push({ type: 'placed', player, territory: territoryId, count });
          if (state.setupBatch === 0 || state.setupRemaining[player] === 0) advanceSetup(state, events);
          return { state, events };
        }

        if (state.phase === 'reinforce' || state.phase === 'attack') {
          if (state.phase === 'reinforce' && state.hands[player]!.length >= 5) {
            return err('ERR_ILLEGAL_ACTION', 'You must trade cards first (5+ in hand).');
          }
          if (state.phase === 'attack' && state.hands[player]!.length >= 6) {
            return err('ERR_ILLEGAL_ACTION', 'You must trade cards first (6+ in hand).');
          }
          if (count > state.reinforcementsRemaining) {
            return err('ERR_ILLEGAL_ACTION', `Only ${state.reinforcementsRemaining} armies remaining.`);
          }
          terr.armies += count;
          state.reinforcementsRemaining -= count;
          events.push({ type: 'placed', player, territory: territoryId, count });
          return { state, events };
        }
        return err('ERR_ILLEGAL_ACTION', 'Cannot place armies now.');
      }

      case 'trade': {
        if (state.phase !== 'reinforce' && state.phase !== 'attack') {
          return err('ERR_ILLEGAL_ACTION', 'Cannot trade now.');
        }
        if (state.phase === 'attack' && state.hands[player]!.length < 6) {
          return err('ERR_ILLEGAL_ACTION', 'Mid-attack trades only when holding 6+ cards.');
        }
        const e = applyTrade(state, player, action.cards, events);
        if (e) return e;
        return { state, events };
      }

      case 'endReinforce': {
        if (state.phase !== 'reinforce') return err('ERR_ILLEGAL_ACTION', 'Not in reinforce phase.');
        if (state.hands[player]!.length >= 5) return err('ERR_ILLEGAL_ACTION', 'You must trade cards first.');
        if (state.reinforcementsRemaining > 0) {
          return err('ERR_ILLEGAL_ACTION', `Place your remaining ${state.reinforcementsRemaining} armies first.`);
        }
        state.phase = 'attack';
        events.push({ type: 'phase', phase: 'attack', player });
        return { state, events };
      }

      case 'attack': {
        if (state.phase !== 'attack') return err('ERR_ILLEGAL_ACTION', 'Not in attack phase.');
        if (state.pendingMove) return err('ERR_ILLEGAL_ACTION', 'Finish your army move first.');
        if (state.hands[player]!.length >= 6) return err('ERR_ILLEGAL_ACTION', 'You must trade cards first.');
        if (state.reinforcementsRemaining > 0) return err('ERR_ILLEGAL_ACTION', 'Place your armies first.');
        const { from, to, dice, blitz } = action;
        const src = state.territories[from];
        const dst = state.territories[to];
        if (!src || src.owner !== player) return err('ERR_ILLEGAL_ACTION', 'You do not own the attacking territory.');
        if (!dst || dst.owner === player) return err('ERR_ILLEGAL_ACTION', 'You cannot attack your own territory.');
        if (!isAdjacent(from, to)) return err('ERR_ILLEGAL_ACTION', 'Territories are not adjacent.');
        if (src.armies < 2) return err('ERR_ILLEGAL_ACTION', 'Need at least 2 armies to attack.');
        if (!Number.isInteger(dice) || dice < 1 || dice > Math.min(3, src.armies - 1)) {
          return err('ERR_ILLEGAL_ACTION', 'Invalid dice count.');
        }

        const rng = new Rng(state.rngState);
        const defender = dst.owner;
        let conquered = false;
        let finalDice = dice;
        // One roll, or blitz-loop with max dice until conquest or exhaustion.
        for (;;) {
          const useDice = blitz ? Math.min(3, src.armies - 1) : dice;
          finalDice = useDice;
          const roll = resolveBattle(rng, useDice, dst.armies);
          src.armies -= roll.attackerLosses;
          dst.armies -= roll.defenderLosses;
          events.push({
            type: 'diceRolled',
            player,
            from,
            to,
            attackerRolls: roll.attackerRolls,
            defenderRolls: roll.defenderRolls,
            attackerLosses: roll.attackerLosses,
            defenderLosses: roll.defenderLosses,
          });
          if (dst.armies === 0) {
            conquered = true;
            break;
          }
          if (!blitz || src.armies < 2) break;
        }
        state.rngState = rng.state;

        if (conquered) {
          state.conqueredThisTurn = true;
          dst.owner = player;
          // Mandatory move = dice used in the winning roll, applied automatically.
          const mandatory = Math.min(finalDice, src.armies - 1);
          src.armies -= mandatory;
          dst.armies = mandatory;
          events.push({ type: 'conquered', player, from, to, defender, moved: mandatory });

          // Elimination → cards hand over.
          if (territoriesOwned(state.territories, defender).length === 0) {
            state.eliminated[defender] = true;
            const cards = state.hands[defender]!;
            state.hands[defender] = [];
            state.hands[player]!.push(...cards);
            events.push({ type: 'eliminated', player: defender, by: player, cardsTaken: cards.length });
          }
          checkVictory(state, events);
          if (state.winner === null) {
            const extraMax = src.armies - 1;
            if (extraMax > 0) {
              state.phase = 'move_armies';
              state.pendingMove = { from, to, min: 0 };
            }
          }
        }
        return { state, events };
      }

      case 'moveArmies': {
        if (state.phase !== 'move_armies' || !state.pendingMove) {
          return err('ERR_ILLEGAL_ACTION', 'No army move pending.');
        }
        const { from, to } = state.pendingMove;
        const max = state.territories[from]!.armies - 1;
        const { count } = action;
        if (!Number.isInteger(count) || count < 0 || count > max) {
          return err('ERR_ILLEGAL_ACTION', `Move between 0 and ${max} armies.`);
        }
        state.territories[from]!.armies -= count;
        state.territories[to]!.armies += count;
        state.pendingMove = null;
        state.phase = 'attack';
        if (count > 0) events.push({ type: 'moved', player, from, to, count });
        return { state, events };
      }

      case 'endAttack': {
        if (state.phase !== 'attack') return err('ERR_ILLEGAL_ACTION', 'Not in attack phase.');
        if (state.pendingMove) return err('ERR_ILLEGAL_ACTION', 'Finish your army move first.');
        if (state.hands[player]!.length >= 6) return err('ERR_ILLEGAL_ACTION', 'You must trade cards first.');
        if (state.reinforcementsRemaining > 0) return err('ERR_ILLEGAL_ACTION', 'Place your armies first.');
        state.phase = 'fortify';
        events.push({ type: 'phase', phase: 'fortify', player });
        return { state, events };
      }

      case 'fortify': {
        if (state.phase !== 'fortify') return err('ERR_ILLEGAL_ACTION', 'Not in fortify phase.');
        const { from, to, count } = action;
        const src = state.territories[from];
        const dst = state.territories[to];
        if (!src || !dst || src.owner !== player || dst.owner !== player) {
          return err('ERR_ILLEGAL_ACTION', 'You must own both territories.');
        }
        if (!connectedOwned(state.territories, player, from).includes(to)) {
          return err('ERR_ILLEGAL_ACTION', 'Territories are not connected through your territories.');
        }
        if (!Number.isInteger(count) || count < 1 || count > src.armies - 1) {
          return err('ERR_ILLEGAL_ACTION', 'Invalid army count.');
        }
        src.armies -= count;
        dst.armies += count;
        events.push({ type: 'fortified', player, from, to, count });
        endTurn(state, player, events);
        return { state, events };
      }

      case 'endTurn': {
        if (state.phase !== 'fortify') return err('ERR_ILLEGAL_ACTION', 'Not in fortify phase.');
        endTurn(state, player, events);
        return { state, events };
      }

      default:
        return err('ERR_ILLEGAL_ACTION', 'Unknown action.');
    }
  },

  view(state, viewer: Viewer): RiskView {
    const hand = viewer === 'spectator' ? [] : (state.hands[viewer] ?? []);
    return {
      numPlayers: state.numPlayers,
      phase: state.phase,
      turnOrder: state.turnOrder,
      current: current(state),
      territories: state.territories,
      players: Array.from({ length: state.numPlayers }, (_, p) => {
        const owned = territoriesOwned(state.territories, p);
        return {
          playerId: p,
          territories: owned.length,
          armies: owned.reduce((sum, id) => sum + state.territories[id]!.armies, 0),
          cardCount: state.hands[p]!.length,
          eliminated: state.eliminated[p]!,
        };
      }),
      hand,
      deckCount: state.deck.length,
      tradeCount: state.tradeCount,
      nextTradeValue: tradeValue(state.tradeCount),
      reinforcementsRemaining: state.reinforcementsRemaining,
      conqueredThisTurn: state.conqueredThisTurn,
      pendingMove: state.pendingMove,
      setupRemaining: state.setupRemaining,
      setupBatch: state.setupBatch,
      winner: state.winner,
    };
  },

  getCurrentActors(state) {
    return state.phase === 'game_over' ? [] : [current(state)];
  },

  status(state): EngineStatus {
    return {
      phase: state.phase,
      terminal: state.phase === 'game_over',
      winners: state.winner === null ? [] : [state.winner],
      eliminated: state.eliminated.map((e, i) => (e ? i : -1)).filter((i) => i >= 0),
    };
  },
};

function endTurn(state: RiskState, player: PlayerId, events: GameEvent[]): void {
  if (state.conqueredThisTurn) drawCard(state, player, events);
  advanceToNextLiving(state);
  beginTurn(state, events);
}

export const riskSpec: GameSpec = {
  id: 'risk',
  name: 'Dominion', // Risk-style world conquest
  tagline: 'Conquer all 42 territories. Dice decide the battles.',
  minPlayers: 3,
  maxPlayers: 6,
  engineVersion: 1,
  engine: riskEngine as unknown as GameEngine,
};
