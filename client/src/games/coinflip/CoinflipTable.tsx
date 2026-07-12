import type { CoinflipView, GameEvent } from '@gamehub/shared';
import React from 'react';
import { useGame } from '../../api/socket.js';
import { playerColor } from '../colors.js';
import type { GameUI } from '../registry.js';

function Table({ extras }: { extras: React.ReactNode }): React.JSX.Element {
  const { room, game, you, sendAction } = useGame();
  if (!room || !game || !game.view) return <></>;
  const view = game.view as CoinflipView;
  const myTurn = you !== null && game.currentActors.includes(you) && !game.status.terminal;
  const currentName = room.seats.find((s) => s.playerId === view.current)?.name ?? '…';

  return (
    <div className="game-layout">
      <div className="board-wrap" style={{ flexDirection: 'column', gap: 20, padding: 30 }}>
        <div style={{ fontSize: '5rem' }}>&#129689;</div>
        <div className="turn-banner" style={{ minWidth: 260 }}>
          {game.status.terminal ? 'Game over' : myTurn ? 'Your call!' : `${currentName} is calling…`}
        </div>
        {myTurn && (
          <div className="row">
            <button className="btn big primary" onClick={() => sendAction({ type: 'call', side: 'heads' })}>
              Heads
            </button>
            <button className="btn big" onClick={() => sendAction({ type: 'call', side: 'tails' })}>
              Tails
            </button>
          </div>
        )}
      </div>
      <div className="sidebar">
        <div className="panel">
          <h3 className="panel-title">First to {view.target}</h3>
          {room.seats.map((s) => (
            <div key={s.playerId} className="row" style={{ padding: '4px 0' }}>
              <span className="dot" style={{ width: 12, height: 12, borderRadius: 6, background: playerColor(s.playerId), display: 'inline-block' }} />
              <span style={view.resigned[s.playerId] ? { textDecoration: 'line-through' } : undefined}>{s.name}</span>
              <span className="spacer" />
              <strong>{view.scores[s.playerId] ?? 0}</strong>
            </div>
          ))}
        </div>
        {extras}
      </div>
    </div>
  );
}

export const CoinflipUI: GameUI = {
  Table,
  soundFor(e: GameEvent) {
    switch (e.type) {
      case 'flipped':
        return 'dice';
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
      case 'flipped':
        return `${name(e.player)} called ${String(e.call)} — it was ${String(e.side)} ${e.hit ? '✓' : '✗'}`;
      case 'resigned':
        return `${name(e.player)} resigned.`;
      case 'gameOver':
        return `👑 ${name(e.player)} wins!`;
      default:
        return null;
    }
  },
};
