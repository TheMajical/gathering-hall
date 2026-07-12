import { afterEach, describe, expect, it } from 'vitest';
import { createRoom, disconnectAll, emitAck, joinRoom, makeClient, startServer, until, type TestClient, type TestServer } from '../helpers.js';

let server: TestServer;
let clients: TestClient[] = [];

afterEach(async () => {
  await disconnectAll(clients);
  clients = [];
  await server?.close();
});

describe('reconnection & session handling', () => {
  it('a disconnected player rejoins with their seat token and receives full current state', async () => {
    server = await startServer();
    const a = makeClient(server.url, 'Alice');
    const b = makeClient(server.url, 'Bob');
    clients = [a, b];
    await createRoom(a, 'coinflip');
    await joinRoom(b, a.code);
    await emitAck(a.socket, 'room:start', {});
    await until(b, () => b.latestGame?.status.phase === 'playing', 'started');

    // Advance the game one action so state is mid-game.
    await until(a, () => a.latestGame !== null, 'state');
    const actorId = a.latestGame!.currentActors[0]!;
    const actor = [a, b].find((c) => c.playerId === actorId)!;
    await emitAck(actor.socket, 'game:action', { seq: actor.latestGame!.seq, action: { type: 'call', side: 'heads' } });
    await until(a, () => a.latestGame!.seq === 1, 'seq 1');

    // Bob drops.
    const bobToken = b.seatToken;
    const bobSeat = b.playerId;
    b.socket.disconnect();
    await until(a, () => a.latestRoom?.seats.find((s) => s.playerId === bobSeat)?.connected === false, 'bob shown disconnected');

    // Bob returns on a NEW socket with his token.
    const b2 = makeClient(server.url, 'Bob');
    clients.push(b2);
    await joinRoom(b2, a.code, bobToken);
    expect(b2.playerId).toBe(bobSeat); // same seat reclaimed
    await until(b2, () => b2.latestGame?.seq === 1, 'rejoiner got current state');
    expect(b2.latestGame!.you).toBe(bobSeat);
    await until(a, () => a.latestRoom?.seats.find((s) => s.playerId === bobSeat)?.connected === true, 'bob shown connected');

    // Bob can act again when it's his turn.
    if (b2.latestGame!.currentActors[0] === bobSeat) {
      await emitAck(b2.socket, 'game:action', { seq: b2.latestGame!.seq, action: { type: 'call', side: 'tails' } });
    }
  });

  it('a second tab with the same token supersedes the first', async () => {
    server = await startServer();
    const a = makeClient(server.url, 'Alice');
    const b = makeClient(server.url, 'Bob');
    clients = [a, b];
    await createRoom(a, 'coinflip');
    await joinRoom(b, a.code);

    let superseded = false;
    a.socket.on('session:superseded', () => {
      superseded = true;
    });

    const a2 = makeClient(server.url, 'Alice');
    clients.push(a2);
    await joinRoom(a2, a.code, a.seatToken);
    expect(a2.playerId).toBe(0);
    await until(a2, () => superseded, 'old session notified');

    // The new socket is the host now: it can start the game.
    await emitAck(a2.socket, 'room:start', {});
    await until(a2, () => a2.latestGame?.status.phase === 'playing', 'new tab controls the seat');
  });

  it('a stranger joining a started game becomes a spectator with a redacted view', async () => {
    server = await startServer();
    const a = makeClient(server.url, 'Alice');
    const b = makeClient(server.url, 'Bob');
    clients = [a, b];
    await createRoom(a, 'coinflip');
    await joinRoom(b, a.code);
    await emitAck(a.socket, 'room:start', {});

    const s = makeClient(server.url, 'Snoop');
    clients.push(s);
    await joinRoom(s, a.code);
    expect(s.playerId).toBeNull();
    await until(s, () => s.latestGame !== null, 'spectator state');
    expect(s.latestGame!.you).toBeNull();
    expect(s.latestGame!.legalActions).toEqual([]);

    // Spectators cannot act.
    await expect(
      emitAck(s.socket, 'game:action', { seq: s.latestGame!.seq, action: { type: 'call', side: 'heads' } }),
    ).rejects.toThrow(/NOT_A_PLAYER/);
  });

  it('lobby leave frees the seat and renumbers; empty rooms are deleted', async () => {
    server = await startServer();
    const a = makeClient(server.url, 'Alice');
    const b = makeClient(server.url, 'Bob');
    const c = makeClient(server.url, 'Cara');
    clients = [a, b, c];
    await createRoom(a, 'risk');
    await joinRoom(b, a.code);
    await joinRoom(c, a.code);
    await until(a, () => a.latestRoom?.seats.length === 3, 'three seated');

    b.socket.emit('room:leave');
    await until(a, () => a.latestRoom?.seats.length === 2, 'seat freed');
    expect(a.latestRoom!.seats.map((s) => s.name)).toEqual(['Alice', 'Cara']);

    const code = a.code;
    a.socket.emit('room:leave');
    c.socket.emit('room:leave');
    await until(a, () => server.handles.rooms.rooms.get(code) === undefined, 'room deleted', 10_000);
  });
});
