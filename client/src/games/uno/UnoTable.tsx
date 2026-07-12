import {
  UNO_COLOR_NAMES,
  unoCard,
  type GameEvent,
  type UnoColor,
  type UnoLegal,
  type UnoView,
} from '@gamehub/shared';
import React, { useState } from 'react';
import { useGame } from '../../api/socket.js';
import { playerColor } from '../colors.js';
import type { GameUI } from '../registry.js';

function glyph(id: number): string {
  const c = unoCard(id);
  switch (c.kind) {
    case 'number':
      return String(c.num);
    case 'skip':
      return '⊘';
    case 'reverse':
      return '⇄';
    case 'draw2':
      return '+2';
    case 'wild':
      return '★';
    case 'wild4':
      return '+4';
  }
}

function colorClass(id: number): string {
  const c = unoCard(id);
  return c.color === null ? 'cw' : `c${c.color}`;
}

export function cardLabel(id: number): string {
  const c = unoCard(id);
  const color = c.color === null ? '' : `${UNO_COLOR_NAMES[c.color]} `;
  switch (c.kind) {
    case 'number':
      return `${color}${c.num}`;
    case 'skip':
      return `${color}Skip`;
    case 'reverse':
      return `${color}Reverse`;
    case 'draw2':
      return `${color}+2`;
    case 'wild':
      return 'Wild';
    case 'wild4':
      return 'Wild +4';
  }
}

const COLOR_HEX = ['#c3423f', '#e0a80d', '#3a7d44', '#2c5aa8'];

