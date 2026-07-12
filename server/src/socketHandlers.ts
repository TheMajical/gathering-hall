/**
 * Wires the socket protocol to the RoomManager. Every handler is wrapped so
 * a Fail (or unexpected error) becomes a typed ack / error emit — a client
 * can never crash the server with a malformed payload.
 */
import { ERR, type Ack, type JoinResult } from '@gamehub/shared';
import type { Server, Socket } from 'socket.io';
import { Fail, RoomManager } from './roomManager.js';

type AnyAck = Ack<Record<string, unknown>>;

function failToAck(e: unknown, ack?: AnyAck): void {
  const code = e instanceof Fail ? e.code : ERR.BAD_REQUEST;
  const message = e instanceof Error ? e.message : 'Bad request.';
  if (!(e instanceof Fail)) console.error('[socket] unexpected error:', e);
  if (typeof ack === 'function') ack({ ok: false, code, message });
}

function guard(fn: (...args: never[]) => void): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    const maybeAck = args[args.length - 1];
    const ack = typeof maybeAck === 'function' ? (maybeAck as AnyAck) : undefined;
    try {
      (fn as (...a: unknown[]) => void)(...args);
    } catch (e) {
      failToAck(e, ack);
    }
  };
}

export function attachHandlers(io: Server, rooms: RoomManager): void {
  io.on('connection', (socket: Socket) => {
    socket.on(
      'room:create',
      guard((p: { name?: string; gameId?: string }, ack: Ack<JoinResult>) => {
        if (typeof ack !== 'function') return;
        const { room, seat } = rooms.create(socket, String(p?.name ?? ''), String(p?.gameId ?? 'risk'));
        ack({ ok: true, code: room.code, seatToken: seat.token, playerId: seat.playerId, room: rooms.roomState(room) });
        socket.emit('game:state', rooms.gameState(room, seat.playerId));
      }),
    );

    socket.on(
      'room:join',
      guard((p: { code?: string; name?: string; seatToken?: string }, ack: Ack<JoinResult>) => {
        if (typeof ack !== 'function') return;
        const { room, seat } = rooms.join(
          socket,
          String(p?.code ?? ''),
          String(p?.name ?? ''),
          typeof p?.seatToken === 'string' ? p.seatToken : undefined,
        );
        ack({
          ok: true,
          code: room.code,
          seatToken: seat?.token ?? '',
          playerId: seat?.playerId ?? null,
          room: rooms.roomState(room),
        });
        socket.emit('game:state', rooms.gameState(room, seat?.playerId ?? null));
      }),
    );

    socket.on('room:leave', guard(() => rooms.leave(socket)));

    socket.on(
      'room:configure',
      guard((p: { gameId?: string }, ack: AnyAck) => {
        rooms.configure(socket, String(p?.gameId ?? ''));
        if (typeof ack === 'function') ack({ ok: true });
      }),
    );

    socket.on(
      'room:start',
      guard((p: { seed?: number }, ack: AnyAck) => {
        rooms.start(socket, typeof p?.seed === 'number' ? p.seed : undefined);
        if (typeof ack === 'function') ack({ ok: true });
      }),
    );

    socket.on(
      'room:toLobby',
      guard((ack: AnyAck) => {
        rooms.toLobby(socket);
        if (typeof ack === 'function') ack({ ok: true });
      }),
    );

    socket.on(
      'room:kick',
      guard((p: { playerId?: number }, ack: AnyAck) => {
        rooms.kick(socket, Number(p?.playerId));
        if (typeof ack === 'function') ack({ ok: true });
      }),
    );

    socket.on(
      'game:action',
      guard((p: { seq?: number; action?: unknown }, ack: AnyAck) => {
        rooms.action(socket, Number(p?.seq), p?.action);
        if (typeof ack === 'function') ack({ ok: true });
      }),
    );

    socket.on(
      'game:sync',
      guard(() => {
        const { room, ref } = rooms.roomOf(socket);
        socket.emit('room:state', rooms.roomState(room));
        socket.emit('game:state', rooms.gameState(room, ref.playerId));
      }),
    );

    socket.on(
      'chat:send',
      guard((p: { text?: string }) => {
        const { room, ref } = rooms.roomOf(socket);
        const text = String(p?.text ?? '').trim().slice(0, 500);
        if (!text) return;
        const seat = room.seats.find((s) => s.playerId === ref.playerId);
        io.to(room.code).emit('chat:message', {
          from: seat?.name ?? 'Spectator',
          playerId: ref.playerId,
          text,
          ts: Date.now(),
        });
      }),
    );

    socket.on('disconnect', () => rooms.disconnect(socket));
  });
}
