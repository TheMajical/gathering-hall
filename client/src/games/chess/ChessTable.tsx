import type { ChessLegal, ChessMoveInput, ChessView, GameEvent } from '@gamehub/shared';
import React, { useMemo, useRef, useState } from 'react';
import { useGame } from '../../api/socket.js';
import { playerColor } from '../colors.js';
import type { GameUI } from '../registry.js';

// Solid glyph forms for BOTH colors — actual color comes from CSS
// (.chess-piece.w / .b), which renders consistently across platforms.
const SOLID: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const FILES = 'abcdefgh';

function Piece({ code, className = '' }: { code: string; className?: string }): React.JSX.Element {
  return <span className={`chess-piece ${code[0]} ${className}`}>{SOLID[code[1]!]}</span>;
}

interface Sq {
  id: string; // e.g. "e4"
  piece: string | null; // "wq", "bp", …
  dark: boolean;
}

function parseFen(fen: string): Sq[][] {
  const rows = fen.split(' ')[0]!.split('/');
  return rows.map((row, r) => {
    const out: Sq[] = [];
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < Number(ch); i++, f++) {
          out.push({ id: `${FILES[f]}${8 - r}`, piece: null, dark: (r + f) % 2 === 1 });
        }
      } else {
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        out.push({ id: `${FILES[f]}${8 - r}`, piece: color + ch.toLowerCase(), dark: (r + f) % 2 === 1 });
        f++;
      }
    }
    return out;
  });
}

