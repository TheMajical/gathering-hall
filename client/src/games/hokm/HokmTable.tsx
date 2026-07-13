import {
  RANK_LABELS,
  SUIT_NAMES,
  SUIT_SYMBOLS,
  rankOf,
  suitOf,
  type GameEvent,
  type HokmLegal,
  type HokmView,
  type Suit,
} from '@gamehub/shared';
import React from 'react';
import { useGame } from '../../api/socket.js';
import { playerColor } from '../colors.js';
import type { GameUI } from '../registry.js';

function Card({ card, onClick, disabled, small }: { card: number; onClick?: () => void; disabled?: boolean; small?: boolean }): React.JSX.Element {
  const label = `${RANK_LABELS[rankOf(card)]}${SUIT_SYMBOLS[suitOf(card)]}`;
  return (
    <button
      className={`hokm-card${small ? ' small' : ''}${onClick && !disabled ? ' playable' : ''}${disabled ? ' dim' : ''}`}
      onClick={onClick}
      disabled={disabled || !onClick}
      title={label}
    >
      <img src={`/cards/${card}.png`} alt={label} draggable={false} />
    </button>
  );
}

function CardBack({ count }: { count: number }): React.JSX.Element {
  return (
    <span className="hokm-back" title={`${count} cards`}>
      <img src="/cards/back.png" alt="" draggable={false} />
      <span className="hokm-back-count">{count}</span>
    </span>
  );
}

