import { GAMES } from '@gamehub/shared';
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getName, useGame } from '../api/socket.js';
import { PLAYER_COLORS } from '../games/colors.js';
import GameScreen from './Game.js';

export default function Room(): React.JSX.Element {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const { room, connected, joinRoom } = useGame();
  const joining = useRef(false);
  const [joinErr, setJoinErr] = useState('');

  // Deep-link / refresh: join (or rejoin by stored token) when we land here.
  useEffect(() => {
    if (!connected || joining.current) return;
    if (room?.code === code.toUpperCase()) return;
    const name = getName();
    if (!name) {
      nav(`/?join=${code}`);
      return;
    }
    joining.current = true;
    joinRoom(code, name)
      .catch((e: Error) => setJoinErr(e.message))
      .finally(() => {
        joining.current = false;
      });
  }, [connected, room, code, joinRoom, nav]);

  if (joinErr) {
    return (
      <div className="center-page">
        <div className="panel" style={{ textAlign: 'center' }}>
          <h2>Could not join {code.toUpperCase()}</h2>
          <p className="muted">{joinErr}</p>
          <button className="btn" onClick={() => nav('/')}>Back to the Hall</button>
        </div>
      </div>
    );
  }

  if (!room || room.code !== code.toUpperCase()) {
    return (
      <div className="center-page">
        <p className="display" style={{ fontSize: '1.4rem' }}>Entering room {code.toUpperCase()}…</p>
      </div>
    );
  }

  if (room.phase === 'lobby') return <Lobby />;
  return <GameScreen />;
}

function Lobby(): React.JSX.Element {
  const nav = useNavigate();
  const { room, you, configure, start, leaveRoom, kick } = useGame();
  if (!room) return <></>;
  const isHost = you !== null && you === room.hostId;
  const spec = GAMES.find((g) => g.id === room.gameId);
  const canStart = room.seats.length >= room.minPlayers && room.seats.length <= room.maxPlayers;
  const shareUrl = `${location.origin}${location.pathname}#/room/${room.code}`;

  return (
    <div className="center-page">
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ margin: 0 }}>{spec?.name ?? room.gameId}</h1>
        <p className="muted" style={{ margin: '4px 0 0' }}>{spec?.tagline}</p>
      </div>

      <div className="row" style={{ alignItems: 'stretch', justifyContent: 'center' }}>
        <div className="panel" style={{ width: 'min(400px, 92vw)' }}>
          <h3 className="panel-title">Around the table</h3>
          <div className="col">
            {room.seats.map((s, i) => (
              <div key={s.playerId} className={`seat${s.connected ? '' : ' disconnected'}`}>
                <span className="dot" style={{ background: PLAYER_COLORS[i % PLAYER_COLORS.length] }} />
                <strong>{s.name}</strong>
                {s.playerId === room.hostId && <span title="Host">&#9818;</span>}
                {s.playerId === you && <span className="muted">(you)</span>}
                <span className="spacer" />
                {!s.connected && <span className="muted">away</span>}
                {isHost && !s.connected && s.playerId !== you && (
                  <button className="btn sm danger" onClick={() => kick(s.playerId)}>Remove</button>
                )}
              </div>
            ))}
            {room.seats.length < room.maxPlayers && (
              <div className="seat" style={{ borderStyle: 'dashed', opacity: 0.7 }}>
                <span className="muted">Waiting for settlers… ({room.seats.length}/{room.maxPlayers})</span>
              </div>
            )}
          </div>
        </div>

        <div className="panel" style={{ width: 'min(400px, 92vw)' }}>
          <h3 className="panel-title">Summon your friends</h3>
          <p style={{ marginTop: 0 }}>Room code:</p>
          <div className="code-badge">{room.code}</div>
          <p style={{ marginBottom: 6 }}>Or share this link:</p>
          <div className="row">
            <input type="text" readOnly value={shareUrl} style={{ flex: 1, fontSize: '0.8rem' }} onFocus={(e) => e.target.select()} />
            <button
              className="btn sm"
              onClick={() => {
                void navigator.clipboard?.writeText(shareUrl);
              }}
            >
              Copy
            </button>
          </div>

          {isHost && (
            <div style={{ marginTop: 18 }}>
              <label htmlFor="switch-game">Game</label>
              <div className="row" style={{ marginTop: 6 }}>
                <select id="switch-game" value={room.gameId} onChange={(e) => configure(e.target.value)} style={{ flex: 1 }}>
                  {GAMES.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.minPlayers}–{g.maxPlayers})
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn primary big" style={{ width: '100%', marginTop: 14 }} disabled={!canStart} onClick={start}>
                {canStart ? 'Begin the Game' : `Need ${room.minPlayers}–${room.maxPlayers} players`}
              </button>
            </div>
          )}
          {!isHost && <p className="muted" style={{ marginTop: 18 }}>Waiting for the host to begin…</p>}
        </div>
      </div>

      <button
        className="btn sm"
        onClick={() => {
          leaveRoom();
          nav('/');
        }}
      >
        Leave room
      </button>
    </div>
  );
}
