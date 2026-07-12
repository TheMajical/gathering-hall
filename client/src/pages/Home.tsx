import { GAMES } from '@gamehub/shared';
import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getName, useGame } from '../api/socket.js';

export default function Home(): React.JSX.Element {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { createRoom, joinRoom, connected } = useGame();
  const [name, setNameInput] = useState(getName());
  const [code, setCode] = useState(params.get('join') ?? '');
  const [gameId, setGameId] = useState('risk');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const withBusy = async (fn: () => Promise<void>) => {
    setErr('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const canAct = connected && name.trim().length > 0 && !busy;

  return (
    <div className="center-page">
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '2.6rem', color: 'var(--gold)' }}>&#11041;</div>
        <h1 style={{ fontSize: '3rem', margin: 0 }}>The Gathering Hall</h1>
        <p className="muted" style={{ marginTop: 6 }}>
          Pull up a chair — Cotton, Risk, Chess &amp; Uno await.
        </p>
      </div>

      <div className="panel" style={{ width: 'min(440px, 92vw)' }}>
        <label htmlFor="name">Your name</label>
        <input
          id="name"
          type="text"
          style={{ width: '100%', marginTop: 6 }}
          placeholder="e.g. Redbeard"
          value={name}
          maxLength={24}
          onChange={(e) => setNameInput(e.target.value)}
        />

        <div style={{ marginTop: 18 }}>
          <label htmlFor="game">Found a new table</label>
          <div className="row" style={{ marginTop: 6 }}>
            <select id="game" value={gameId} onChange={(e) => setGameId(e.target.value)} style={{ flex: 1 }}>
              {GAMES.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.minPlayers}–{g.maxPlayers} players)
                </option>
              ))}
            </select>
            <button
              className="btn primary"
              disabled={!canAct}
              onClick={() =>
                void withBusy(async () => {
                  const roomCode = await createRoom(name, gameId);
                  nav(`/room/${roomCode}`);
                })
              }
            >
              Create
            </button>
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <label htmlFor="code">Join with a room code</label>
          <div className="row" style={{ marginTop: 6 }}>
            <input
              id="code"
              type="text"
              placeholder="ABC123"
              value={code}
              maxLength={6}
              style={{ flex: 1, textTransform: 'uppercase', letterSpacing: 4 }}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button
              className="btn"
              disabled={!canAct || code.trim().length !== 6}
              onClick={() =>
                void withBusy(async () => {
                  await joinRoom(code.trim(), name);
                  nav(`/room/${code.trim().toUpperCase()}`);
                })
              }
            >
              Join
            </button>
          </div>
        </div>

        {err && <p style={{ color: 'var(--brick)', marginBottom: 0 }}>{err}</p>}
        {!connected && <p className="muted" style={{ marginBottom: 0 }}>Connecting to the hall…</p>}
      </div>
    </div>
  );
}
