import {
  RANK_LABELS,
  SUIT_NAMES,
  SUIT_SYMBOLS,
  rankOf,
  suitOf,
  type GameEvent,
  type ShelemLegal,
  type ShelemView,
  type Suit,
} from '@gamehub/shared';
import React, { useState } from 'react';
import { useGame } from '../../api/socket.js';
import { playerColor } from '../colors.js';
import type { GameUI } from '../registry.js';

function Card({
  card,
  onClick,
  disabled,
  selected,
  small,
}: {
  card: number;
  onClick?: () => void;
  disabled?: boolean;
  selected?: boolean;
  small?: boolean;
}): React.JSX.Element {
  const label = `${RANK_LABELS[rankOf(card)]}${SUIT_SYMBOLS[suitOf(card)]}`;
  return (
    <button
      className={`hokm-card${small ? ' small' : ''}${onClick && !disabled ? ' playable' : ''}${disabled ? ' dim' : ''}${selected ? ' selected' : ''}`}
      onClick={onClick}
      disabled={disabled || !onClick}
      title={label}
      style={selected ? { transform: 'translateY(-14px)', outline: '3px solid var(--gold-bright)' } : undefined}
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
  const view = game?.view as ShelemView | null;
  const legal = (game?.legalActions ?? []) as ShelemLegal[];
  const [selectedDiscards, setSelectedDiscards] = useState<number[]>([]);

  if (!room || !game || !view) return <></>;

  const myTurn = you !== null && game.currentActors.includes(you) && !game.status.terminal;
  const names = (p: number) => room.seats.find((s) => s.playerId === p)?.name ?? `P${p}`;

  const bidL = legal.find((l): l is Extract<ShelemLegal, { type: 'bid' }> => l.type === 'bid');
  const passL = legal.some((l) => l.type === 'pass');
  const trumpL = legal.find((l): l is Extract<ShelemLegal, { type: 'chooseTrump' }> => l.type === 'chooseTrump');
  const discardL = legal.find((l): l is Extract<ShelemLegal, { type: 'discardGround' }> => l.type === 'discardGround');
  const playL = legal.find((l): l is Extract<ShelemLegal, { type: 'play' }> => l.type === 'play');
  const playable = new Set(playL?.cards ?? []);

  const iAmHakem = you === view.hakem;
  const partner = you !== null ? (you + 2) % 4 : null;

  const sideLabel = (side: 0 | 1): string => `${names(side)} & ${names(side + 2)}`;

  const toggleDiscard = (card: number) => {
    setSelectedDiscards((prev) => {
      if (prev.includes(card)) {
        return prev.filter((c) => c !== card);
      }
      if (prev.length >= 4) {
        return [...prev.slice(1), card];
      }
      return [...prev, card];
    });
  };

  const handleBury = () => {
    if (selectedDiscards.length === 4) {
      sendAction({ type: 'discardGround', cards: selectedDiscards });
      setSelectedDiscards([]);
    }
  };

  const phaseLine = (): string => {
    if (game.status.terminal) return 'The match is decided.';
    if (view.phase === 'bidding') {
      return myTurn
        ? 'Your turn to bid — name your contract or pass!'
        : `${names(view.currentActor)} is bidding…`;
    }
    if (view.phase === 'widow') {
      return iAmHakem
        ? 'You are the Hakem — choose trump and bury 4 cards to the ground!'
        : `${names(view.hakem)} is setting trump and burying 4 ground cards…`;
    }
    return myTurn
      ? view.trick.length === 0
        ? 'Your lead'
        : 'Your turn — play a card'
      : `${names(view.currentActor)} is thinking…`;
  };

  return (
    <div className="game-layout">
      <div className="board-wrap hokm-felt">
        {/* Opponents and partner header */}
        <div className="uno-opps">
          {room.seats
            .filter((s) => s.playerId !== you)
            .map((s) => {
              const active = view.currentActor === s.playerId && !game.status.terminal;
              const isHakem = s.playerId === view.hakem && view.phase !== 'bidding';
              const isDealer = s.playerId === view.dealer;
              const isPartner = s.playerId === partner;
              return (
                <div key={s.playerId} className={`uno-opp${active ? ' active' : ''}`}>
                  <span
                    className="dot"
                    style={{ background: playerColor(s.playerId), width: 10, height: 10, borderRadius: 5 }}
                  />
                  <span>
                    {s.name}
                    {isHakem && <span title="Hakem"> 👑</span>}
                    {isDealer && <span title="Dealer"> Ⓓ</span>}
                    {isPartner && <span className="muted"> (partner)</span>}
                  </span>
                  <CardBack count={view.handCounts[s.playerId] ?? 0} />
                  <span title="tricks won this hand">🃏{view.tricksWon[s.playerId]}</span>
                </div>
              );
            })}
        </div>

        {/* Center Felt: Bidding indicator, Trump & Tricks */}
        <div className="hokm-center">
          {view.phase === 'bidding' ? (
            <div className="panel" style={{ padding: '16px 24px', textAlign: 'center', background: 'rgba(20,28,20,0.85)' }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--gold-bright)' }}>
                خوانش / حراج امتیاز
              </div>
              <div style={{ margin: '8px 0', fontSize: '1.4rem' }}>
                {view.currentBid > 0 ? (
                  <span>
                    Current High Bid: <strong>{view.currentBid}</strong> by {names(view.highestBidder!)}
                  </span>
                ) : (
                  <span className="muted">No bids yet (minimum 100)</span>
                )}
              </div>
              <div className="row" style={{ justifyContent: 'center', gap: 6 }}>
                <span className="muted">Ground cards:</span>
                <span title="4 cards on the ground">🃏 {view.groundCount}</span>
              </div>
            </div>
          ) : (
            <>
              {/* Trump badge */}
              <div
                className="hokm-trump"
                title={view.trump === null ? 'Trump not chosen yet' : `Trump: ${SUIT_NAMES[view.trump]}`}
              >
                <span className="muted" style={{ fontSize: '0.7rem' }}>حکم</span>
                <span className={`hokm-trump-suit${view.trump !== null && view.trump <= 1 ? ' red' : ''}`}>
                  {view.trump === null ? '?' : SUIT_SYMBOLS[view.trump]}
                </span>
                {view.targetBid > 0 && (
                  <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--gold)' }}>
                    {view.targetBid}
                  </span>
                )}
              </div>

              {/* Trick display */}
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
            </>
          )}
        </div>

        {/* Player's Own Hand */}
        {you !== null && (
          <div>
            {view.phase === 'widow' && iAmHakem && (
              <div style={{ textAlign: 'center', marginBottom: 8, color: 'var(--gold-bright)', fontSize: '0.9rem' }}>
                Select 4 cards to bury in the ground ({selectedDiscards.length}/4 selected)
              </div>
            )}
            <div className="hokm-hand">
              {view.hand.map((c) => {
                const inWidowDiscard = view.phase === 'widow' && iAmHakem && discardL !== undefined;
                const isSelected = selectedDiscards.includes(c);
                const isPlayable = view.phase === 'trick' && myTurn && playable.has(c);

                return (
                  <Card
                    key={c}
                    card={c}
                    selected={isSelected}
                    disabled={inWidowDiscard ? false : !isPlayable}
                    onClick={() => {
                      if (inWidowDiscard) {
                        toggleDiscard(c);
                      } else if (isPlayable) {
                        sendAction({ type: 'play', card: c });
                      }
                    }}
                  />
                );
              })}
              {view.hand.length === 0 && <span className="muted">—</span>}
            </div>
          </div>
        )}
      </div>

      {/* Sidebar Controls & Scoreboard */}
      <div className="sidebar">
        <div className={`turn-banner${myTurn ? ' yours' : ''}`}>{phaseLine()}</div>

        {/* Bidding Controls */}
        {myTurn && view.phase === 'bidding' && bidL && (
          <div className="panel" style={{ padding: 12, textAlign: 'center' }}>
            <strong className="display">Place Your Bid</strong>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 10 }}>
              {bidL.amounts.slice(0, 6).map((amt) => (
                <button
                  key={amt}
                  className="btn"
                  onClick={() => sendAction({ type: 'bid', amount: amt })}
                >
                  {amt}
                </button>
              ))}
              {bidL.amounts.includes(165) && (
                <button
                  className="btn btn-primary"
                  title="Shelem (All 165 points, 330 pts on win / -330 on loss)"
                  onClick={() => sendAction({ type: 'bid', amount: 165 })}
                >
                  شلم (165)
                </button>
              )}
              {passL && (
                <button
                  className="btn btn-secondary"
                  onClick={() => sendAction({ type: 'pass' })}
                >
                  Pass (پاس)
                </button>
              )}
            </div>
          </div>
        )}

        {/* Widow Controls (Hakem Choose Trump + Discard) */}
        {myTurn && view.phase === 'widow' && iAmHakem && (
          <div className="panel" style={{ padding: 12, textAlign: 'center' }}>
            {view.trump === null && trumpL && (
              <div style={{ marginBottom: 12 }}>
                <strong className="display">Call Trump (تعیین حکم)</strong>
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

            {discardL && (
              <div>
                <button
                  className="btn btn-primary"
                  disabled={selectedDiscards.length !== 4}
                  onClick={handleBury}
                >
                  Bury 4 Ground Cards ({selectedDiscards.length}/4)
                </button>
              </div>
            )}
          </div>
        )}

        {/* Scoreboard */}
        <div className="panel" style={{ padding: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <strong className="display">Hand {view.handNumber}</strong>
            <span className="muted">Goal: 660 pts</span>
          </div>

          {view.targetBid > 0 && (
            <div style={{ fontSize: '0.85rem', marginBottom: 8, padding: '4px 8px', background: 'rgba(255,255,255,0.05)', borderRadius: 4 }}>
              👑 Hakem: <strong>{names(view.hakem)}</strong> | Contract: <strong>{view.targetBid}</strong>
            </div>
          )}

          {([0, 1] as const).map((side) => {
            const matchPts = view.matchPoints[side];
            const currentHandPts = view.handPoints[side];
            const isMySide = you !== null && side === (you % 2);

            return (
              <div key={side} className="row" style={{ padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    background: playerColor(side),
                    display: 'inline-block',
                  }}
                />
                <span>
                  {sideLabel(side)}
                  {isMySide && <span className="muted"> (you)</span>}
                </span>
                <span className="spacer" />
                <span title="Hand Points" style={{ marginRight: 8, fontSize: '0.85rem' }}>
                  🃏 {currentHandPts} pts
                </span>
                <strong title="Match Score">⭐ {matchPts}</strong>
              </div>
            );
          })}
        </div>

        {extras}
      </div>
    </div>
  );
}

export const ShelemUI: GameUI = {
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
        return `— Hand ${String(e.hand)}: Dealer is ${name(e.dealer)} —`;
      case 'bidPlaced':
        return `📣 ${name(e.player)} bid ${String(e.amount)}`;
      case 'playerPassed':
        return `— ${name(e.player)} passed`;
      case 'allPassed':
        return `🔄 All passed — redealing hand!`;
      case 'auctionWon':
        return `👑 ${name(e.hakem)} won the auction with a bid of ${String(e.bid)}`;
      case 'trumpChosen':
        return `👑 ${name(e.player)} called ${SUIT_NAMES[e.suit as Suit]} ${SUIT_SYMBOLS[e.suit as Suit]} as trump`;
      case 'groundBuried':
        return `📦 ${name(e.player)} buried 4 cards in the ground`;
      case 'trickWon':
        return `🃏 ${name(e.player)} takes the trick (+${String(e.points)} pts)`;
      case 'handWon': {
        const hakemName = name(e.hakem);
        const outcome = e.made ? 'made the contract!' : 'went KASEH (failed contract)!';
        const hGain = Number(e.hakemGain);
        const dGain = Number(e.defendingGain);
        return `⭐ Hand complete: ${hakemName} ${outcome} (Hakem side: ${hGain > 0 ? '+' : ''}${hGain}, Defending side: +${dGain})`;
      }
      case 'resigned':
        return `🏳 ${name(e.player)} forfeited the match`;
      case 'gameOver': {
        const winners = (e.winners as number[]).map((p) => name(p)).join(' & ');
        return `🏆 ${winners} win the match!`;
      }
      default:
        return null;
    }
  },
};
