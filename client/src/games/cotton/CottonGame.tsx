import {
  HEX_VERTICES,
  RESOURCES,
  totalRes,
  type CottonLegal,
  type CottonView,
  type GameEvent,
  type Resource,
} from '@gamehub/shared';
import React, { useEffect, useMemo, useState } from 'react';
import { useGame } from '../../api/socket.js';
import { playerColor } from '../colors.js';
import type { GameUI } from '../registry.js';
import CottonBoard from './CottonBoard.js';

const RES_ICON: Record<Resource, string> = { brick: '🧱', lumber: '🌲', wool: '🐑', grain: '🌾', ore: '⛰' };
const RES_NAME: Record<Resource, string> = { brick: 'Brick', lumber: 'Lumber', wool: 'Wool', grain: 'Grain', ore: 'Ore' };

type BuildMode = 'road' | 'settlement' | 'city' | null;

function Steppers({
  counts,
  max,
  onChange,
}: {
  counts: Partial<Record<Resource, number>>;
  max: (r: Resource) => number;
  onChange(next: Partial<Record<Resource, number>>): void;
}): React.JSX.Element {
  return (
    <div className="cotton-steppers">
      {RESOURCES.map((r) => {
        const c = counts[r] ?? 0;
        return (
          <div key={r} className="cotton-stepper">
            <span>{RES_ICON[r]}</span>
            <button className="btn sm" disabled={c <= 0} onClick={() => onChange({ ...counts, [r]: c - 1 })}>−</button>
            <strong>{c}</strong>
            <button className="btn sm" disabled={c >= max(r)} onClick={() => onChange({ ...counts, [r]: c + 1 })}>+</button>
          </div>
        );
      })}
    </div>
  );
}

