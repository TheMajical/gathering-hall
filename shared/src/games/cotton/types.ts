import type { PlayerId, ResignAction } from '../../engine.js';
import type { PortDef } from './geometry.js';

export type Resource = 'brick' | 'lumber' | 'wool' | 'grain' | 'ore';
export const RESOURCES: Resource[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];
export type Terrain = Resource | 'desert';

export type ResourceCounts = Record<Resource, number>;
export const zeroRes = (): ResourceCounts => ({ brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 });
export const totalRes = (r: ResourceCounts): number => RESOURCES.reduce((s, k) => s + r[k], 0);

export type DevCard = 'knight' | 'vp' | 'roadBuilding' | 'yearOfPlenty' | 'monopoly';
export type DevCounts = Record<DevCard, number>;
export const zeroDev = (): DevCounts => ({ knight: 0, vp: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 });

export const COSTS: Record<'road' | 'settlement' | 'city' | 'dev', Partial<ResourceCounts>> = {
  road: { brick: 1, lumber: 1 },
  settlement: { brick: 1, lumber: 1, wool: 1, grain: 1 },
  city: { ore: 3, grain: 2 },
  dev: { ore: 1, wool: 1, grain: 1 },
};

export const LIMITS = { settlements: 5, cities: 4, roads: 15 } as const;
export const VICTORY_POINTS = 10;
export const HAND_LIMIT = 7; // discard on 7-roll when holding MORE than this

export type CottonPhase =
  | 'setup' // snake draft: settlement then road, twice around
  | 'roll' // current player must roll
  | 'discard' // players over the hand limit discard half (multi-actor)
  | 'robber' // current player moves the robber & steals
  | 'main' // build / trade / dev cards / end turn
  | 'roadBuilding' // placing 2 free roads from the dev card
  | 'game_over';

export interface Building {
  owner: PlayerId;
  city: boolean;
}

export interface TradeOffer {
  give: ResourceCounts; // what the proposer gives away
  want: ResourceCounts;
}

export interface CottonState {
  rngState: number;
  numPlayers: number;
  phase: CottonPhase;
  turnOrder: PlayerId[];
  currentIdx: number;

  hexes: { terrain: Terrain; token: number | null }[]; // 19; desert token null
  robberHex: number;
  buildings: (Building | null)[]; // 54 vertices
  roads: (PlayerId | null)[]; // 72 edges

  hands: ResourceCounts[];
  bank: ResourceCounts;

  devDeck: DevCard[];
  devHands: DevCounts[];
  /** Cards bought this turn (unplayable until next turn). */
  devFresh: DevCounts;
  devPlayedThisTurn: boolean;
  playedKnights: number[];
  largestArmy: PlayerId | null;
  longestRoad: PlayerId | null;
  longestRoadLength: number;

  // setup phase
  setupIdx: number; // 0 .. 2*numPlayers-1 through the snake
  setupNeedRoad: boolean;
  setupLastSettlement: number | null;

  // 7-roll flow
  discardsOwed: number[]; // cards each player must still discard
  lastRoll: [number, number] | null;

  roadBuildingRoadsLeft: number;
  tradeOffer: TradeOffer | null;

  eliminated: boolean[];
  winner: PlayerId | null;
}

export type CottonAction =
  | { type: 'placeSettlement'; vertex: number } // setup
  | { type: 'placeRoad'; edge: number } // setup + roadBuilding dev
  | { type: 'roll' }
  | { type: 'discard'; resources: Partial<ResourceCounts> }
  | { type: 'moveRobber'; hex: number; victim: PlayerId | null }
  | { type: 'buildRoad'; edge: number }
  | { type: 'buildSettlement'; vertex: number }
  | { type: 'buildCity'; vertex: number }
  | { type: 'buyDev' }
  | { type: 'playKnight' }
  | { type: 'playRoadBuilding' }
  | { type: 'playYearOfPlenty'; a: Resource; b: Resource }
  | { type: 'playMonopoly'; resource: Resource }
  | { type: 'bankTrade'; give: Resource; want: Resource }
  | { type: 'offerTrade'; give: Partial<ResourceCounts>; want: Partial<ResourceCounts> }
  | { type: 'cancelTrade' }
  | { type: 'acceptTrade' } // by a NON-current player
  | { type: 'endTurn' }
  | ResignAction;

export type CottonLegal =
  | { type: 'placeSettlement'; vertices: number[] }
  | { type: 'placeRoad'; edges: number[] }
  | { type: 'roll' }
  | { type: 'discard'; count: number }
  | { type: 'moveRobber'; hexes: number[] }
  | { type: 'buildRoad'; edges: number[] }
  | { type: 'buildSettlement'; vertices: number[] }
  | { type: 'buildCity'; vertices: number[] }
  | { type: 'buyDev' }
  | { type: 'playKnight' }
  | { type: 'playRoadBuilding' }
  | { type: 'playYearOfPlenty' }
  | { type: 'playMonopoly' }
  | { type: 'bankTrade'; rates: Record<Resource, number> }
  | { type: 'offerTrade' }
  | { type: 'cancelTrade' }
  | { type: 'acceptTrade' }
  | { type: 'endTurn' }
  | { type: 'resign' };

export interface CottonPlayerPublic {
  playerId: PlayerId;
  visiblePoints: number; // buildings + awards (hidden VP cards excluded)
  handSize: number;
  devCount: number;
  playedKnights: number;
  roadLength: number;
  settlementsLeft: number;
  citiesLeft: number;
  roadsLeft: number;
  eliminated: boolean;
}

export interface CottonView {
  numPlayers: number;
  phase: CottonPhase;
  turnOrder: PlayerId[];
  current: PlayerId;
  hexes: { terrain: Terrain; token: number | null }[];
  robberHex: number;
  buildings: (Building | null)[];
  roads: (PlayerId | null)[];
  ports: PortDef[];
  players: CottonPlayerPublic[];
  largestArmy: PlayerId | null;
  longestRoad: PlayerId | null;
  // private
  hand: ResourceCounts;
  devHand: DevCounts;
  devFresh: DevCounts;
  myPoints: number; // includes own hidden VP cards
  // context
  bank: ResourceCounts;
  devDeckCount: number;
  lastRoll: [number, number] | null;
  discardsOwed: number[];
  tradeOffer: TradeOffer | null;
  roadBuildingRoadsLeft: number;
  setupNeedRoad: boolean;
  winner: PlayerId | null;
}
