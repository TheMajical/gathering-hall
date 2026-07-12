import {
  TERRITORIES,
  cardType,
  type GameEvent,
  type RiskLegal,
  type RiskView,
} from '@gamehub/shared';
import React, { useEffect, useMemo, useState } from 'react';
import { useGame } from '../../api/socket.js';
import { playerColor } from '../colors.js';
import type { GameUI } from '../registry.js';
import RiskBoard from './RiskBoard.js';

const tname = (id: unknown): string => TERRITORIES[Number(id)]?.name ?? `#${String(id)}`;

const CARD_GLYPHS: Record<string, string> = { infantry: '♟', cavalry: '♞', artillery: '♜', wild: '★' };

function Table({ extras }: { extras: React.ReactNode }): React.JSX.Element {
  const { room, game, you, events, sendAction } = useGame();
  const [selFrom, setSelFrom] = useState<number | null>(null);
  const [pendingTarget, setPendingTarget] = useState<number | null>(null);
  const [dice, setDice] = useState(3);
  const [moveCount, setMoveCount] = useState(0);
  const [selCards, setSelCards] = useState<number[]>([]);

  const view = game?.view as RiskView | null;
  const legal = (game?.legalActions ?? []) as RiskLegal[];
  const seq = game?.seq ?? 0;

  const placeL = legal.find((l): l is Extract<RiskLegal, { type: 'place' }> => l.type === 'place');
  const tradeL = legal.find((l): l is Extract<RiskLegal, { type: 'trade' }> => l.type === 'trade');
  const attackL = legal.find((l): l is Extract<RiskLegal, { type: 'attack' }> => l.type === 'attack');
  const moveL = legal.find((l): l is Extract<RiskLegal, { type: 'moveArmies' }> => l.type === 'moveArmies');
  const fortifyL = legal.find((l): l is Extract<RiskLegal, { type: 'fortify' }> => l.type === 'fortify');
  const canEndReinforce = legal.some((l) => l.type === 'endReinforce');
  const canEndAttack = legal.some((l) => l.type === 'endAttack');
  const canEndTurn = legal.some((l) => l.type === 'endTurn');

  // Reset transient UI when the game advances or the phase changes.
  useEffect(() => {
    setPendingTarget(null);
    if (moveL) setMoveCount(moveL.max);
    if (selFrom !== null) {
      const stillValid =
        (attackL?.options.some((o) => o.from === selFrom) ?? false) ||
        (fortifyL?.options.some((o) => o.from === selFrom) ?? false);
      if (!stillValid) setSelFrom(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);

  const { clickable, targets } = useMemo(() => {
    const clickable = new Set<number>();
    const targets = new Set<number>();
    if (!view) return { clickable, targets };
    if (placeL) {
      for (const t of placeL.territories) clickable.add(t);
    } else if (attackL) {
      for (const o of attackL.options) clickable.add(o.from);
      if (selFrom !== null) {
        for (const o of attackL.options) if (o.from === selFrom) targets.add(o.to);
      }
    } else if (fortifyL) {
      for (const o of fortifyL.options) clickable.add(o.from);
      if (selFrom !== null) {
        const opt = fortifyL.options.find((o) => o.from === selFrom);
        for (const t of opt?.targets ?? []) targets.add(t);
      }
    }
    return { clickable, targets };
  }, [view, placeL, attackL, fortifyL, selFrom]);

  if (!room || !game || !view) return <></>;

  const myTurn = you !== null && game.currentActors.includes(you) && !game.status.terminal;
  const currentName = room.seats.find((s) => s.playerId === view.current)?.name ?? '…';
  const maxDiceFor = (from: number, to: number): number =>
    attackL?.options.find((o) => o.from === from && o.to === to)?.maxDice ?? 1;

  const onTerritoryClick = (id: number): void => {
    if (!myTurn) return;
    if (placeL) {
      if (placeL.territories.includes(id)) sendAction({ type: 'place', territoryId: id, count: 1 });
      return;
    }
    if (attackL || fortifyL) {
      if (targets.has(id) && selFrom !== null) {
        setPendingTarget(id);
        if (attackL) setDice(maxDiceFor(selFrom, id));
        return;
      }
      if (clickable.has(id)) {
        setSelFrom(id === selFrom ? null : id);
        setPendingTarget(null);
      }
    }
  };

  const phaseLine = (): string => {
    if (game.status.terminal) return 'The war is over.';
    if (!myTurn) return `${currentName} — ${phaseLabel(view.phase)}`;
    switch (view.phase) {
      case 'setup':
        return `Claim phase: place ${Math.min(view.setupBatch, view.setupRemaining[you ?? 0] ?? 0)} armies (${view.setupRemaining[you ?? 0]} left)`;
      case 'reinforce':
        return tradeL?.forced
          ? 'You must trade a card set (5+ cards)'
          : `Reinforce: ${view.reinforcementsRemaining} armies to place`;
      case 'attack':
        return tradeL?.forced
          ? 'Trade cards before continuing (6+)'
          : view.reinforcementsRemaining > 0
            ? `Place ${view.reinforcementsRemaining} traded armies`
            : selFrom === null
              ? 'Attack: pick one of your territories'
              : `Attacking from ${tname(selFrom)} — pick a target`;
      case 'move_armies':
        return 'Choose how many extra armies to move in';
      case 'fortify':
        return selFrom === null ? 'Fortify: pick a source (or end turn)' : `Fortify from ${tname(selFrom)} — pick a destination`;
      default:
        return '';
    }
  };

  // Latest dice results for the panel.
  const lastRolls = events.filter((e) => e.type === 'diceRolled').slice(-3) as (GameEvent & {
    attackerRolls: number[];
    defenderRolls: number[];
    attackerLosses: number;
    defenderLosses: number;
  })[];

  const tradeSelected = (): void => {
    if (selCards.length === 3) {
      sendAction({ type: 'trade', cards: [selCards[0]!, selCards[1]!, selCards[2]!] });
      setSelCards([]);
    }
  };
  const selectedIsValidSet =
    selCards.length === 3 &&
    (tradeL?.sets.some((s) => [...s].sort((a, b) => a - b).join() === [...selCards].sort((a, b) => a - b).join()) ?? false);

  return (
    <div className="game-layout">
      <div className="board-wrap">
        <RiskBoard view={view} clickable={myTurn ? clickable : new Set()} selected={selFrom} targets={myTurn ? targets : new Set()} onTerritoryClick={onTerritoryClick} />
      </div>

      <div className="sidebar">
        <div className={`turn-banner${myTurn ? ' yours' : ''}`}>{phaseLine()}</div>

        {/* attack dialog */}
        {myTurn && attackL && selFrom !== null && pendingTarget !== null && (
          <div className="panel" style={{ padding: 12 }}>
            <strong className="display">
              {tname(selFrom)} → {tname(pendingTarget)}
            </strong>
            <div className="row" style={{ marginTop: 8 }}>
              <label>Dice:</label>
              {[1, 2, 3].map((d) => (
                <button
                  key={d}
                  className={`btn sm${dice === d ? ' primary' : ''}`}
                  disabled={d > maxDiceFor(selFrom, pendingTarget)}
                  onClick={() => setDice(d)}
                >
                  {d}
                </button>
              ))}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn primary" onClick={() => sendAction({ type: 'attack', from: selFrom, to: pendingTarget, dice })}>
                ⚔ Attack
              </button>
              <button
                className="btn danger"
                onClick={() => sendAction({ type: 'attack', from: selFrom, to: pendingTarget, dice: maxDiceFor(selFrom, pendingTarget), blitz: true })}
              >
                Blitz!
              </button>
              <button className="btn sm" onClick={() => setPendingTarget(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* post-conquest move dialog */}
        {myTurn && moveL && (
          <div className="panel" style={{ padding: 12 }}>
            <strong className="display">
              Move extra armies: {tname(moveL.from)} → {tname(moveL.to)}
            </strong>
            <div className="row" style={{ marginTop: 8 }}>
              <input
                type="number"
                min={moveL.min}
                max={moveL.max}
                value={moveCount}
                style={{ width: 80 }}
                onChange={(e) => setMoveCount(Math.max(moveL.min, Math.min(moveL.max, Number(e.target.value) || 0)))}
              />
              <span className="muted">of {moveL.max}</span>
              <button className="btn primary" onClick={() => sendAction({ type: 'moveArmies', count: moveCount })}>
                Move
              </button>
            </div>
          </div>
        )}

        {/* fortify dialog */}
        {myTurn && fortifyL && selFrom !== null && pendingTarget !== null && (
          <FortifyDialog
            from={selFrom}
            to={pendingTarget}
            max={fortifyL.options.find((o) => o.from === selFrom)?.max ?? 1}
            onMove={(count) => sendAction({ type: 'fortify', from: selFrom, to: pendingTarget, count })}
            onCancel={() => setPendingTarget(null)}
          />
        )}

        {/* phase-advance buttons */}
        {myTurn && (canEndReinforce || canEndAttack || canEndTurn) && (
          <div className="row" style={{ justifyContent: 'center' }}>
            {canEndReinforce && (
              <button className="btn" onClick={() => sendAction({ type: 'endReinforce' })}>
                To Battle ⚔
              </button>
            )}
            {canEndAttack && (
              <button className="btn" onClick={() => sendAction({ type: 'endAttack' })}>
                Cease Attack
              </button>
            )}
            {canEndTurn && (
              <button className="btn" onClick={() => sendAction({ type: 'endTurn' })}>
                End Turn
              </button>
            )}
          </div>
        )}

        {/* dice results */}
        {lastRolls.length > 0 && (
          <div className="panel" style={{ padding: '8px 12px', fontSize: '0.9rem' }}>
            {lastRolls.map((r, i) => (
              <div key={i}>
                ⚔ {r.attackerRolls.join('·')} vs 🛡 {r.defenderRolls.join('·')} —{' '}
                {r.defenderLosses > 0 && <span>def −{r.defenderLosses} </span>}
                {r.attackerLosses > 0 && <span>atk −{r.attackerLosses}</span>}
              </div>
            ))}
          </div>
        )}

        {/* my cards */}
        {you !== null && view.hand.length > 0 && (
          <div className="panel" style={{ padding: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong className="display">Your cards</strong>
              <span className="muted">next trade: {view.nextTradeValue}</span>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              {view.hand.map((c) => {
                const kind = cardType(c);
                return (
                  <div
                    key={c}
                    className={`hand-card${selCards.includes(c) ? ' selected' : ''}`}
                    onClick={() =>
                      setSelCards((sel) => (sel.includes(c) ? sel.filter((x) => x !== c) : sel.length < 3 ? [...sel, c] : sel))
                    }
                  >
                    <span className="glyph">{CARD_GLYPHS[kind]}</span>
                    <span>{kind === 'wild' ? 'Wild' : TERRITORIES[c]?.name.split(' ')[0]}</span>
                  </div>
                );
              })}
            </div>
            {tradeL && (
              <button className="btn primary" style={{ marginTop: 10, width: '100%' }} disabled={!selectedIsValidSet} onClick={tradeSelected}>
                {tradeL.forced ? 'Trade (required)' : 'Trade set'} → +{view.nextTradeValue} armies
              </button>
            )}
          </div>
        )}

        {/* players */}
        <div className="panel" style={{ padding: 12 }}>
          {room.seats.map((s) => {
            const p = view.players[s.playerId];
            if (!p) return null;
            const active = view.current === s.playerId && !game.status.terminal;
            return (
              <div key={s.playerId} className="row" style={{ padding: '3px 0', opacity: p.eliminated ? 0.45 : 1 }}>
                <span style={{ width: 12, height: 12, borderRadius: 6, background: playerColor(s.playerId), display: 'inline-block' }} />
                <span style={p.eliminated ? { textDecoration: 'line-through' } : undefined}>
                  {active ? <strong>{s.name}</strong> : s.name}
                  {s.playerId === you && <span className="muted"> (you)</span>}
                </span>
                <span className="spacer" />
                <span title="territories">🗺 {p.territories}</span>
                <span title="armies">⚔ {p.armies}</span>
                <span title="cards">🂠 {p.cardCount}</span>
              </div>
            );
          })}
        </div>

        {extras}
      </div>
    </div>
  );
}

function FortifyDialog({
  from,
  to,
  max,
  onMove,
  onCancel,
}: {
  from: number;
  to: number;
  max: number;
  onMove(count: number): void;
  onCancel(): void;
}): React.JSX.Element {
  const [count, setCount] = useState(max);
  return (
    <div className="panel" style={{ padding: 12 }}>
      <strong className="display">
        Fortify: {tname(from)} → {tname(to)}
      </strong>
      <div className="row" style={{ marginTop: 8 }}>
        <input
          type="number"
          min={1}
          max={max}
          value={count}
          style={{ width: 80 }}
          onChange={(e) => setCount(Math.max(1, Math.min(max, Number(e.target.value) || 1)))}
        />
        <span className="muted">of {max}</span>
        <button className="btn primary" onClick={() => onMove(count)}>
          Move
        </button>
        <button className="btn sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case 'setup':
      return 'claiming territories';
    case 'reinforce':
      return 'reinforcing';
    case 'attack':
      return 'attacking';
    case 'move_armies':
      return 'moving armies';
    case 'fortify':
      return 'fortifying';
    default:
      return phase;
  }
}

export const RiskUI: GameUI = {
  Table,
  soundFor(e) {
    switch (e.type) {
      case 'diceRolled':
        return 'dice';
      case 'conquered':
        return 'conquer';
      case 'placed':
        return 'place';
      case 'cardsTraded':
        return 'trade';
      case 'cardDrawn':
        return 'card';
      case 'eliminated':
      case 'resigned':
        return 'eliminated';
      case 'gameOver':
        return 'victory';
      case 'turnStarted':
        return 'turn';
      case 'fortified':
      case 'moved':
        return 'place';
      default:
        return null;
    }
  },
  describeEvent(e, name): string | null {
    switch (e.type) {
      case 'turnStarted':
        return `⟶ ${name(e.player)}'s turn (+${String(e.income)} armies)`;
      case 'placed':
        return `${name(e.player)} placed ${String(e.count)} on ${tname(e.territory)}`;
      case 'cardsTraded':
        return `${name(e.player)} traded cards for ${String(e.value)} armies`;
      case 'territoryBonus':
        return `　+2 bonus armies on ${tname(e.territory)}`;
      case 'diceRolled': {
        const a = (e.attackerRolls as number[]).join('·');
        const d = (e.defenderRolls as number[]).join('·');
        return `⚔ ${name(e.player)} ${tname(e.from)}→${tname(e.to)}: ${a} vs ${d}`;
      }
      case 'conquered':
        return `🏰 ${name(e.player)} conquered ${tname(e.to)} from ${name(e.defender)}`;
      case 'eliminated':
        return `💀 ${name(e.player)} was eliminated by ${name(e.by)} (${String(e.cardsTaken)} cards taken)`;
      case 'moved':
        return `${name(e.player)} moved ${String(e.count)} armies ${tname(e.from)} → ${tname(e.to)}`;
      case 'fortified':
        return `${name(e.player)} fortified ${tname(e.to)} with ${String(e.count)} from ${tname(e.from)}`;
      case 'cardDrawn':
        return `${name(e.player)} drew a card`;
      case 'resigned':
        return `🏳 ${name(e.player)} resigned`;
      case 'gameOver':
        return `👑 ${name(e.player)} has conquered the world!`;
      default:
        return null;
    }
  },
};