function Table({ extras }: { extras: React.ReactNode }): React.JSX.Element {
  const { room, game, you, sendAction } = useGame();
  const view = game?.view as HokmView | null;
  const legal = (game?.legalActions ?? []) as HokmLegal[];
  if (!room || !game || !view) return <></>;

  const myTurn = you !== null && game.currentActors.includes(you) && !game.status.terminal;
  const names = (p: number) => room.seats.find((s) => s.playerId === p)?.name ?? `P${p}`;
  const trumpL = legal.find((l): l is Extract<HokmLegal, { type: 'chooseTrump' }> => l.type === 'chooseTrump');
  const playL = legal.find((l): l is Extract<HokmLegal, { type: 'play' }> => l.type === 'play');
  const playable = new Set(playL?.cards ?? []);
  const iAmHakem = you === view.hakem;
  const partner = view.teams && you !== null ? (you + 2) % 4 : null;

  const sideLabel = (s: number): string =>
    view.teams ? `${names(s)} & ${names(s + 2)}` : names(s);

  const phaseLine = (): string => {
    if (game.status.terminal) return 'The match is decided.';
    if (view.phase === 'trump') {
      return iAmHakem ? 'You are the hakem — study your 5 cards and call trump!' : `${names(view.hakem)} is calling trump…`;
    }
    return myTurn ? (view.trick.length === 0 ? 'Your lead' : 'Your turn — play a card') : `${names(view.current)} is thinking…`;
  };

  return (
    <div className="game-layout">
      <div className="board-wrap hokm-felt">
        {/* opponents */}
        <div className="uno-opps">
          {room.seats
            .filter((s) => s.playerId !== you)
            .map((s) => {
              const active = view.current === s.playerId && !game.status.terminal;
              return (
                <div key={s.playerId} className={`uno-opp${active ? ' active' : ''}`}>
                  <span className="dot" style={{ background: playerColor(s.playerId), width: 10, height: 10, borderRadius: 5 }} />
                  <span>
                    {s.name}
                    {s.playerId === view.hakem && <span title="Hakem"> 👑</span>}
                    {s.playerId === partner && <span className="muted"> (partner)</span>}
                  </span>
                  <CardBack count={view.handCounts[s.playerId]!} />
                  <span title="tricks this hand">🃏{view.tricksWon[s.playerId]}</span>
                </div>
              );
            })}
        </div>

        {/* trump + current trick */}
        <div className="hokm-center">
          <div className="hokm-trump" title={view.trump === null ? 'Trump not chosen yet' : `Trump: ${SUIT_NAMES[view.trump]}`}>
            <span className="muted" style={{ fontSize: '0.7rem' }}>حکم</span>
            <span className={`hokm-trump-suit${view.trump !== null && view.trump <= 1 ? ' red' : ''}`}>
              {view.trump === null ? '?' : SUIT_SYMBOLS[view.trump]}
            </span>
          </div>
          <div className="hokm-trick">
            {view.trick.length === 0 && view.lastTrick && (
              <div className="hokm-lasttrick">
                {view.lastTrick.cards.map((t) => (
                  <div key={t.player} className={`hokm-played${t.player === view.lastTrick!.winner ? ' won' : ''}`}>
                    <Card card={t.card} small />
                    <span>{names(t.player)}</span>
                  </div>
                ))}
              </div>
            )}
            {view.trick.map((t) => (
              <div key={t.player} className="hokm-played">
                <Card card={t.card} />
                <span>{names(t.player)}</span>
              </div>
            ))}
            {view.trick.length === 0 && !view.lastTrick && view.phase === 'trick' && (
              <span className="muted" style={{ color: 'rgba(241,223,178,0.8)' }}>
                {names(view.leader)} leads…
              </span>
            )}
          </div>
        </div>

        {/* own hand — overlapping fan */}
        {you !== null && (
          <div className="hokm-hand">
            {view.hand.map((c) => (
              <Card
                key={c}
                card={c}
                disabled={!myTurn || !playable.has(c) || view.phase !== 'trick'}
                onClick={view.phase === 'trick' ? () => sendAction({ type: 'play', card: c }) : undefined}
              />
            ))}
            {view.hand.length === 0 && <span className="muted" style={{ color: 'rgba(241,223,178,0.8)' }}>—</span>}
          </div>
        )}
      </div>

      <div className="sidebar">
        <div className={`turn-banner${myTurn ? ' yours' : ''}`}>{phaseLine()}</div>

        {/* trump picker for the hakem */}
        {myTurn && trumpL && (
          <div className="panel" style={{ padding: 12, textAlign: 'center' }}>
            <strong className="display">Call trump</strong>
            <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
              {trumpL.suits.map((s: Suit) => (
                <button
                  key={s}
                  className="btn"
                  style={{ fontSize: '1.7rem', padding: '4px 16px', color: s <= 1 ? '#ffb3ab' : undefined }}
                  title={SUIT_NAMES[s]}
                  onClick={() => sendAction({ type: 'chooseTrump', suit: s })}
                >
                  {SUIT_SYMBOLS[s]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* scoreboard */}
        <div className="panel" style={{ padding: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong className="display">Hand {view.handNumber}</strong>
            <span className="muted">first to 7 points</span>
          </div>
          {view.points.map((pts, side) => {
            const tricks = view.sideTricks[side]!;
            const mine = you !== null && (view.teams ? you % 2 === side : you === side);
            return (
              <div key={side} className="row" style={{ padding: '3px 0' }}>
                <span style={{ width: 12, height: 12, borderRadius: 6, background: playerColor(view.teams ? side : side), display: 'inline-block' }} />
                <span>{sideLabel(side)}{mine && <span className="muted"> (you)</span>}</span>
                <span className="spacer" />
                <span title="tricks this hand">🃏 {tricks}/7</span>
                <strong title="match points">⭐ {pts}</strong>
              </div>
            );
          })}
        </div>

        {extras}
      </div>
    </div>
  );
}

export const HokmUI: GameUI = {
  Table,
  soundFor(e: GameEvent) {
    switch (e.type) {
      case 'cardPlayed':
        return 'card';
      case 'trickWon':
        return 'place';
      case 'trumpChosen':
        return 'turn';
      case 'handWon':
        return 'conquer';
      case 'gameOver':
        return 'victory';
      case 'resigned':
        return 'eliminated';
      default:
        return null;
    }
  },
  describeEvent(e: GameEvent, name): string | null {
    switch (e.type) {
      case 'handStarted':
        return `— Hand ${String(e.hand)}: ${name(e.hakem)} is the hakem —`;
      case 'trumpChosen':
        return `👑 ${name(e.player)} called ${SUIT_NAMES[e.suit as Suit]} ${SUIT_SYMBOLS[e.suit as Suit]} as trump`;
      case 'trickWon':
        return `🃏 ${name(e.player)} takes the trick`;
      case 'handWon': {
        const who = (e.players as number[]).map((p) => name(p)).join(' & ');
        const kind = e.hakemKot ? ' — HAKEM KOT! (+3)' : e.kot ? ' — kot! (+2)' : '';
        return `⭐ ${who} win the hand${kind}`;
      }
      case 'newHakem':
        return `👑 ${name(e.player)} is the new hakem`;
      case 'resigned':
        return `🏳 ${name(e.player)} forfeited the match`;
      case 'gameOver':
        return `🏆 ${(e.players as number[]).map((p) => name(p)).join(' & ')} win the match!`;
      default:
        return null;
    }
  },
};
