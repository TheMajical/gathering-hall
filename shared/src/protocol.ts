/**
 * Typed socket protocol — single source of truth for server and client.
 * Request/response flows use Socket.IO acks; pushes are plain emits.
 */
import type { EngineStatus, GameEvent, PlayerId } from './engine.js';

export const ERR = {
  BAD_REQUEST: 'ERR_BAD_REQUEST',
  ROOM_NOT_FOUND: 'ERR_ROOM_NOT_FOUND',
  ROOM_FULL: 'ERR_ROOM_FULL',
  NOT_HOST: 'ERR_NOT_HOST',
  NOT_IN_ROOM: 'ERR_NOT_IN_ROOM',
  NOT_A_PLAYER: 'ERR_NOT_A_PLAYER',
  BAD_TOKEN: 'ERR_BAD_TOKEN',
  ALREADY_STARTED: 'ERR_ALREADY_STARTED',
  NOT_STARTED: 'ERR_NOT_STARTED',
  BAD_PLAYER_COUNT: 'ERR_BAD_PLAYER_COUNT',
  STALE: 'ERR_STALE',
  NOT_YOUR_TURN: 'ERR_NOT_YOUR_TURN',
  ILLEGAL_ACTION: 'ERR_ILLEGAL_ACTION',
} as const;
export type ErrCode = (typeof ERR)[keyof typeof ERR];

export interface SeatInfo {
  playerId: PlayerId;
  name: string;
  connected: boolean;
}

export type RoomPhase = 'lobby' | 'playing' | 'finished';

export interface RoomStatePayload {
  code: string;
  gameId: string;
  phase: RoomPhase;
  hostId: PlayerId;
  seats: SeatInfo[];
  spectatorCount: number;
  maxPlayers: number;
  minPlayers: number;
}

export interface GameStatePayload {
  seq: number;
  gameId: string;
  /** Per-viewer redacted view. */
  view: unknown;
  /** Legal-action descriptors for THIS viewer ([] for spectators). */
  legalActions: unknown[];
  currentActors: PlayerId[];
  status: EngineStatus;
  /** This viewer's seat, or null for spectators. */
  you: PlayerId | null;
}

export interface GameEventsPayload {
  seq: number;
  events: GameEvent[];
}

export interface ChatMessage {
  from: string;
  playerId: PlayerId | null;
  text: string;
  ts: number;
}

export type Ack<T> = (res: { ok: true } & T | { ok: false; code: ErrCode; message: string }) => void;

export interface JoinResult {
  code: string;
  seatToken: string;
  playerId: PlayerId | null; // null → spectator
  room: RoomStatePayload;
}

/* eslint-disable @typescript-eslint/consistent-type-definitions */
export type ClientToServer = {
  'room:create': (p: { name: string; gameId: string }, ack: Ack<JoinResult>) => void;
  'room:join': (p: { code: string; name: string; seatToken?: string }, ack: Ack<JoinResult>) => void;
  'room:leave': () => void;
  'room:configure': (p: { gameId: string }, ack: Ack<Record<never, never>>) => void;
  'room:start': (p: { seed?: number }, ack: Ack<Record<never, never>>) => void;
  'room:toLobby': (ack: Ack<Record<never, never>>) => void;
  'room:kick': (p: { playerId: PlayerId }, ack: Ack<Record<never, never>>) => void;
  'game:action': (p: { seq: number; action: unknown }, ack: Ack<Record<never, never>>) => void;
  'game:sync': () => void;
  'chat:send': (p: { text: string }) => void;
};

export type ServerToClient = {
  'room:state': (p: RoomStatePayload) => void;
  'game:state': (p: GameStatePayload) => void;
  'game:events': (p: GameEventsPayload) => void;
  'chat:message': (p: ChatMessage) => void;
  'session:superseded': () => void;
};
