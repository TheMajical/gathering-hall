import type { PokerView, ShelemView } from '@gamehub/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createRoom,
  disconnectAll,
  emitAck,
  joinRoom,
  makeClient,
  startServer,
  until,
  type TestClient,
  type TestServer,
} from '../helpers.js';

let server: TestServer;
let clients: TestClient[] = [];

afterEach(async () => {
  await disconnectAll(clients);
  clients = [];
  await server?.close();
});

describe('Shelem end-to-end over real sockets', () => {
  it('4 clients join, start shelem, place bids and advance auction over the wire', async () => {
    server = await startServer();
    const p0 = makeClient(server.url, 'Alice');
    const p1 = makeClient(server.url, 'Bob');
    const p2 = makeClient(server.url, 'Charlie');
    const p3 = makeClient(server.url, 'David');
    clients = [p0, p1, p2, p3];

    await createRoom(p0, 'shelem');
    await joinRoom(p1, p0.code);
    await joinRoom(p2, p0.code);
    await joinRoom(p3, p0.code);

    await emitAck(p0.socket, 'room:start', { seed: 42 });
    await until(p0, () => p0.latestGame?.view !== null && !p0.latestGame.status.terminal, 'started');
    await until(p3, () => p3.latestGame?.view !== null, 'p3 started');

    const v0 = p0.latestGame!.view as ShelemView;
    expect(v0.hand).toHaveLength(12);
    expect(v0.phase).toBe('bidding');

    // First actor bids 100
    const actorId = p0.latestGame!.currentActors[0]!;
    const actor = clients.find((c) => c.playerId === actorId)!;
    await emitAck(actor.socket, 'game:action', { seq: 0, action: { type: 'bid', amount: 100 } });

    // Assert update arrived across all clients
    await until(p0, () => (p0.latestGame!.view as ShelemView).currentBid === 100, 'bid 100 received');
    const updated = p0.latestGame!.view as ShelemView;
    expect(updated.currentBid).toBe(100);
    expect(updated.highestBidder).toBe(actorId);
  });
});

describe('Poker end-to-end over real sockets', () => {
  it('3 clients play a betting round to the flop over real sockets', async () => {
    server = await startServer();
    const p0 = makeClient(server.url, 'Alice');
    const p1 = makeClient(server.url, 'Bob');
    const p2 = makeClient(server.url, 'Charlie');
    clients = [p0, p1, p2];

    await createRoom(p0, 'poker');
    await joinRoom(p1, p0.code);
    await joinRoom(p2, p0.code);

    await emitAck(p0.socket, 'room:start', { seed: 99 });
    await until(p0, () => p0.latestGame?.view !== null && !p0.latestGame.status.terminal, 'poker started');

    const v0 = p0.latestGame!.view as PokerView;
    expect(v0.hand).toHaveLength(2);
    expect(v0.street).toBe('preflop');
    expect(v0.pot).toBe(30); // 10 SB + 20 BB

    // UTG calls 20
    const utgId = p0.latestGame!.currentActors[0]!;
    const utg = clients.find((c) => c.playerId === utgId)!;
    await emitAck(utg.socket, 'game:action', { seq: 0, action: { type: 'call' } });

    await until(p0, () => p0.latestGame!.seq === 1, 'call 1 applied');
    expect((p0.latestGame!.view as PokerView).pot).toBe(50);
  });
});
