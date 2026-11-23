import {
  RANK_LABELS,
  SUIT_NAMES,
  SUIT_SYMBOLS,
  rankOf,
  suitOf,
  type GameEvent,
  type PokerLegal,
  type PokerView,
} from '@gamehub/shared';
import React, { useState } from 'react';
import { useGame } from '../../api/socket.js';
import { playerColor } from '../colors.js';
import type { GameUI } from '../registry.js';

function Card({
  card,
  small,
  highlight,
}: {
  card: number;
  small?: boolean;
  highlight?: boolean;
}): React.JSX.Element {
  const label = `${RANK_LABELS[rankOf(card)]}${SUIT_SYMBOLS[suitOf(card)]}`;
  return (
    <div
      className={`hokm-card${small ? ' small' : ''}`}
      style={
        highlight
          ? { outline: '3px solid var(--gold-bright)', transform: 'translateY(-4px)' }
          : undefined
      }
      title={label}
    >
      <img src={`/cards/${card}.png`} alt={label} draggable={false} />
    </div>
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
  const view = game?.view as PokerView | null;
  const legal = (game?.legalActions ?? []) as PokerLegal[];

  const [raiseAmount, setRaiseAmount] = useState<number>(0);

  if (!room || !game || !view) return <></>;

  const myTurn = you !== null && game.currentActors.includes(you) && !game.status.terminal;
  const names = (p: number) => room.seats.find((s) => s.playerId === p)?.name ?? `P${p}`;

  const foldL = legal.find((l): l is Extract<PokerLegal, { type: 'fold' }> => l.type === 'fold');
  const checkL = legal.find((l): l is Extract<PokerLegal, { type: 'check' }> => l.type === 'check');
  const callL = legal.find((l): l is Extract<PokerLegal, { type: 'call' }> => l.type === 'call');
  const raiseL = legal.find((l): l is Extract<PokerLegal, { type: 'raise' }> => l.type === 'raise');
  const allInL = legal.find((l): l is Extract<PokerLegal, { type: 'allIn' }> => l.type === 'allIn');
  const nextHandL = legal.find((l): l is Extract<PokerLegal, { type: 'nextHand' }> => l.type === 'nextHand');

  const currentRaiseVal =
    raiseAmount > 0 && raiseL
      ? Math.max(raiseL.min, Math.min(raiseL.max, raiseAmount))
      : raiseL?.min ?? 0;

  const phaseLine = (): string => {
    if (game.status.terminal) return 'The tournament is decided!';
    if (view.phase === 'showdown') return 'Showdown! Check results and advance to next hand.';
    if (myTurn) {
      if (checkL) return 'Your turn — Check or Bet';
      if (callL) return `Your turn — Call ${callL.amount} or Raise`;
      return 'Your turn to act';
    }
    return `${names(view.currentActor)} is thinking…`;
  };

  return (
    <div className="game-layout">
      <div className="board-wrap hokm-felt poker-felt">
        {/* Opponents Seats */}
        <div className="uno-opps" style={{ flexWrap: 'wrap', gap: 10 }}>
          {view.players
            .filter((p) => p.playerId !== you)
            .map((p) => {
              const s = room.seats.find((seat) => seat.playerId === p.playerId);
              const active = view.currentActor === p.playerId && view.phase === 'betting' && !game.status.terminal;
              const isDealer = p.playerId === view.dealer;

              return (
                <div
                  key={p.playerId}
                  className={`uno-opp${active ? ' active' : ''}`}
                  style={p.folded ? { opacity: 0.45 } : undefined}
                >
                  <span
                    className="dot"
                    style={{ background: playerColor(p.playerId), width: 10, height: 10, borderRadius: 5 }}
                  />
                  <span>
                    {s?.name ?? `P${p.playerId}`}
                    {isDealer && <span title="Dealer Button"> Ⓓ</span>}
                    {p.allIn && <span className="badge" style={{ fontSize: '0.7rem', color: '#ffb3ab' }}> ALL-IN</span>}
                    {p.eliminated && <span className="muted"> (out)</span>}
                  </span>

                  <div className="row" style={{ gap: 4, alignItems: 'center' }}>
                    {p.cards && p.cards.length > 0 ? (
                      <div className="row" style={{ gap: 4 }}>
                        {p.cards.map((c) => (
                          <Card key={c} card={c} small />
                        ))}
                      </div>
                    ) : p.cardCount > 0 ? (
                      <CardBack count={p.cardCount} />
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </div>

                  <span title="Chip stack" style={{ fontWeight: 'bold', color: 'var(--gold-bright)' }}>
                    🪙 {p.chips}
                  </span>

                  {p.currentBet > 0 && (
                    <span title="Current Bet" style={{ fontSize: '0.75rem', background: 'rgba(255,200,50,0.15)', padding: '1px 6px', borderRadius: 4 }}>
                      Bet: {p.currentBet}
                    </span>
                  )}
                </div>
              );
            })}
        </div>

        {/* Center Felt: Community Cards & Pot */}
        <div className="hokm-center" style={{ flexDirection: 'column', gap: 12, minHeight: 160 }}>
          {/* Pot display */}
          <div
            style={{
              background: 'rgba(0,0,0,0.6)',
              border: '1px solid var(--gold)',
              padding: '6px 18px',
              borderRadius: 20,
              fontSize: '1.2rem',
              fontWeight: 'bold',
              color: 'var(--gold-bright)',
              boxShadow: '0 4px 10px rgba(0,0,0,0.4)',
            }}
          >
            🪙 Pot: {view.pot}
          </div>

          {/* Community Cards */}
          <div className="row" style={{ gap: 8, minHeight: 80, alignItems: 'center', justifyContent: 'center' }}>
            {view.community.map((c) => (
              <Card key={c} card={c} />
            ))}
            {view.community.length === 0 && (
              <span className="muted" style={{ color: 'rgba(241,223,178,0.7)', fontSize: '0.95rem' }}>
                Pre-flop betting…
              </span>
            )}
          </div>

          {/* Showdown Result Banner */}
          {view.showdownWinners && view.showdownWinners.length > 0 && (
            <div
              className="panel"
              style={{
                padding: '8px 16px',
                background: 'rgba(20,40,20,0.9)',
                border: '1px solid var(--gold-bright)',
                textAlign: 'center',
              }}
            >
              {view.showdownWinners.map((w) => (
                <div key={w.player} style={{ color: 'var(--gold-bright)' }}>
                  🏆 <strong>{names(w.player)}</strong> won {w.wonChips} chips with {w.evaluation.label}!
                </div>
              ))}
            </div>
          )}
        </div>

        {/* You: Hole Cards & Stack */}
        {you !== null && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div className="row" style={{ gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: '1rem', fontWeight: 'bold' }}>
                Your Stack: <strong style={{ color: 'var(--gold-bright)' }}>🪙 {view.players[you]?.chips ?? 0}</strong>
              </span>
              {view.players[you]?.currentBet ? (
                <span style={{ fontSize: '0.85rem', color: 'var(--gold)' }}>
                  (Current bet: {view.players[you]?.currentBet})
                </span>
              ) : null}
              {view.myEvaluation && (
                <span
                  style={{
                    background: 'rgba(255,255,255,0.1)',
                    padding: '2px 10px',
                    borderRadius: 12,
                    fontSize: '0.85rem',
                    color: 'var(--gold-bright)',
                  }}
                >
                  {view.myEvaluation.label}
                </span>
              )}
            </div>

            <div className="row" style={{ gap: 8 }}>
              {view.hand.map((c) => (
                <Card key={c} card={c} />
              ))}
              {view.hand.length === 0 && <span className="muted">—</span>}
            </div>
          </div>
        )}
      </div>

      {/* Sidebar Controls & Event Log */}
      <div className="sidebar">
        <div className={`turn-banner${myTurn ? ' yours' : ''}`}>{phaseLine()}</div>

        {/* Action Controls */}
        {myTurn && view.phase === 'betting' && (
          <div className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <strong className="display">Actions</strong>

            <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
              {foldL && (
                <button
                  className="btn btn-secondary"
                  style={{ minWidth: 80 }}
                  onClick={() => sendAction({ type: 'fold' })}
                >
                  Fold (فولد)
                </button>
              )}

              {checkL && (
                <button
                  className="btn btn-primary"
                  style={{ minWidth: 80 }}
                  onClick={() => sendAction({ type: 'check' })}
                >
                  Check (چک)
                </button>
              )}

              {callL && (
                <button
                  className="btn btn-primary"
                  style={{ minWidth: 100 }}
                  onClick={() => sendAction({ type: 'call' })}
                >
                  Call {callL.amount}
                </button>
              )}
            </div>

            {/* Raise Controls */}
            {raiseL && (
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="row" style={{ justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <span>Raise to: <strong>{currentRaiseVal}</strong></span>
                  <span className="muted">Min: {raiseL.min} | Max: {raiseL.max}</span>
                </div>

                <input
                  type="range"
                  min={raiseL.min}
                  max={raiseL.max}
                  step={10}
                  value={currentRaiseVal}
                  onChange={(e) => setRaiseAmount(Number(e.target.value))}
                  style={{ width: '100%' }}
                />

                <div className="row" style={{ gap: 4, justifyContent: 'center' }}>
                  <button
                    className="btn"
                    style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                    onClick={() => setRaiseAmount(raiseL.min)}
                  >
                    Min
                  </button>
                  <button
                    className="btn"
                    style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                    onClick={() => setRaiseAmount(Math.min(raiseL.max, Math.floor(view.pot / 2) + view.currentBet))}
                  >
                    1/2 Pot
                  </button>
                  <button
                    className="btn"
                    style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                    onClick={() => setRaiseAmount(Math.min(raiseL.max, view.pot + view.currentBet))}
                  >
                    Pot
                  </button>
                  {allInL && (
                    <button
                      className="btn"
                      style={{ fontSize: '0.75rem', padding: '2px 8px', color: '#ffb3ab' }}
                      onClick={() => setRaiseAmount(raiseL.max)}
                    >
                      All-in
                    </button>
                  )}
                </div>

                <button
                  className="btn btn-primary"
                  onClick={() => sendAction({ type: 'raise', amount: currentRaiseVal })}
                >
                  Raise to {currentRaiseVal}
                </button>
              </div>
            )}

            {allInL && !raiseL && (
              <button
                className="btn btn-primary"
                style={{ background: '#b3271d', borderColor: '#ffb3ab' }}
                onClick={() => sendAction({ type: 'allIn' })}
              >
                All-in ({allInL.amount})
              </button>
            )}
          </div>
        )}

        {/* Showdown Advance */}
        {view.phase === 'showdown' && (
          <div className="panel" style={{ padding: 12, textAlign: 'center' }}>
            <button
              className="btn btn-primary"
              style={{ width: '100%', fontSize: '1.05rem', padding: '8px 16px' }}
              onClick={() => sendAction({ type: 'nextHand' })}
            >
              Next Hand ➔
            </button>
          </div>
        )}

        {/* Chip Leaderboard */}
        <div className="panel" style={{ padding: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <strong className="display">Hand {view.handNumber}</strong>
            <span className="muted">Street: {view.street.toUpperCase()}</span>
          </div>

          {view.players.map((p) => {
            const isMe = you === p.playerId;
            return (
              <div key={p.playerId} className="row" style={{ padding: '3px 0' }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    background: playerColor(p.playerId),
                    display: 'inline-block',
                  }}
                />
                <span>
                  {names(p.playerId)}
                  {isMe && <span className="muted"> (you)</span>}
                  {p.folded && <span className="muted"> (folded)</span>}
                  {p.eliminated && <span className="muted"> (out)</span>}
                </span>
                <span className="spacer" />
                <strong style={{ color: p.chips > 0 ? 'var(--gold)' : 'var(--text-dim)' }}>
                  🪙 {p.chips}
                </strong>
              </div>
            );
          })}
        </div>

        {extras}
      </div>
    </div>
  );
}

export const PokerUI: GameUI = {
  Table,
  soundFor(e: GameEvent) {
    switch (e.type) {
      case 'handStarted':
      case 'streetDealt':
        return 'card';
      case 'playerCalled':
      case 'playerRaised':
      case 'playerAllIn':
        return 'trade';
      case 'showdown':
      case 'potWonFold':
        return 'conquer';
      case 'gameOver':
        return 'victory';
      case 'playerEliminated':
      case 'resigned':
        return 'eliminated';
      default:
        return null;
    }
  },
  describeEvent(e: GameEvent, name): string | null {
    switch (e.type) {
      case 'handStarted':
        return `— Hand ${String(e.hand)}: Dealer is ${name(e.dealer)} —`;
      case 'playerFolded':
        return `— ${name(e.player)} folded`;
      case 'playerChecked':
        return `— ${name(e.player)} checked`;
      case 'playerCalled':
        return `🪙 ${name(e.player)} called ${String(e.amount)}`;
      case 'playerRaised':
        return `🚀 ${name(e.player)} raised to ${String(e.amount)}`;
      case 'playerAllIn':
        return `🔥 ${name(e.player)} went ALL-IN for ${String(e.amount)}!`;
      case 'streetDealt':
        return `🃏 ${String(e.street).toUpperCase()} dealt`;
      case 'potWonFold':
        return `🏆 ${name(e.player)} won ${String(e.amount)} chips (everyone else folded)`;
      case 'showdown': {
        const lines = (e.winners as Array<{ player: number; label: string; wonChips: number }>).map(
          (w) => `🏆 ${name(w.player)} won ${String(w.wonChips)} chips with ${w.label}!`,
        );
        return lines.join('; ');
      }
      case 'playerEliminated':
        return `💀 ${name(e.player)} was eliminated!`;
      case 'gameOver': {
        const winner = (e.winners as number[]).map((p) => name(p)).join(', ');
        return `👑 ${winner} won the tournament!`;
      }
      case 'resigned':
        return `🏳 ${name(e.player)} forfeited the match`;
      default:
        return null;
    }
  },
};
