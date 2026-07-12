import { afterEach, describe, expect, it } from 'vitest';
import { createRoom, disconnectAll, emitAck, joinRoom, makeClient, startServer, until, type TestClient, type TestServer } from '../helpers.js';

let servers: TestServer[] = [];
let clients: TestClient[] = [];

afterEach(async () => {
  await disconnectAll(clients);
  clients = [];
  for (const s of servers) await s.close();
  servers = [];
});

describe('snapshot persistence', () => {
  it('a mid-game room survives a server restart and players rejoin by token', async () => {
    const s1 = await startServer();
    servers.push(s1);
    const a = makeClient(s1.url, 'Alice');
    const b = makeClient(s1.url, 'Bob');
    clients = [a, b];
    await createRoom(a, 'coinflip');
    await joinRoom(b, a.code);
    await emitAck(a.socket, 'room:start', { seed: 42 });
    await until(a, () => a.latestGame?.status.phase === 'playing', 'started');

    // Play two actions.
    for (let i = 0; i < 2; i++) {
      await until(a, () => a.latestGame!.seq === i, `seq ${i}`);
      const actorId = a.latestGame!.currentActors[0]!;
      const actor = [a, b].find((c) => c.playerId === actorId)!;
      await until(actor, () => actor.latestGame?.seq === i, 'actor synced');
      await emitAck(actor.socket, 'game:action', { seq: i, action: { type: 'call', side: 'heads' } });
    }
    await until(a, () => a.latestGame!.seq === 2, 'seq 2');
    const code = a.code;

    // "Crash-stop" the server: flush pending snapshots, close sockets.
    s1.handles.persistence.flushAllSync();
    await s1.close();

    // Boot a fresh server instance on the SAME data dir.
    const s2 = await startServer(s1.dataDir);
    servers.push(s2);
    expect(s2.handles.rooms.rooms.has(code)).toBe(true);

    // Both players reclaim their seats by token and see the exact same seq.
    const a2 = makeClient(s2.url, 'Alice');
    const b2 = makeClient(s2.url, 'Bob');
    clients.push(a2, b2);
    await joinRoom(a2, code, a.seatToken);
    await joinRoom(b2, code, b.seatToken);
    expect(a2.playerId).toBe(a.playerId);
    expect(b2.playerId).toBe(b.playerId);
    await until(a2, () => a2.latestGame?.seq === 2, 'restored seq');
    expect(a2.latestGame!.status.phase).toBe('playing');

    // The game continues on the restored server.
    const actorId = a2.latestGame!.currentActors[0]!;
    const actor = [a2, b2].find((c) => c.playerId === actorId)!;
    await until(actor, () => actor.latestGame?.seq === 2, 'actor synced');
    await emitAck(actor.socket, 'game:action', { seq: 2, action: { type: 'call', side: 'tails' } });
    await until(a2, () => a2.latestGame!.seq === 3, 'game continues');
  });

  it('corrupt snapshots are dropped without crashing the boot', async () => {
    const s1 = await startServer();
    servers.push(s1);
    const fs = await import('node:fs');
    const path = await import('node:path');
    fs.writeFileSync(path.join(s1.dataDir, 'room-BROKEN.json'), '{not json!!!');
    fs.writeFileSync(
      path.join(s1.dataDir, 'room-OLDVER.json'),
      JSON.stringify({ schemaVersion: 999, code: 'OLDVER', gameId: 'coinflip', engineVersion: 1, phase: 'playing', seats: [], state: {}, seq: 5, savedAt: Date.now() }),
    );
    const s2 = await startServer(s1.dataDir);
    servers.push(s2);
    expect(s2.handles.rooms.rooms.has('BROKEN')).toBe(false);
    expect(s2.handles.rooms.rooms.has('OLDVER')).toBe(false);
    // both files cleaned up
    expect(fs.existsSync(path.join(s1.dataDir, 'room-BROKEN.json'))).toBe(false);
    expect(fs.existsSync(path.join(s1.dataDir, 'room-OLDVER.json'))).toBe(false);
  });
});