function Table({ extras }: { extras: React.ReactNode }): React.JSX.Element {
  const { room, game, you, sendAction } = useGame();
  const [sel, setSel] = useState<string | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);
  const [drag, setDrag] = useState<{ from: string; piece: string; x: number; y: number } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const view = game?.view as ChessView | null;
  const legal = (game?.legalActions ?? []) as ChessLegal[];
  const moves: ChessMoveInput[] = useMemo(
    () => legal.filter((l): l is Extract<ChessLegal, { type: 'move' }> => l.type === 'move').flatMap((l) => l.moves),
    [legal],
  );

  const board = useMemo(() => (view ? parseFen(view.fen) : []), [view]);
  if (!room || !game || !view) return <></>;

  const myTurn = you !== null && game.currentActors.includes(you) && !game.status.terminal;
  const iAmBlack = you !== null && you === 1 - view.whiteSeat;
  const rows = iAmBlack ? [...board].reverse().map((r) => [...r].reverse()) : board;
  const targetsOf = (from: string) => new Set(moves.filter((m) => m.from === from).map((m) => m.to));
  const sources = new Set(moves.map((m) => m.from));
  const targets = sel ? targetsOf(sel) : new Set<string>();
  const myColor = you === view.whiteSeat ? 'w' : 'b';
  const checkedKing = view.inCheck
    ? board.flat().find((s) => s.piece === (view.turnSeat === view.whiteSeat ? 'wk' : 'bk'))?.id
    : undefined;

  const tryMove = (from: string, to: string): void => {
    const variants = moves.filter((m) => m.from === from && m.to === to);
    if (variants.length === 0) return;
    if (variants.length > 1) {
      setPromo({ from, to }); // promotion — pick the piece
    } else {
      sendAction({ type: 'move', ...variants[0]! });
      setSel(null);
    }
  };

  /** Map a pointer position to a square id, respecting board orientation. */
  const squareAt = (clientX: number, clientY: number): string | null => {
    const el = boardRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const fx = Math.floor(((clientX - r.left) / r.width) * 8);
    const fy = Math.floor(((clientY - r.top) / r.height) * 8);
    if (fx < 0 || fx > 7 || fy < 0 || fy > 7) return null;
    const file = iAmBlack ? 7 - fx : fx;
    const rank = iAmBlack ? fy + 1 : 8 - fy;
    return `${FILES[file]}${rank}`;
  };

  const onSquareDown = (sq: Sq, e: React.PointerEvent): void => {
    if (!myTurn) return;
    e.preventDefault();
    // click-to-move: a target square completes the pending selection
    if (sel && sel !== sq.id && targets.has(sq.id)) {
      tryMove(sel, sq.id);
      return;
    }
    if (sq.piece?.startsWith(myColor) && sources.has(sq.id)) {
      setSel(sq.id);
      setDrag({ from: sq.id, piece: sq.piece, x: e.clientX, y: e.clientY });
      boardRef.current?.setPointerCapture(e.pointerId);
    } else {
      setSel(null);
    }
  };

  const onBoardMove = (e: React.PointerEvent): void => {
    if (drag) setDrag({ ...drag, x: e.clientX, y: e.clientY });
  };

  const onBoardUp = (e: React.PointerEvent): void => {
    if (!drag) return;
    const to = squareAt(e.clientX, e.clientY);
    if (to && to !== drag.from && targetsOf(drag.from).has(to)) {
      tryMove(drag.from, to);
    }
    // dropped on origin / illegal square → piece stays selected for click-move
    setDrag(null);
  };

  const names = (p: number) => room.seats.find((s) => s.playerId === p)?.name ?? `P${p}`;
  const turnName = names(view.turnSeat);

  return (
    <div className="game-layout">
      <div className="board-wrap" style={{ padding: 14 }}>
        <div
          ref={boardRef}
          className="chess-board"
          onPointerMove={onBoardMove}
          onPointerUp={onBoardUp}
          onPointerCancel={() => setDrag(null)}
        >
          {rows.flat().map((sq) => {
            const isSel = sel === sq.id;
            const isTarget = targets.has(sq.id);
            const isLast = view.lastMove?.from === sq.id || view.lastMove?.to === sq.id;
            const isCheck = checkedKing === sq.id;
            const grabbable = myTurn && sq.piece?.startsWith(myColor) && sources.has(sq.id);
            return (
              <div
                key={sq.id}
                className={
                  `chess-sq ${sq.dark ? 'dark' : 'light'}` +
                  (isSel ? ' sel' : '') +
                  (isLast ? ' last' : '') +
                  (isCheck ? ' check' : '') +
                  (grabbable ? ' grabbable' : '')
                }
                onPointerDown={(e) => onSquareDown(sq, e)}
                role="button"
                aria-label={sq.id}
              >
                {sq.piece && <Piece code={sq.piece} className={drag?.from === sq.id ? 'ghost' : ''} />}
                {isTarget && <span className={sq.piece ? 'chess-capture-ring' : 'chess-dot'} />}
              </div>
            );
          })}
        </div>
        {drag && (
          <div className="chess-drag" style={{ left: drag.x, top: drag.y }}>
            <Piece code={drag.piece} />
          </div>
        )}
      </div>

      <div className="sidebar">
        <div className={`turn-banner${myTurn ? ' yours' : ''}`}>
          {game.status.terminal
            ? view.drawn
              ? `½–½ Draw — ${view.drawReason}`
              : 'Checkmate!'
            : myTurn
              ? view.inCheck
                ? 'Your move — you are in CHECK!'
                : 'Your move'
              : `${turnName} is thinking…`}
        </div>

        {promo && myTurn && (
          <div className="panel" style={{ padding: 12, textAlign: 'center' }}>
            <strong className="display">Promote to:</strong>
            <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
              {(['q', 'r', 'b', 'n'] as const).map((p) => (
                <button
                  key={p}
                  className="btn"
                  style={{ fontSize: '1.6rem', padding: '4px 14px' }}
                  onClick={() => {
                    sendAction({ type: 'move', from: promo.from, to: promo.to, promotion: p });
                    setPromo(null);
                    setSel(null);
                  }}
                >
                  <Piece code={myColor + p} />
                </button>
              ))}
              <button className="btn sm" onClick={() => setPromo(null)}>✕</button>
            </div>
          </div>
        )}

        <div className="panel" style={{ padding: 12 }}>
          {[view.whiteSeat, 1 - view.whiteSeat].map((seat) => (
            <div key={seat} className="row" style={{ padding: '3px 0' }}>
              <span style={{ width: 12, height: 12, borderRadius: 6, background: playerColor(seat), display: 'inline-block' }} />
              <span>
                {seat === view.whiteSeat ? '⚪' : '⚫'} {names(seat)}
                {seat === you && <span className="muted"> (you)</span>}
              </span>
              <span className="spacer" />
              <span className="chess-captured">
                {view.captured[seat]!.map((p, i) => (
                  <Piece key={i} code={(seat === view.whiteSeat ? 'b' : 'w') + p} />
                ))}
              </span>
            </div>
          ))}
        </div>

        {view.san.length > 0 && (
          <div className="panel" style={{ padding: 12 }}>
            <strong className="display">Moves</strong>
            <div className="chess-history">
              {view.san.map((m, i) =>
                i % 2 === 0 ? (
                  <span key={i} className="chess-move">
                    <span className="muted">{i / 2 + 1}.</span> {m}
                  </span>
                ) : (
                  <span key={i} className="chess-move">{m}</span>
                ),
              )}
            </div>
          </div>
        )}

        {extras}
      </div>
    </div>
  );
}

export const ChessUI: GameUI = {
  Table,
  soundFor(e: GameEvent) {
    switch (e.type) {
      case 'moved':
        return e.capture ? 'attack' : 'place';
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
      case 'moved':
        return `${name(e.player)}: ${String(e.san)}${e.check ? ' — check!' : ''}`;
      case 'gameOver':
        return e.draw ? `½–½ Draw (${String(e.reason)})` : `👑 ${name(e.player)} wins by checkmate!`;
      case 'resigned':
        return `🏳 ${name(e.player)} resigned`;
      default:
        return null;
    }
  },
};
