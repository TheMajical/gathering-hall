/**
 * Rooms, seats, seat-token reconnection, and authoritative engine hosting.
 * All game mutations flow through applyAction(); every mutation schedules a
 * debounced snapshot.
 */
import {
  ERR,
  getGameSpec,
  isEngineError,
  randomSeed,
  type ErrCode,
  type GameSpec,
  type GameStatePayload,
  type PlayerId,
  type RoomStatePayload,
} from '@gamehub/shared';
import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { Persistence, SCHEMA_VERSION, type RoomSnapshot } from './persistence.js';

const MAX_ROOMS = 50;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L

export interface Seat {
  playerId: PlayerId;
  name: string;
  token: string;
  socketId: string | null;
}

export interface Room {
  code: string;
  gameId: string;
  phase: 'lobby' | 'playing' | 'finished';
  seats: Seat[];
  /** socketIds of spectators. */
  spectators: Set<string>;
  state: unknown | null;
  seq: number;
  createdAt: number;
}

export class Fail extends Error {
  constructor(
    public code: ErrCode,
    message: string,
  ) {
    super(message);
  }
}

interface SocketRef {
  code: string;
  playerId: PlayerId | null; // null → spectator
}

export class RoomManager {
  rooms = new Map<string, Room>();
  private bySocket = new Map<string, SocketRef>();

  constructor(
    private io: Server,
    private persistence: Persistence,
  ) {
    for (const snap of persistence.restore()) {
      this.rooms.set(snap.code, {
        code: snap.code,
        gameId: snap.gameId,
        phase: snap.phase,
        seats: snap.seats.map((s) => ({ ...s, socketId: null })),
        spectators: new Set(),
        state: snap.state,
        seq: snap.seq,
        createdAt: snap.savedAt,
      });
    }
    if (this.rooms.size > 0) console.log(`[rooms] restored ${this.rooms.size} room(s) from disk`);
  }

  // ---------- helpers ----------

  private spec(room: Room): GameSpec {
    const spec = getGameSpec(room.gameId);
    if (!spec) throw new Fail(ERR.BAD_REQUEST, `Unknown game ${room.gameId}`);
    return spec;
  }

  private snapshotOf(room: Room): () => RoomSnapshot {
    return () => ({
      schemaVersion: SCHEMA_VERSION,
      code: room.code,
      gameId: room.gameId,
      engineVersion: getGameSpec(room.gameId)?.engineVersion ?? 0,
      phase: room.phase,
      seats: room.seats.map(({ playerId, name, token }) => ({ playerId, name, token })),
      state: room.state,
      seq: room.seq,
      savedAt: Date.now(),
    });
  }

  private save(room: Room): void {
    this.persistence.scheduleSave(room.code, this.snapshotOf(room));
  }

  roomOf(socket: Socket): { room: Room; ref: SocketRef } {
    const ref = this.bySocket.get(socket.id);
    const room = ref && this.rooms.get(ref.code);
    if (!ref || !room) throw new Fail(ERR.NOT_IN_ROOM, 'You are not in a room.');
    return { room, ref };
  }

  private seatOf(room: Room, playerId: PlayerId | null): Seat {
    const seat = room.seats.find((s) => s.playerId === playerId);
    if (!seat) throw new Fail(ERR.NOT_A_PLAYER, 'You are a spectator.');
    return seat;
  }

  roomState(room: Room): RoomStatePayload {
    const spec = this.spec(room);
    return {
      code: room.code,
      gameId: room.gameId,
      phase: room.phase,
      hostId: room.seats[0]?.playerId ?? 0,
      seats: room.seats.map((s) => ({ playerId: s.playerId, name: s.name, connected: s.socketId !== null })),
      spectatorCount: room.spectators.size,
      maxPlayers: spec.maxPlayers,
      minPlayers: spec.minPlayers,
    };
  }

  gameState(room: Room, viewer: PlayerId | null): GameStatePayload {
    const spec = this.spec(room);
    const v = viewer === null ? ('spectator' as const) : viewer;
    return {
      seq: room.seq,
      gameId: room.gameId,
      view: room.state === null ? null : spec.engine.view(room.state as never, v),
      legalActions:
        room.state === null || viewer === null || room.phase !== 'playing'
          ? []
          : spec.engine.getLegalActions(room.state as never, viewer),
      currentActors: room.state === null ? [] : spec.engine.getCurrentActors(room.state as never),
      status:
        room.state === null
          ? { phase: 'lobby', terminal: false, winners: [], eliminated: [] }
          : spec.engine.status(room.state as never),
      you: viewer,
    };
  }

  broadcastRoom(room: Room): void {
    this.io.to(room.code).emit('room:state', this.roomState(room));
  }

