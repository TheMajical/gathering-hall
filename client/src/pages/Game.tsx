import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGame } from '../api/socket.js';
import { isMuted, playSound, setMuted, type SoundName } from '../api/sounds.js';
import { GAME_UIS } from '../games/registry.js';

/** Shared sidebar block every game embeds: winner banner, log, chat, room controls. */
function SharedExtras(): React.JSX.Element {
  const nav = useNavigate();
  const { room, game, you, log, sendChat, toLobby, leaveRoom, sendAction, kick } = useGame();
  const [chat, setChat] = useState('');
  const [muted, setMutedState] = useState(isMuted());
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  if (!room || !game) return <></>;
  const isHost = you !== null && you === room.hostId;
  const terminal = game.status.terminal;
  const winnerNames = game.status.winners.map((w) => room.seats.find((s) => s.playerId === w)?.name ?? `P${w}`);
  const myTurn = you !== null && game.currentActors.includes(you);
  const iAmDead = you !== null && game.status.eliminated.includes(you);
  const disconnectedSeats = room.seats.filter((s) => !s.connected);

  return (
    <>
      {terminal && (
        <div className="winner-banner">
          {winnerNames.length > 0 ? <>&#9813; {winnerNames.join(' & ')} wins!</> : <>½–½ It's a draw!</>}
          {isHost && (
            <div style={{ marginTop: 10 }}>
              <button className="btn" onClick={toLobby}>Back to Lobby</button>
            </div>
          )}
        </div>
      )}

      <div className="panel" style={{ padding: 12 }}>
        <div ref={logRef} className="log">
          {log.map((l) => (
            <div key={l.id} style={l.kind === 'chat' ? { color: 'var(--sea-dark)' } : undefined}>
              {l.text}
            </div>
          ))}
          {log.length === 0 && <div className="muted">The town crier is silent…</div>}
        </div>
        <form
          style={{ marginTop: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (chat.trim()) sendChat(chat);
            setChat('');
          }}
        >
          <input
            className="chat-input"
            type="text"
            placeholder="Say something…"
            value={chat}
            maxLength={500}
            onChange={(e) => setChat(e.target.value)}
          />
        </form>
      </div>

      <div className="row" style={{ justifyContent: 'center' }}>
        <button
          className="btn sm"
          title={muted ? 'Unmute sounds' : 'Mute sounds'}
          onClick={() => {
            const m = !muted;
            setMuted(m);
            setMutedState(m);
            if (!m) playSound('turn'); // audible confirmation
          }}
        >
          {muted ? '🔇' : '🔊'}
        </button>
        {!terminal && !iAmDead && you !== null && (
          <button
            className="btn sm danger"
            onClick={() => {
              if (confirm('Resign from this game?')) sendAction({ type: 'resign' });
            }}
          >
            Resign
          </button>
        )}
        {isHost && !terminal && disconnectedSeats.length > 0 && (
          <>
            {disconnectedSeats.map((s) => (
              <button key={s.playerId} className="btn sm" onClick={() => kick(s.playerId)}>
                Kick {s.name} (away)
              </button>
            ))}
          </>
        )}
        {isHost && !terminal && (
          <button
            className="btn sm"
            onClick={() => {
              if (confirm('Abandon this game for everyone and return to the lobby?')) toLobby();
            }}
          >
            Abandon game
          </button>
        )}
        <button
          className="btn sm"
          onClick={() => {
            leaveRoom();
            nav('/');
          }}
        >
          Leave
        </button>
      </div>
      {myTurn && !terminal && <div style={{ display: 'none' }} aria-hidden />}
    </>
  );
}

export default function GameScreen(): React.JSX.Element {
  const { room, game, events, appendLog } = useGame();
  const seenBatch = useRef<object | null>(null);

  const ui = room ? GAME_UIS[room.gameId] : undefined;

  // Turn semantic events into log lines + sounds exactly once per batch.
  useEffect(() => {
    if (!room || !ui || events.length === 0 || seenBatch.current === events) return;
    seenBatch.current = events;
    const names = (p: unknown) =>
      room.seats.find((s) => s.playerId === p)?.name ?? `Player ${String(p)}`;
    const sounds = new Set<SoundName>();
    for (const e of events) {
      const line = ui.describeEvent(e, names);
      if (line) appendLog(line);
      const snd = ui.soundFor(e);
      if (snd) sounds.add(snd);
    }
    // one play per distinct sound per batch — a blitz rattles once, not 20×
    for (const snd of sounds) playSound(snd);
  }, [events, room, ui, appendLog]);

  if (!room || !game) return <div className="center-page">Loading…</div>;
  if (!ui) {
    return (
      <div className="center-page">
        <div className="panel">Unknown game: {room.gameId}</div>
      </div>
    );
  }
  const Table = ui.Table;
  return <Table extras={<SharedExtras />} />;
}
