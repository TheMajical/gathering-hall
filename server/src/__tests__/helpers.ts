import type { GameStatePayload, JoinResult, RoomStatePayload } from '@gamehub/shared';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { createApp, type AppHandles } from '../app.js';

export interface TestServer {
  handles: AppHandles;
  url: string;
  dataDir: string;
  close(): Promise<void>;
}

export async function startServer(dataDir?: string): Promise<TestServer> {
  const dir = dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'gamehub-test-'));
  const handles = createApp({ dataDir: dir });
  await new Promise<void>((resolve) => handles.httpServer.listen(0, resolve));
  const addr = handles.httpServer.address();
  if (typeof addr !== 'object' || !addr) throw new Error('no address');
  return {
    handles,
    dataDir: dir,
    url: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise((resolve) => {
        handles.io.close(() => resolve());
      }),
  };
}

export interface TestClient {
  socket: ClientSocket;
  name: string;
  playerId: number | null;
  seatToken: string;
  code: string;
  latestGame: GameStatePayload | null;
  latestRoom: RoomStatePayload | null;
  waiters: (() => void)[];
}

export function makeClient(url: string, name: string): TestClient {
  const socket = connect(url, { transports: ['websocket'], forceNew: true });
  const c: TestClient = {
    socket,
    name,
    playerId: null,
    seatToken: '',
    code: '',
    latestGame: null,
    latestRoom: null,
    waiters: [],
  };
  const wake = () => c.waiters.splice(0).forEach((w) => w());
  socket.on('game:state', (p: GameStatePayload) => {
    if (!c.latestGame || p.seq >= c.latestGame.seq) c.latestGame = p;
    wake();
  });
  socket.on('room:state', (p: RoomStatePayload) => {
    c.latestRoom = p;
    wake();
  });
  return c;
}

export async function until(c: TestClient, pred: () => boolean, what = 'condition', ms = 30_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${what} (client ${c.name})`);
    await new Promise<void>((resolve) => {
      c.waiters.push(resolve);
      setTimeout(resolve, 250);
    });
  }
}

export function emitAck<T>(socket: ClientSocket, event: string, ...args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    socket.emit(event, ...args, (res: { ok: boolean; message?: string; code?: string } & T) => {
      if (res && res.ok) resolve(res);
      else reject(new Error(`${event} failed: ${res?.code}: ${res?.message}`));
    });
  });
}

export async function createRoom(c: TestClient, gameId: string): Promise<void> {
  const res = await emitAck<JoinResult & { ok: true }>(c.socket, 'room:create', { name: c.name, gameId });
  c.code = res.code;
  c.seatToken = res.seatToken;
  c.playerId = res.playerId;
}

export async function joinRoom(c: TestClient, code: string, seatToken?: string): Promise<void> {
  const res = await emitAck<JoinResult & { ok: true }>(c.socket, 'room:join', {
    code,
    name: c.name,
    ...(seatToken ? { seatToken } : {}),
  });
  c.code = res.code;
  c.seatToken = res.seatToken || c.seatToken;
  c.playerId = res.playerId;
}

export async function disconnectAll(clients: TestClient[]): Promise<void> {
  for (const c of clients) c.socket.disconnect();
}
