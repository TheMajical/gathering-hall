import type { ChessView } from '@gamehub/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoom, disconnectAll, emitAck, joinRoom, makeClient, startServer, until, type TestClient, type TestServer } from '../helpers.js';

let server: TestServer;
let clients: TestClient[] = [];

afterEach(async () => {
  await disconnectAll(clients);
  clients = [];
  await server?.close();
});

describe('chess end-to-end over real sockets', () => {
  it("two clients play fool's mate to checkmate", async () => {
    server = await startServer();
    const a = makeClient(server.url, 'Anna');
    const b = makeClient(server.url, 'Boris');
    clients = [a, b];
    await createRoom(a, 'chess');
    await joinRoom(b, a.code);
    await emitAck(a.socket, 'room:start', { seed: 11 });
    await until(a, () => a.latestGame?.view !== null && a.latestGame.status.phase === 'playing', 'started');
    await until(b, () => b.latestGame?.view !== null, 'b started');

    const view = a.latestGame!.view as ChessView;
    const whiteSeat = view.whiteSeat;
    // fool's mate: white f3 g4, black e5 Qh4#
    const script: Record<number, { from: string; to: string }[]> = {
      [whiteSeat]: [
        { from: 'f2', to: 'f3' },
        { from: 'g2', to: 'g4' },
      ],
      [1 - whiteSeat]: [
        { from: 'e7', to: 'e5' },
        { from: 'd8', to: 'h4' },
      ],
    };
    const idx: Record<number, number> = { 0: 0, 1: 0 };

    for (let seq = 0; seq < 4; seq++) {
      const lead = a.latestGame!;
      const actorId = lead.currentActors[0]!;
      const actor = [a, b].find((c) => c.playerId === actorId)!;
      await until(actor, () => actor.latestGame?.seq === seq, `actor at seq ${seq}`);
      const move = script[actorId]![idx[actorId]!++]!;
      await emitAck(actor.socket, 'game:action', { seq, action: { type: 'move', ...move } });
      await until(a, () => a.latestGame!.seq === seq + 1, 'applied');
    }

    await until(a, () => a.latestGame!.status.terminal, 'checkmate');
    expect(a.latestGame!.status.winners).toEqual([1 - whiteSeat]);
    const fin = a.latestGame!.view as ChessView;
    expect(fin.san.at(-1)).toContain('#');
    // after checkmate the room is finished — further actions are rejected
    await expect(
      emitAck(a.socket, 'game:action', { seq: a.latestGame!.seq, action: { type: 'move', from: 'e2', to: 'e4' } }),
    ).rejects.toThrow(/NOT_STARTED|ILLEGAL/);
  });

  it('chess rejects a third player and starts only with exactly 2', async () => {
    server = await startServer();
    const a = makeClient(server.url, 'Anna');
    clients = [a];
    await createRoom(a, 'chess');
    await expect(emitAck(a.socket, 'room:start', {})).rejects.toThrow(/BAD_PLAYER_COUNT/);
    const b = makeClient(server.url, 'Boris');
    const c = makeClient(server.url, 'Casper');
    clients.push(b, c);
    await joinRoom(b, a.code);
    await expect(joinRoom(c, a.code)).rejects.toThrow(/ROOM_FULL/);
    await emitAck(a.socket, 'room:start', {});
    await until(a, () => a.latestGame?.status.phase === 'playing', 'started');
  });
});