  broadcastGame(room: Room): void {
    for (const seat of room.seats) {
      if (seat.socketId) this.io.to(seat.socketId).emit('game:state', this.gameState(room, seat.playerId));
    }
    for (const sid of room.spectators) {
      this.io.to(sid).emit('game:state', this.gameState(room, null));
    }
  }

  // ---------- lobby operations ----------

  create(socket: Socket, name: string, gameId: string): { room: Room; seat: Seat } {
    if (this.rooms.size >= MAX_ROOMS) throw new Fail(ERR.BAD_REQUEST, 'Server is at room capacity.');
    const spec = getGameSpec(gameId);
    if (!spec) throw new Fail(ERR.BAD_REQUEST, `Unknown game: ${gameId}`);
    let code: string;
    do {
      code = Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(code));
    const room: Room = {
      code,
      gameId,
      phase: 'lobby',
      seats: [],
      spectators: new Set(),
      state: null,
      seq: 0,
      createdAt: Date.now(),
    };
    this.rooms.set(code, room);
    const seat = this.addSeat(room, socket, name);
    this.save(room);
    return { room, seat };
  }

  join(
    socket: Socket,
    code: string,
    name: string,
    token?: string,
  ): { room: Room; seat: Seat | null } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) throw new Fail(ERR.ROOM_NOT_FOUND, 'No room with that code.');

    // Reconnect with a valid seat token → rebind, superseding any old socket.
    if (token) {
      const seat = room.seats.find((s) => s.token === token);
      if (seat) {
        if (seat.socketId && seat.socketId !== socket.id) {
          const old = this.io.sockets.sockets.get(seat.socketId);
          if (old) {
            old.emit('session:superseded');
            this.bySocket.delete(old.id);
            void old.leave(room.code);
          }
        }
        seat.socketId = socket.id;
        if (name.trim()) seat.name = name.trim().slice(0, 24);
        this.bindSocket(socket, room, seat.playerId);
        this.broadcastRoom(room);
        this.save(room);
        return { room, seat };
      }
      // Unknown token: fall through (fresh join or spectator).
    }

    if (room.phase === 'lobby') {
      const spec = this.spec(room);
      if (room.seats.length >= spec.maxPlayers) throw new Fail(ERR.ROOM_FULL, 'Room is full.');
      const seat = this.addSeat(room, socket, name);
      this.save(room);
      return { room, seat };
    }

    // Game already running → spectator.
    room.spectators.add(socket.id);
    this.bindSocket(socket, room, null);
    this.broadcastRoom(room);
    return { room, seat: null };
  }

  private addSeat(room: Room, socket: Socket, name: string): Seat {
    const seat: Seat = {
      playerId: room.seats.length,
      name: (name.trim() || 'Settler').slice(0, 24),
      token: randomUUID(),
      socketId: socket.id,
    };
    room.seats.push(seat);
    this.bindSocket(socket, room, seat.playerId);
    this.broadcastRoom(room);
    return seat;
  }

  private bindSocket(socket: Socket, room: Room, playerId: PlayerId | null): void {
    this.bySocket.set(socket.id, { code: room.code, playerId });
    void socket.join(room.code);
  }

  leave(socket: Socket): void {
    const ref = this.bySocket.get(socket.id);
    if (!ref) return;
    const room = this.rooms.get(ref.code);
    this.bySocket.delete(socket.id);
    if (!room) return;
    void socket.leave(room.code);
    if (ref.playerId === null) {
      room.spectators.delete(socket.id);
      this.broadcastRoom(room);
      return;
    }
    if (room.phase === 'lobby') {
      // Explicit lobby leave removes the seat and renumbers.
      room.seats = room.seats.filter((s) => s.playerId !== ref.playerId);
      room.seats.forEach((s, i) => {
        s.playerId = i;
        if (s.socketId) {
          const ref2 = this.bySocket.get(s.socketId);
          if (ref2) ref2.playerId = i;
        }
      });
      if (room.seats.length === 0) {
        this.rooms.delete(room.code);
        this.persistence.delete(room.code);
        return;
      }
      // Re-issue identities after renumbering.
      for (const s of room.seats) {
        if (s.socketId) this.io.to(s.socketId).emit('game:state', this.gameState(room, s.playerId));
      }
      this.save(room);
      this.broadcastRoom(room);
    } else {
      // Mid-game "leave" is just a disconnect; the seat stays reclaimable.
      const seat = this.seatOf(room, ref.playerId);
      seat.socketId = null;
      this.broadcastRoom(room);
    }
  }

  disconnect(socket: Socket): void {
    const ref = this.bySocket.get(socket.id);
    if (!ref) return;
    const room = this.rooms.get(ref.code);
    this.bySocket.delete(socket.id);
    if (!room) return;
    if (ref.playerId === null) {
      room.spectators.delete(socket.id);
    } else {
      const seat = room.seats.find((s) => s.playerId === ref.playerId);
      if (seat && seat.socketId === socket.id) seat.socketId = null;
    }
    this.broadcastRoom(room);
  }

  configure(socket: Socket, gameId: string): void {
    const { room, ref } = this.roomOf(socket);
    this.requireHost(room, ref);
    if (room.phase !== 'lobby') throw new Fail(ERR.ALREADY_STARTED, 'Game already started.');
    if (!getGameSpec(gameId)) throw new Fail(ERR.BAD_REQUEST, `Unknown game: ${gameId}`);
    room.gameId = gameId;
    this.save(room);
    this.broadcastRoom(room);
  }

  start(socket: Socket, seed?: number): void {
    const { room, ref } = this.roomOf(socket);
    this.requireHost(room, ref);
    if (room.phase !== 'lobby') throw new Fail(ERR.ALREADY_STARTED, 'Game already started.');
    const spec = this.spec(room);
    const n = room.seats.length;
    if (n < spec.minPlayers || n > spec.maxPlayers) {
      throw new Fail(ERR.BAD_PLAYER_COUNT, `${spec.name} needs ${spec.minPlayers}-${spec.maxPlayers} players (have ${n}).`);
    }
    room.state = spec.engine.setup({ numPlayers: n, seed: seed ?? randomSeed() });
    room.seq = 0;
    room.phase = 'playing';
    this.save(room);
    this.broadcastRoom(room);
    this.broadcastGame(room);
  }

  toLobby(socket: Socket): void {
    const { room, ref } = this.roomOf(socket);
    this.requireHost(room, ref);
    room.phase = 'lobby';
    room.state = null;
    room.seq = 0;
    this.save(room);
    this.broadcastRoom(room);
    this.broadcastGame(room);
  }

  kick(socket: Socket, playerId: PlayerId): void {
    const { room, ref } = this.roomOf(socket);
    this.requireHost(room, ref);
    const seat = room.seats.find((s) => s.playerId === playerId);
    if (!seat) throw new Fail(ERR.BAD_REQUEST, 'No such player.');
    if (seat.socketId) throw new Fail(ERR.BAD_REQUEST, 'Player is still connected.');
    if (room.phase === 'playing') {
      // Kicking an abandoned seat = forcing their resignation.
      this.applySeatAction(room, playerId, { type: 'resign' });
    } else if (room.phase === 'lobby') {
      room.seats = room.seats.filter((s) => s.playerId !== playerId);
      room.seats.forEach((s, i) => {
        s.playerId = i;
        if (s.socketId) {
          const r = this.bySocket.get(s.socketId);
          if (r) r.playerId = i;
        }
      });
      this.save(room);
      this.broadcastRoom(room);
    }
  }

  private requireHost(room: Room, ref: SocketRef): void {
    if (ref.playerId === null || ref.playerId !== (room.seats[0]?.playerId ?? -1)) {
      throw new Fail(ERR.NOT_HOST, 'Only the host can do that.');
    }
  }

  // ---------- game actions ----------

  action(socket: Socket, seq: number, actionRaw: unknown): void {
    const { room, ref } = this.roomOf(socket);
    if (room.phase !== 'playing') throw new Fail(ERR.NOT_STARTED, 'No game in progress.');
    if (ref.playerId === null) throw new Fail(ERR.NOT_A_PLAYER, 'Spectators cannot act.');
    if (seq !== room.seq) {
      // Stale client — resync it before failing the action.
      socket.emit('game:state', this.gameState(room, ref.playerId));
      throw new Fail(ERR.STALE, 'Your view was out of date — try again.');
    }
    this.applySeatAction(room, ref.playerId, actionRaw);
  }

  private applySeatAction(room: Room, playerId: PlayerId, actionRaw: unknown): void {
    const spec = this.spec(room);
    const result = spec.engine.reduce(room.state as never, actionRaw as never, playerId);
    if (isEngineError(result)) {
      throw new Fail(
        result.code === 'ERR_NOT_YOUR_TURN' ? ERR.NOT_YOUR_TURN : ERR.ILLEGAL_ACTION,
        result.message,
      );
    }
    room.state = result.state;
    room.seq++;
    if (spec.engine.status(room.state as never).terminal) room.phase = 'finished';
    this.save(room);
    if (result.events.length > 0) {
      this.io.to(room.code).emit('game:events', { seq: room.seq, events: result.events });
    }
    this.broadcastGame(room);
    if (room.phase === 'finished') this.broadcastRoom(room);
  }
}
