/**
 * Socket wrapper + React context. Owns the session (display name, per-room
 * seat token in localStorage), auto-rejoins after socket reconnects, and
 * exposes room/game state + action dispatch to the pages.
 */
import type {
  ChatMessage,
  GameEvent,
  GameStatePayload,
  JoinResult,
  RoomStatePayload,
} from '@gamehub/shared';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

const socket: Socket = io({ autoConnect: true });

export function getName(): string {
  return localStorage.getItem('gh:name') ?? '';
}
export function setName(name: string): void {
  localStorage.setItem('gh:name', name.trim().slice(0, 24));
}
function tokenKey(code: string): string {
  return `gh:seat:${code.toUpperCase()}`;
}
export function getToken(code: string): string | null {
  return localStorage.getItem(tokenKey(code));
}
function setToken(code: string, token: string): void {
  if (token) localStorage.setItem(tokenKey(code), token);
}

export interface LogLine {
  id: number;
  text: string;
  kind: 'event' | 'chat';
}

interface Ctx {
  connected: boolean;
  room: RoomStatePayload | null;
  game: GameStatePayload | null;
  events: GameEvent[]; // latest batch, for animations
  log: LogLine[];
  you: number | null;
  error: string | null;
  createRoom(name: string, gameId: string): Promise<string>; // → room code
  joinRoom(code: string, name: string): Promise<JoinResult>;
  leaveRoom(): void;
  configure(gameId: string): void;
  start(): void;
  toLobby(): void;
  kick(playerId: number): void;
  sendAction(action: unknown): void;
  sendChat(text: string): void;
  appendLog(text: string): void;
  clearError(): void;
}

const GameCtx = createContext<Ctx | null>(null);

export function useGame(): Ctx {
  const ctx = useContext(GameCtx);
  if (!ctx) throw new Error('useGame outside provider');
  return ctx;
}

type AckRes<T> = ({ ok: true } & T) | { ok: false; code: string; message: string };

function emitAck<T>(event: string, payload?: unknown): Promise<{ ok: true } & T> {
  return new Promise((resolve, reject) => {
    const cb = (res: AckRes<T>) => {
      if (res && res.ok) resolve(res);
      else reject(new Error(res?.message ?? 'Request failed'));
    };
    if (payload === undefined) socket.emit(event, cb);
    else socket.emit(event, payload, cb);
  });
}

let logId = 0;

export function GameProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [connected, setConnected] = useState(socket.connected);
  const [room, setRoom] = useState<RoomStatePayload | null>(null);
  const [game, setGame] = useState<GameStatePayload | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [log, setLog] = useState<LogLine[]>([]);
  const [you, setYou] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<{ code: string } | null>(null);
  const gameRef = useRef<GameStatePayload | null>(null);

  const appendLog = useCallback((text: string, kind: LogLine['kind'] = 'event') => {
    setLog((l) => [...l.slice(-199), { id: ++logId, text, kind }]);
  }, []);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      // Rejoin after transport-level reconnect (server may have restarted).
      const cur = current.current;
      if (cur) {
        const token = getToken(cur.code) ?? undefined;
        socket.emit('room:join', { code: cur.code, name: getName(), seatToken: token }, (res: AckRes<JoinResult>) => {
          if (res.ok) {
            setYou(res.playerId);
            setRoom(res.room);
          }
        });
      }
    };
    const onDisconnect = () => setConnected(false);
    const onRoom = (p: RoomStatePayload) => setRoom(p);
    const onGame = (p: GameStatePayload) => {
      const prev = gameRef.current;
      if (!prev || p.seq >= prev.seq || p.gameId !== prev.gameId) {
        gameRef.current = p;
        setGame(p);
        setYou(p.you);
      }
    };
    const onEvents = (p: { seq: number; events: GameEvent[] }) => setEvents(p.events);
    const onChat = (p: ChatMessage) => appendLog(`${p.from}: ${p.text}`, 'chat');
    const onSuperseded = () => setError('This seat was opened in another tab — this tab is now inactive.');

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:state', onRoom);
    socket.on('game:state', onGame);
    socket.on('game:events', onEvents);
    socket.on('chat:message', onChat);
    socket.on('session:superseded', onSuperseded);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room:state', onRoom);
      socket.off('game:state', onGame);
      socket.off('game:events', onEvents);
      socket.off('chat:message', onChat);
      socket.off('session:superseded', onSuperseded);
    };
  }, [appendLog]);

  const value = useMemo<Ctx>(
    () => ({
      connected,
      room,
      game,
      events,
      log,
      you,
      error,
      async createRoom(name, gameId) {
        setName(name);
        const res = await emitAck<JoinResult>('room:create', { name, gameId });
        setToken(res.code, res.seatToken);
        current.current = { code: res.code };
        setRoom(res.room);
        setYou(res.playerId);
        gameRef.current = null;
        setGame(null);
        setLog([]);
        return res.code;
      },
      async joinRoom(code, name) {
        setName(name);
        const token = getToken(code) ?? undefined;
        const res = await emitAck<JoinResult>('room:join', { code, name, seatToken: token });
        setToken(res.code, res.seatToken);
        current.current = { code: res.code };
        setRoom(res.room);
        setYou(res.playerId);
        gameRef.current = null;
        setGame(null);
        setLog([]);
        socket.emit('game:sync');
        return res;
      },
      leaveRoom() {
        socket.emit('room:leave');
        current.current = null;
        setRoom(null);
        gameRef.current = null;
        setGame(null);
        setYou(null);
        setLog([]);
      },
      configure(gameId) {
        emitAck('room:configure', { gameId }).catch((e: Error) => setError(e.message));
      },
      start() {
        emitAck('room:start', {}).catch((e: Error) => setError(e.message));
      },
      toLobby() {
        emitAck('room:toLobby', {}).catch((e: Error) => setError(e.message));
      },
      kick(playerId) {
        emitAck('room:kick', { playerId }).catch((e: Error) => setError(e.message));
      },
      sendAction(action) {
        const seq = gameRef.current?.seq ?? 0;
        socket.emit('game:action', { seq, action }, (res: AckRes<Record<never, never>>) => {
          if (!res.ok) setError(res.message);
        });
      },
      sendChat(text) {
        socket.emit('chat:send', { text });
      },
      appendLog,
      clearError() {
        setError(null);
      },
    }),
    [connected, room, game, events, log, you, error, appendLog],
  );

  return <GameCtx.Provider value={value}>{children}</GameCtx.Provider>;
}