function Table({ extras }: { extras: React.ReactNode }): React.JSX.Element {
  const { room, game, you, sendAction } = useGame();
  const [pendingWild, setPendingWild] = useState<number | null>(null);

  const view = game?.view as UnoView | null;
  const legal = (game?.legalActions ?? []) as UnoLegal[];
  if (!room || !game || !view) return <></>;

  const playDesc = legal.find((l): l is Extract<UnoLegal, { type: 'play' }> => l.type === 'play');
  const canDraw = legal.some((l) => l.type === 'draw');
  const canPass = legal.some((l) => l.type === 'pass');
  const playable = new Set(playDesc?.cards ?? []);
  const wildSet = new Set(playDesc?.wildCards ?? []);
  const myTurn = you !== null && game.currentActors.includes(you) && !game.status.terminal;
  const names = (p: number) => room.seats.find((s) => s.playerId === p)?.name ?? `P${p}`;

  const playCard = (card: number): void => {
    if (!myTurn || !playable.has(card)) return;
    if (wildSet.has(card)) setPendingWild(card);
    else sendAction({ type: 'play', card });
  };

  return (
    <div className="game-layout">
      <div className="board-wrap uno-felt">
        {/* opponents around the table */}
        <div className="uno-opps">
          {room.seats
            .filter((s) => s.playerId !== you)
            .map((s) => {
              const active = view.current === s.playerId && !game.status.terminal;
              const out = view.eliminated[s.playerId];
              return (
                <div key={s.playerId} className={`uno-opp${active ? ' active' : ''}`} style={out ? { opacity: 0.4 } : undefined}>
                  <span className="dot" style={{ background: playerColor(s.playerId), width: 10, height: 10, borderRadius: 5 }} />
                  <span style={out ? { textDecoration: 'line-through' } : undefined}>{s.name}</span>
                  <span className="uno-mini-card">{view.handCounts[s.playerId]}</span>
                  {view.handCounts[s.playerId] === 1 && !out && <strong className="uno-callout">UNO!</strong>}
                </div>
              );
            })}
        </div>

        {/* center: deck + discard */}
        <div className="uno-center">
          <button
            className={`uno-card uno-back${myTurn && canDraw ? ' playable' : ''}`}
            disabled={!myTurn || !canDraw}
            onClick={() => sendAction({ type: 'draw' })}
            title="Draw a card"
          >
            <span className="uno-glyph" style={{ fontSize: '1rem' }}>DRAW</span>
            <span className="uno-count">{view.deckCount}</span>
          </button>
          <div
            className={`uno-card ${colorClass(view.topCard)}`}
            style={{ boxShadow: `0 0 0 5px ${COLOR_HEX[view.activeColor]}, 0 8px 18px var(--shadow)` }}
            title={`Top: ${cardLabel(view.topCard)} — active color ${UNO_COLOR_NAMES[view.activeColor]}`}
          >
            <span className="uno-glyph">{glyph(view.topCard)}</span>
          </div>
          <div className="uno-direction" title="Play direction">{view.direction === 1 ? '⟳' : '⟲'}</div>
        </div>

        {/* own hand */}
        {you !== null && (
          <div className="uno-hand">
            {view.hand.map((c) => (
              <button
                key={c}
                className={
                  `uno-card ${colorClass(c)}` +
                  (myTurn && playable.has(c) ? ' playable' : ' dim') +
                  (view.drawnCard === c ? ' drawn' : '')
                }
                disabled={!myTurn || !playable.has(c)}
                onClick={() => playCard(c)}
                title={cardLabel(c)}
              >
                <span className="uno-glyph">{glyph(c)}</span>
              </button>
            ))}
            {view.hand.length === 0 && <span className="muted">No cards — you're out!</span>}
          </div>
        )}
      </div>

      <div className="sidebar">
        <div className={`turn-banner${myTurn ? ' yours' : ''}`}>
          {game.status.terminal
            ? 'Game over'
            : myTurn
              ? view.drawnCard !== null
                ? `You drew ${cardLabel(view.drawnCard)} — play it or pass`
                : 'Your turn'
              : `${names(view.current)} is playing…`}
        </div>

        {myTurn && canPass && (
          <button className="btn" onClick={() => sendAction({ type: 'pass' })}>
            Keep it & pass
          </button>
        )}

        {pendingWild !== null && myTurn && (
          <div className="panel" style={{ padding: 12, textAlign: 'center' }}>
            <strong className="display">Choose a color</strong>
            <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
              {([0, 1, 2, 3] as UnoColor[]).map((c) => (
                <button
                  key={c}
                  className="uno-color-btn"
                  style={{ background: COLOR_HEX[c] }}
                  title={UNO_COLOR_NAMES[c]}
                  onClick={() => {
                    sendAction({ type: 'play', card: pendingWild, color: c });
                    setPendingWild(null);
                  }}
                />
              ))}
              <button className="btn sm" onClick={() => setPendingWild(null)}>✕</button>
            </div>
          </div>
        )}

        <div className="panel" style={{ padding: 12 }}>
          {room.seats.map((s) => {
            const active = view.current === s.playerId && !game.status.terminal;
            return (
              <div key={s.playerId} className="row" style={{ padding: '3px 0', opacity: view.eliminated[s.playerId] ? 0.45 : 1 }}>
                <span style={{ width: 12, height: 12, borderRadius: 6, background: playerColor(s.playerId), display: 'inline-block' }} />
                <span>
                  {active ? <strong>{s.name}</strong> : s.name}
                  {s.playerId === you && <span className="muted"> (you)</span>}
                </span>
                <span className="spacer" />
                <span title="cards in hand">🂠 {view.handCounts[s.playerId]}</span>
              </div>
            );
          })}
        </div>

        {extras}
      </div>
    </div>
  );
}

export const UnoUI: GameUI = {
  Table,
  soundFor(e: GameEvent) {
    switch (e.type) {
      case 'played':
        return 'place';
      case 'drew':
        return 'card';
      case 'penalty':
        return 'attack';
      case 'uno':
        return 'turn';
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
      case 'played': {
        const card = Number(e.card);
        const c = unoCard(card);
        const chosen = c.color === null ? ` → ${UNO_COLOR_NAMES[e.color as UnoColor]}` : '';
        return `${name(e.player)} played ${cardLabel(card)}${chosen}`;
      }
      case 'drew':
        return `${name(e.player)} drew a card`;
      case 'penalty':
        return `💥 ${name(e.player)} draws ${String(e.count)}!`;
      case 'skipped':
        return `${name(e.player)} was skipped`;
      case 'reversed':
        return '⇄ Direction reversed';
      case 'uno':
        return `🚨 UNO! ${name(e.player)} has one card left`;
      case 'resigned':
        return `🏳 ${name(e.player)} left the game`;
      case 'gameOver':
        return `👑 ${name(e.player)} wins!`;
      default:
        return null;
    }
  },
};
