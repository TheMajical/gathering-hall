import type { GameEvent, OthelloLegal, OthelloView } from '@gamehub/shared';
import React from 'react';
import { useGame } from '../../api/socket.js';
import { playerColor } from '../colors.js';
import type { GameUI } from '../registry.js';

function Table({ extras }: { extras: React.ReactNode }): React.JSX.Element {
  const { room, game, you, sendAction } = useGame();
  const view = game?.view as OthelloView | null;
  const legal = (game?.legalActions ?? []) as OthelloLegal[];
  if (!room || !game || !view) return <></>;

  const myTurn = you !== null && game.currentActors.includes(you) && !game.status.terminal;
  const names = (p: number) => room.seats.find((s) => s.playerId === p)?.name ?? `P${p}`;
  const placeL = legal.find((l): l is Extract<OthelloLegal, { type: 'place' }> => l.type === 'place');
  const legalSet = new Set(myTurn ? placeL?.cells ?? [] : []);
  const discClass = (seat: number) => (seat === view.blackSeat ? 'black' : 'white');

  const phaseLine = (): string => {
    if (game.status.terminal) {
      return view.drawn ? 'A perfect draw!' : 'The board is settled.';
    }
    return myTurn ? 'Your move — flank and flip' : `${names(view.current)} is thinking…`;
  };

  return (
    <div className="game-layout">
      <div className="board-wrap" style={{ padding: 16 }}>
        <div className="othello-board">
          {view.board.map((v, cell) => {
            const canPlay = legalSet.has(cell);
            return (
              <div
                key={cell}
                className={`othello-sq${view.lastMove === cell ? ' last' : ''}`}
                onClick={() => canPlay && sendAction({ type: 'place', cell })}
                style={{ cursor: canPlay ? 'pointer' : 'default' }}
                role="button"
                aria-label={`square ${cell}`}
              >
                {v !== null && <span className={`othello-disc ${discClass(v)}`} />}
                {canPlay && <span className={`othello-hint ${discClass(you!)}`} />}
              </div>
            );
          })}
        </div>
      </div>

      <div className="sidebar">
        <div className={`turn-banner${myTurn ? ' yours' : ''}`}>{phaseLine()}</div>

        <div className="panel" style={{ padding: 12 }}>
          {[view.blackSeat, 1 - view.blackSeat].map((seat) => {
            const active = view.current === seat && !game.status.terminal;
            return (
              <div key={seat} className="row" style={{ padding: '4px 0' }}>
                <span className={`othello-disc small ${discClass(seat)}`} />
                <span style={{ color: playerColor(seat) }}>
                  {active ? <strong>{names(seat)}</strong> : names(seat)}
                  {seat === you && <span className="muted"> (you)</span>}
                </span>
                <span className="spacer" />
                <strong style={{ fontSize: '1.2rem' }}>{view.counts[seat]}</strong>
              </div>
            );
          })}
          <div className="muted" style={{ marginTop: 6, fontSize: '0.85rem' }}>
            {64 - view.counts[0] - view.counts[1]} squares left
          </div>
        </div>

        {extras}
      </div>
    </div>
  );
}

export const OthelloUI: GameUI = {
  Table,
  soundFor(e: GameEvent) {
    switch (e.type) {
      case 'placed':
        return (e.flipped as number) >= 4 ? 'attack' : 'place';
      case 'passed':
        return 'turn';
      case 'gameOver':
        return e.draw ? 'card' : 'victory';
      case 'resigned':
        return 'eliminated';
      default:
        return null;
    }
  },
  describeEvent(e: GameEvent, name): string | null {
    switch (e.type) {
      case 'placed': {
        const cell = e.cell as number;
        const coord = `${'abcdefgh'[cell % 8]}${Math.floor(cell / 8) + 1}`;
        return `${name(e.player)} played ${coord}, flipping ${String(e.flipped)}`;
      }
      case 'passed':
        return `${name(e.player)} has no move — passed`;
      case 'gameOver': {
        const [a, b] = e.counts as [number, number];
        return e.draw ? `½–½ Draw at ${a}–${b}` : `👑 ${name(e.player)} wins ${Math.max(a, b)}–${Math.min(a, b)}!`;
      }
      case 'resigned':
        return `🏳 ${name(e.player)} resigned`;
      default:
        return null;
    }
  },
};