function Table({ extras }: { extras: React.ReactNode }): React.JSX.Element {
  const { room, game, you, sendAction } = useGame();
  const [mode, setMode] = useState<BuildMode>(null);
  const [robberHexSel, setRobberHexSel] = useState<number | null>(null);
  const [discardSel, setDiscardSel] = useState<Partial<Record<Resource, number>>>({});
  const [offerGive, setOfferGive] = useState<Partial<Record<Resource, number>>>({});
  const [offerWant, setOfferWant] = useState<Partial<Record<Resource, number>>>({});
  const [tradeOpen, setTradeOpen] = useState(false);
  const [bankGive, setBankGive] = useState<Resource>('brick');
  const [bankWant, setBankWant] = useState<Resource>('lumber');
  const [yopSel, setYopSel] = useState<[Resource, Resource]>(['brick', 'brick']);
  const [devOpen, setDevOpen] = useState<'yop' | 'monopoly' | null>(null);

  const view = game?.view as CottonView | null;
  const legal = (game?.legalActions ?? []) as CottonLegal[];
  const seq = game?.seq ?? 0;
  const find = <T extends CottonLegal['type']>(t: T) =>
    legal.find((l): l is Extract<CottonLegal, { type: T }> => l.type === t);

  useEffect(() => {
    setRobberHexSel(null);
    setDevOpen(null);
    if (mode) {
      const stillLegal =
        (mode === 'road' && find('buildRoad')) ||
        (mode === 'settlement' && find('buildSettlement')) ||
        (mode === 'city' && find('buildCity'));
      if (!stillLegal) setMode(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);

  const { clickableVertices, clickableEdges, clickableHexes } = useMemo(() => {
    const clickableVertices = new Set<number>();
    const clickableEdges = new Set<number>();
    const clickableHexes = new Set<number>();
    if (!view) return { clickableVertices, clickableEdges, clickableHexes };
    const setupSettle = find('placeSettlement');
    const setupRoad = find('placeRoad');
    const robber = find('moveRobber');
    if (setupSettle) setupSettle.vertices.forEach((v) => clickableVertices.add(v));
    if (setupRoad) setupRoad.edges.forEach((e) => clickableEdges.add(e));
    if (robber && robberHexSel === null) robber.hexes.forEach((h) => clickableHexes.add(h));
    if (mode === 'road') find('buildRoad')?.edges.forEach((e) => clickableEdges.add(e));
    if (mode === 'settlement') find('buildSettlement')?.vertices.forEach((v) => clickableVertices.add(v));
    if (mode === 'city') find('buildCity')?.vertices.forEach((v) => clickableVertices.add(v));
    return { clickableVertices, clickableEdges, clickableHexes };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, legal, mode, robberHexSel]);

  if (!room || !game || !view) return <></>;

  const myTurn = you !== null && game.currentActors.includes(you) && !game.status.terminal;
  const names = (p: number) => room.seats.find((s) => s.playerId === p)?.name ?? `P${p}`;
  const discardL = find('discard');
  const robberL = find('moveRobber');
  const canAccept = legal.some((l) => l.type === 'acceptTrade');

  // victims on the picked robber hex: players with a building there (from view)
  const victims: number[] =
    robberHexSel === null
      ? []
      : [...new Set(
          HEX_VERTICES[robberHexSel]!
            .map((v) => view.buildings[v]?.owner)
            .filter((o): o is number => o !== undefined && o !== null && o !== you)
            .filter((o) => view.players[o]!.handSize > 0 && !view.players[o]!.eliminated),
        )];

  const onHex = (h: number): void => {
    if (!robberL) return;
    // choosing the hex; if nobody to rob, move immediately
    const potential = [...new Set(
      HEX_VERTICES[h]!
        .map((v) => view.buildings[v]?.owner)
        .filter((o): o is number => o !== undefined && o !== null && o !== you)
        .filter((o) => view.players[o]!.handSize > 0 && !view.players[o]!.eliminated),
    )];
    if (potential.length === 0) sendAction({ type: 'moveRobber', hex: h, victim: null });
    else setRobberHexSel(h);
  };

  const phaseLine = (): string => {
    if (game.status.terminal) return 'The island has a ruler.';
    if (view.phase === 'discard') {
      const mine = you !== null ? view.discardsOwed[you]! : 0;
      return mine > 0 ? `Robber! Discard ${mine} cards` : 'Waiting for discards…';
    }
    if (!myTurn) return `${names(view.current)} — ${view.phase === 'setup' ? 'placing' : view.phase}`;
    switch (view.phase) {
      case 'setup':
        return view.setupNeedRoad ? 'Place a road next to your new settlement' : 'Place a settlement (any open spot)';
      case 'roll':
        return 'Your turn — roll the dice!';
      case 'robber':
        return robberHexSel === null ? 'Move the robber: pick a hex' : 'Pick who to rob';
      case 'roadBuilding':
        return `Place ${view.roadBuildingRoadsLeft} free road${view.roadBuildingRoadsLeft > 1 ? 's' : ''}`;
      case 'main':
        return mode ? `Placing a ${mode} — click the board` : 'Build, trade, or end your turn';
      default:
        return view.phase;
    }
  };

  const offerValid = totalRes(normalizeRes(offerGive)) > 0 && totalRes(normalizeRes(offerWant)) > 0;

  return (
    <div className="game-layout">
      <div className="board-wrap">
        <CottonBoard
          view={view}
          clickableVertices={myTurn ? clickableVertices : new Set()}
          clickableEdges={myTurn ? clickableEdges : new Set()}
          clickableHexes={myTurn ? clickableHexes : new Set()}
          selectedHex={robberHexSel}
          onVertex={(v) => {
            if (find('placeSettlement')) sendAction({ type: 'placeSettlement', vertex: v });
            else if (mode === 'settlement') sendAction({ type: 'buildSettlement', vertex: v });
            else if (mode === 'city') sendAction({ type: 'buildCity', vertex: v });
          }}
          onEdge={(e) => {
            if (find('placeRoad')) sendAction({ type: 'placeRoad', edge: e });
            else if (mode === 'road') sendAction({ type: 'buildRoad', edge: e });
          }}
          onHex={onHex}
        />
      </div>

      <div className="sidebar">
        <div className={`turn-banner${myTurn ? ' yours' : ''}`}>
          {phaseLine()}
          {view.lastRoll && (
            <span style={{ marginLeft: 8 }}>🎲 {view.lastRoll[0]}+{view.lastRoll[1]} = {view.lastRoll[0] + view.lastRoll[1]}</span>
          )}
        </div>

        {myTurn && find('roll') && (
          <button className="btn primary big" onClick={() => sendAction({ type: 'roll' })}>
            🎲 Roll Dice
          </button>
        )}

        {/* discard dialog */}
        {discardL && you !== null && (
          <div className="panel" style={{ padding: 12 }}>
            <strong className="display">Discard {discardL.count} cards</strong>
            <Steppers counts={discardSel} max={(r) => view.hand[r]} onChange={setDiscardSel} />
            <button
              className="btn primary"
              style={{ marginTop: 8, width: '100%' }}
              disabled={totalRes(normalizeRes(discardSel)) !== discardL.count}
              onClick={() => {
                sendAction({ type: 'discard', resources: discardSel });
                setDiscardSel({});
              }}
            >
              Discard ({totalRes(normalizeRes(discardSel))}/{discardL.count})
            </button>
          </div>
        )}

        {/* robber victim picker */}
        {myTurn && robberHexSel !== null && (
          <div className="panel" style={{ padding: 12 }}>
            <strong className="display">Steal from…</strong>
            <div className="row" style={{ marginTop: 8 }}>
              {victims.map((v) => (
                <button key={v} className="btn" onClick={() => {
                  sendAction({ type: 'moveRobber', hex: robberHexSel, victim: v });
                  setRobberHexSel(null);
                }}>
                  {names(v)} ({view.players[v]!.handSize})
                </button>
              ))}
              <button className="btn sm" onClick={() => setRobberHexSel(null)}>↩</button>
            </div>
          </div>
        )}

        {/* main-phase controls */}
        {myTurn && view.phase === 'main' && (
          <div className="panel" style={{ padding: 12 }}>
            <div className="row">
              <button className={`btn sm${mode === 'road' ? ' primary' : ''}`} disabled={!find('buildRoad')} title="1🧱 1🌲"
                onClick={() => setMode(mode === 'road' ? null : 'road')}>🛤 Road</button>
              <button className={`btn sm${mode === 'settlement' ? ' primary' : ''}`} disabled={!find('buildSettlement')} title="1🧱 1🌲 1🐑 1🌾"
                onClick={() => setMode(mode === 'settlement' ? null : 'settlement')}>🏠 Settle</button>
              <button className={`btn sm${mode === 'city' ? ' primary' : ''}`} disabled={!find('buildCity')} title="3⛰ 2🌾"
                onClick={() => setMode(mode === 'city' ? null : 'city')}>🏰 City</button>
              <button className="btn sm" disabled={!find('buyDev')} title="1⛰ 1🐑 1🌾" onClick={() => sendAction({ type: 'buyDev' })}>
                🂠 Dev ({view.devDeckCount})
              </button>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn sm" disabled={!find('playKnight')} onClick={() => sendAction({ type: 'playKnight' })}>
                ⚔ Knight ({view.devHand.knight - view.devFresh.knight})
              </button>
              <button className="btn sm" disabled={!find('playRoadBuilding')} onClick={() => sendAction({ type: 'playRoadBuilding' })}>
                🛤×2 ({view.devHand.roadBuilding - view.devFresh.roadBuilding})
              </button>
              <button className="btn sm" disabled={!find('playYearOfPlenty')} onClick={() => setDevOpen(devOpen === 'yop' ? null : 'yop')}>
                🎁 ({view.devHand.yearOfPlenty - view.devFresh.yearOfPlenty})
              </button>
              <button className="btn sm" disabled={!find('playMonopoly')} onClick={() => setDevOpen(devOpen === 'monopoly' ? null : 'monopoly')}>
                🎩 ({view.devHand.monopoly - view.devFresh.monopoly})
              </button>
              {view.devHand.vp > 0 && <span title="Victory point cards (hidden)">🏆×{view.devHand.vp}</span>}
            </div>
            {devOpen === 'yop' && (
              <div className="row" style={{ marginTop: 8 }}>
                {[0, 1].map((i) => (
                  <select key={i} value={yopSel[i]} onChange={(e) => {
                    const next: [Resource, Resource] = [...yopSel] as [Resource, Resource];
                    next[i] = e.target.value as Resource;
                    setYopSel(next);
                  }}>
                    {RESOURCES.map((r) => <option key={r} value={r}>{RES_ICON[r]} {RES_NAME[r]}</option>)}
                  </select>
                ))}
                <button className="btn sm primary" onClick={() => {
                  sendAction({ type: 'playYearOfPlenty', a: yopSel[0], b: yopSel[1] });
                  setDevOpen(null);
                }}>Take</button>
              </div>
            )}
            {devOpen === 'monopoly' && (
              <div className="row" style={{ marginTop: 8 }}>
                {RESOURCES.map((r) => (
                  <button key={r} className="btn sm" onClick={() => {
                    sendAction({ type: 'playMonopoly', resource: r });
                    setDevOpen(null);
                  }}>{RES_ICON[r]}</button>
                ))}
              </div>
            )}
            <div className="row" style={{ marginTop: 8 }}>
              <button className={`btn sm${tradeOpen ? ' primary' : ''}`} onClick={() => setTradeOpen(!tradeOpen)}>⇄ Trade</button>
              <span className="spacer" />
              <button className="btn" onClick={() => sendAction({ type: 'endTurn' })}>End Turn</button>
            </div>
          </div>
        )}

        {/* trade panel */}
        {myTurn && tradeOpen && view.phase === 'main' && (
          <div className="panel" style={{ padding: 12 }}>
            <strong className="display">Bank {(() => {
              const rates = find('bankTrade')?.rates;
              return rates ? `(${rates[bankGive]}:1)` : '(4:1)';
            })()}</strong>
            <div className="row" style={{ marginTop: 6 }}>
              <select value={bankGive} onChange={(e) => setBankGive(e.target.value as Resource)}>
                {RESOURCES.map((r) => <option key={r} value={r}>give {RES_ICON[r]}</option>)}
              </select>
              <span>→</span>
              <select value={bankWant} onChange={(e) => setBankWant(e.target.value as Resource)}>
                {RESOURCES.map((r) => <option key={r} value={r}>get {RES_ICON[r]}</option>)}
              </select>
              <button
                className="btn sm primary"
                disabled={!find('bankTrade') || bankGive === bankWant || view.hand[bankGive] < (find('bankTrade')?.rates[bankGive] ?? 4)}
                onClick={() => sendAction({ type: 'bankTrade', give: bankGive, want: bankWant })}
              >
                Trade
              </button>
            </div>
            <strong className="display" style={{ display: 'block', marginTop: 10 }}>Offer players</strong>
            <div className="row" style={{ marginTop: 4, alignItems: 'flex-start' }}>
              <div>
                <span className="muted">You give:</span>
                <Steppers counts={offerGive} max={(r) => view.hand[r]} onChange={setOfferGive} />
              </div>
              <div>
                <span className="muted">You want:</span>
                <Steppers counts={offerWant} max={() => 9} onChange={setOfferWant} />
              </div>
            </div>
            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn sm primary" disabled={!offerValid} onClick={() => sendAction({ type: 'offerTrade', give: offerGive, want: offerWant })}>
                Post offer
              </button>
              {view.tradeOffer && (
                <button className="btn sm danger" onClick={() => sendAction({ type: 'cancelTrade' })}>Cancel offer</button>
              )}
            </div>
          </div>
        )}

        {/* open offer (everyone sees it; others may accept) */}
        {view.tradeOffer && !game.status.terminal && (
          <div className="panel" style={{ padding: 12, borderColor: 'var(--gold)' }}>
            <strong className="display">{names(view.current)} offers:</strong>
            <div style={{ margin: '6px 0' }}>
              gives {fmtRes(view.tradeOffer.give)} · wants {fmtRes(view.tradeOffer.want)}
            </div>
            {canAccept && (
              <button className="btn primary" onClick={() => sendAction({ type: 'acceptTrade' })}>Accept trade</button>
            )}
          </div>
        )}

        {/* my hand */}
        {you !== null && (
          <div className="panel" style={{ padding: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong className="display">Your hand</strong>
              <strong title="your points (incl. hidden VP)">{view.myPoints} / 10 ⭐</strong>
            </div>
            <div className="row" style={{ marginTop: 6 }}>
              {RESOURCES.map((r) => (
                <span key={r} className="cotton-res" title={RES_NAME[r]}>
                  {RES_ICON[r]} {view.hand[r]}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* players */}
        <div className="panel" style={{ padding: 10 }}>
          {room.seats.map((s) => {
            const pl = view.players[s.playerId];
            if (!pl) return null;
            const active = view.current === s.playerId && !game.status.terminal;
            return (
              <div key={s.playerId} className="row" style={{ padding: '3px 0', opacity: pl.eliminated ? 0.45 : 1 }}>
                <span style={{ width: 12, height: 12, borderRadius: 6, background: playerColor(s.playerId), display: 'inline-block' }} />
                <span style={pl.eliminated ? { textDecoration: 'line-through' } : undefined}>
                  {active ? <strong>{s.name}</strong> : s.name}
                  {s.playerId === you && <span className="muted"> (you)</span>}
                </span>
                <span className="spacer" />
                <span title="visible points">⭐{pl.visiblePoints}</span>
                <span title="resource cards">🂠{pl.handSize}</span>
                <span title="dev cards">🎴{pl.devCount}</span>
                {view.largestArmy === s.playerId && <span title="Largest army (+2)">⚔</span>}
                {view.longestRoad === s.playerId && <span title="Longest road (+2)">🛤</span>}
              </div>
            );
          })}
        </div>

        {extras}
      </div>
    </div>
  );
}

function normalizeRes(p: Partial<Record<Resource, number>>): Record<Resource, number> {
  const out = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
  for (const r of RESOURCES) out[r] = Math.max(0, p[r] ?? 0);
  return out;
}

function fmtRes(counts: Record<Resource, number>): string {
  return RESOURCES.filter((r) => counts[r] > 0)
    .map((r) => `${counts[r]}${RES_ICON[r]}`)
    .join(' ') || 'nothing';
}

export const CottonUI: GameUI = {
  Table,
  soundFor(e: GameEvent) {
    switch (e.type) {
      case 'diceRolled':
        return 'dice';
      case 'built':
        return 'place';
      case 'robberMoved':
      case 'stole':
        return 'attack';
      case 'devBought':
      case 'discarded':
        return 'card';
      case 'devPlayed':
        return 'turn';
      case 'bankTraded':
      case 'tradeAccepted':
        return 'trade';
      case 'largestArmy':
      case 'longestRoad':
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
      case 'turnStarted':
        return `⟶ ${name(e.player)}'s turn`;
      case 'diceRolled':
        return `🎲 ${name(e.player)} rolled ${String(e.d1)}+${String(e.d2)} = ${String(e.total)}`;
      case 'produced': {
        const gained = e.gained as Record<Resource, number>;
        return `${name(e.player)} collects ${fmtRes(gained)}`;
      }
      case 'discarded':
        return `${name(e.player)} discarded ${String(e.count)} cards`;
      case 'robberMoved':
        return `🦹 ${name(e.player)} moved the robber`;
      case 'stole':
        return `${name(e.player)} stole a card from ${name(e.victim)}`;
      case 'built':
        return `${name(e.player)} built a ${String(e.what)}`;
      case 'startingResources':
        return `${name(e.player)} collected starting resources`;
      case 'devBought':
        return `${name(e.player)} bought a development card`;
      case 'devPlayed': {
        const extra =
          e.card === 'monopoly'
            ? ` — took ${String(e.took)} ${RES_ICON[e.resource as Resource]}`
            : e.card === 'yearOfPlenty'
              ? ` — took ${RES_ICON[e.a as Resource]}${RES_ICON[e.b as Resource]}`
              : '';
        return `${name(e.player)} played ${String(e.card)}${extra}`;
      }
      case 'bankTraded':
        return `${name(e.player)} bank-traded ${String(e.rate)} ${RES_ICON[e.give as Resource]} → 1 ${RES_ICON[e.want as Resource]}`;
      case 'tradeOffered':
        return `${name(e.player)} posted a trade offer`;
      case 'tradeAccepted':
        return `🤝 ${name(e.player)} accepted ${name(e.with)}'s trade`;
      case 'tradeCancelled':
        return `${name(e.player)} withdrew the offer`;
      case 'longestRoad':
        return e.player === null ? '🛤 Longest road is contested — nobody holds it' : `🛤 ${name(e.player)} has the longest road!`;
      case 'largestArmy':
        return `⚔ ${name(e.player)} has the largest army!`;
      case 'resigned':
        return `🏳 ${name(e.player)} left the island`;
      case 'gameOver':
        return `👑 ${name(e.player)} rules the island!`;
      default:
        return null;
    }
  },
};
