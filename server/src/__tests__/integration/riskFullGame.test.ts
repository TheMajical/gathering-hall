/**
 * Four socket.io clients play a complete seeded game of Risk to a winner,
 * acting ONLY on what a real client receives (per-player view + legal-action
 * descriptors) — including one mid-game disconnect/reconnect. This exercises
 * the entire stack: protocol, room manager, engine hosting, seq handling.
 */
import { Rng, TERRITORIES, type RiskAction, type RiskLegal, type RiskView } from '@gamehub/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoom, disconnectAll, emitAck, joinRoom, makeClient, startServer, until, type TestClient, type TestServer } from '../helpers.js';

let server: TestServer;
let clients: TestClient[] = [];

afterEach(async () => {
  await disconnectAll(clients);
  clients = [];
  await server?.close();
});

/** Client-side bot: mirrors shared/bot.ts policy but reads only view + legal descriptors. */
function pickFromView(view: RiskView, legal: RiskLegal[], rand: () => number): RiskAction | null {
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
  const trade = legal.find((l): l is Extract<RiskLegal, { type: 'trade' }> => l.type === 'trade');
  if (trade && trade.sets.length > 0) return { type: 'trade', cards: pick(trade.sets) };

  const place = legal.find((l): l is Extract<RiskLegal, { type: 'place' }> => l.type === 'place');
  if (place) {
    const me = view.territories[place.territories[0]!]!.owner;
    const frontier = place.territories.filter((tid) =>
      TERRITORIES[tid]!.adjacent.some((nb) => view.territories[nb]!.owner !== me),
    );
    const target = frontier.length > 0 ? pick(frontier) : pick(place.territories);
    return { type: 'place', territoryId: target, count: place.remaining };
  }

  const move = legal.find((l): l is Extract<RiskLegal, { type: 'moveArmies' }> => l.type === 'moveArmies');
  if (move) return { type: 'moveArmies', count: rand() < 0.8 ? move.max : Math.floor(rand() * (move.max + 1)) };

  const attack = legal.find((l): l is Extract<RiskLegal, { type: 'attack' }> => l.type === 'attack');
  if (attack) {
    const favorable = attack.options.filter(
      (o) => view.territories[o.from]!.armies > view.territories[o.to]!.armies + 1,
    );
    if (favorable.length > 0) {
      const o = pick(favorable);
      return { type: 'attack', from: o.from, to: o.to, dice: o.maxDice, blitz: true };
    }
    if (rand() < 0.15) {
      const o = pick(attack.options);
      return { type: 'attack', from: o.from, to: o.to, dice: o.maxDice, blitz: true };
    }
  }

  if (legal.some((l) => l.type === 'endReinforce')) return { type: 'endReinforce' };
  if (legal.some((l) => l.type === 'endAttack')) return { type: 'endAttack' };
  const fortify = legal.find((l): l is Extract<RiskLegal, { type: 'fortify' }> => l.type === 'fortify');
  if (fortify && rand() < 0.5) {
    const o = pick(fortify.options);
    return { type: 'fortify', from: o.from, to: pick(o.targets), count: o.max };
  }
  if (legal.some((l) => l.type === 'endTurn')) return { type: 'endTurn' };
  return null;
}

describe('full Risk game over real sockets', () => {
  it('4 players (bots) play a seeded game to a winner, with one mid-game reconnect', async () => {
    server = await startServer();
    const names = ['Alice', 'Bob', 'Cara', 'Dan'];
    const a = makeClient(server.url, names[0]!);
    clients = [a];
    await createRoom(a, 'risk');
    for (let i = 1; i < 4; i++) {
      const c = makeClient(server.url, names[i]!);
      clients.push(c);
      await joinRoom(c, a.code);
    }
    await until(a, () => a.latestRoom?.seats.length === 4, 'all seated');
    await emitAck(a.socket, 'room:start', { seed: 20260709 });
    for (const c of clients) await until(c, () => c.latestGame?.status.phase !== undefined && c.latestGame.view !== null, 'started');

    const botRng = new Rng(777);
    const rand = () => botRng.next();
    let steps = 0;
    let reconnected = false;
    const MAX = 100_000;

    for (;;) {
      // Wait until every connected client agrees on the latest seq (any one suffices to read actors).
      const lead = clients.find((c) => c.socket.connected && c.latestGame)!;
      if (lead.latestGame!.status.terminal) break;
      if (++steps > MAX) throw new Error(`no winner after ${MAX} actions`);

      const seq = lead.latestGame!.seq;
      const actorId = lead.latestGame!.currentActors[0];
      expect(actorId).toBeDefined();
      const actor = clients.find((c) => c.playerId === actorId && c.socket.connected);
      if (!actor) throw new Error(`actor p${actorId} has no connected client`);
      await until(actor, () => (actor.latestGame?.seq ?? -1) >= seq, `actor sync at seq ${seq}`);
      if (actor.latestGame!.status.terminal) break;

      const view = actor.latestGame!.view as RiskView;
      const legal = actor.latestGame!.legalActions as RiskLegal[];
      const action = pickFromView(view, legal, rand);
      if (!action) throw new Error(`bot p${actorId} has no action in phase ${view.phase} at seq ${actor.latestGame!.seq}`);
      await emitAck(actor.socket, 'game:action', { seq: actor.latestGame!.seq, action });
      await until(actor, () => (actor.latestGame?.seq ?? -1) > seq, 'action applied');

      // Once, mid-game: hard-drop a NON-acting player and reclaim the seat by token.
      if (!reconnected && steps === 60) {
        const victim = clients.find((c) => c.playerId !== actorId && c.playerId !== null)!;
        const token = victim.seatToken;
        const seatId = victim.playerId!;
        victim.socket.disconnect();
        const fresh = makeClient(server.url, `${victim.name}-back`);
        clients.push(fresh);
        await joinRoom(fresh, a.code, token);
        expect(fresh.playerId).toBe(seatId);
        await until(fresh, () => fresh.latestGame !== null && fresh.latestGame.seq >= seq, 'rejoiner synced');
        // replace the victim in our roster so the bot loop uses the new socket
        clients = clients.filter((c) => c !== victim);
        reconnected = true;
      }
    }

    const winnerView = clients.find((c) => c.socket.connected)!.latestGame!;
    expect(winnerView.status.terminal).toBe(true);
    expect(winnerView.status.winners).toHaveLength(1);
    expect(reconnected).toBe(true);
    // Room flips to finished for everyone connected.
    for (const c of clients.filter((c) => c.socket.connected)) {
      await until(c, () => c.latestRoom?.phase === 'finished', 'room finished');
    }
  }, 300_000);
});
