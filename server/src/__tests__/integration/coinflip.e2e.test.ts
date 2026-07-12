import type { CoinflipView } from '@gamehub/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoom, disconnectAll, emitAck, joinRoom, makeClient, startServer, until, type TestClient, type TestServer } from '../helpers.js';

let server: TestServer;
let clients: TestClient[] = [];

afterEach(async () => {
  await disconnectAll(clients);
  clients = [];
  await server?.close();
});

describe('coinflip end-to-end over real sockets', () => {
  it('two clients create, join, start, and play to completion', async () => {
    server = await startServer();
    const a = makeClient(server.url, 'Alice');
    const b = makeClient(server.url, 'Bob');
    clients = [a, b];

    await createRoom(a, 'coinflip');
    await joinRoom(b, a.code);
    expect(a.playerId).toBe(0);
    expect(b.playerId).toBe(1);
    await until(a, () => a.latestRoom?.seats.length === 2, 'both seated');

    await emitAck(a.socket, 'room:start', {});
    await until(a, () => a.latestGame?.status.phase === 'playing', 'game started (a)');
    await until(b, () => b.latestGame?.status.phase === 'playing', 'game started (b)');

    // Play until terminal: whichever client is the current actor calls heads.
    let guard = 0;
    for (;;) {
      await until(a, () => a.latestGame !== null, 'state');
      const done = [a, b].some((c) => c.latestGame?.status.terminal);
      if (done) break;
      if (guard++ > 300) throw new Error('game did not finish');
      const actorId = a.latestGame!.currentActors[0];
      const actor = [a, b].find((c) => c.playerId === actorId)!;
      await until(actor, () => actor.latestGame?.currentActors[0] === actorId, 'actor sees own turn');
      await emitAck(actor.socket, 'game:action', {
        seq: actor.latestGame!.seq,
        action: { type: 'call', side: 'heads' },
      });
      await until(a, () => (a.latestGame?.seq ?? 0) > 0, 'progress');
    }

    await until(a, () => a.latestGame!.status.terminal, 'terminal (a)');
    await until(b, () => b.latestGame!.status.terminal, 'terminal (b)');
    const view = a.latestGame!.view as CoinflipView;
    expect(view.winner).not.toBeNull();
    expect(Math.max(...view.scores)).toBe(3);
    await until(a, () => a.latestRoom?.phase === 'finished', 'room finished');
  });

  it('rejects illegal and stale actions with typed errors', async () => {
    server = await startServer();
    const a = makeClient(server.url, 'Alice');
    const b = makeClient(server.url, 'Bob');
    clients = [a, b];
    await createRoom(a, 'coinflip');
    await joinRoom(b, a.code);
    await emitAck(a.socket, 'room:start', {});
    await until(a, () => a.latestGame?.status.phase === 'playing', 'started');

    const actorId = a.latestGame!.currentActors[0]!;
    const other = [a, b].find((c) => c.playerId !== actorId)!;

    // Out-of-turn action → ERR_NOT_YOUR_TURN
    await expect(
      emitAck(other.socket, 'game:action', { seq: other.latestGame?.seq ?? 0, action: { type: 'call', side: 'heads' } }),
    ).rejects.toThrow(/NOT_YOUR_TURN/);

    // Stale seq → ERR_STALE
    const actor = [a, b].find((c) => c.playerId === actorId)!;
    await expect(
      emitAck(actor.socket, 'game:action', { seq: 999, action: { type: 'call', side: 'heads' } }),
    ).rejects.toThrow(/STALE/);

    // Malformed action → typed engine rejection, server stays healthy
    await expect(
      emitAck(actor.socket, 'game:action', { seq: actor.latestGame!.seq, action: { type: 'explode' } }),
    ).rejects.toThrow(/ILLEGAL/);

    // Server still responds normally afterwards.
    await emitAck(actor.socket, 'game:action', {
      seq: actor.latestGame!.seq,
      action: { type: 'call', side: 'tails' },
    });
  });

  it('non-host cannot start; wrong player count rejected', async () => {
    server = await startServer();
    const a = makeClient(server.url, 'Alice');
    const b = makeClient(server.url, 'Bob');
    clients = [a, b];
    await createRoom(a, 'risk');
    await joinRoom(b, a.code);
    await expect(emitAck(b.socket, 'room:start', {})).rejects.toThrow(/NOT_HOST/);
    // risk needs 3-6 players; 2 seated
    await expect(emitAck(a.socket, 'room:start', {})).rejects.toThrow(/BAD_PLAYER_COUNT/);
  });
});
