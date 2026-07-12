/**
 * Cotton (Catan) board geometry — derived, not hand-encoded.
 *
 * 19 hexes on an axial radius-2 grid (pointy-top). Every vertex has a
 * canonical integer-only label (q, r, 'N'|'S'): the N corner of hex (q,r) or
 * the S corner of hex (q,r). Corner equivalences (derived from pixel math):
 *   NE(q,r) = S(q+1, r-1)   SE(q,r) = N(q, r+1)
 *   SW(q,r) = N(q-1, r+1)   NW(q,r) = S(q, r-1)
 * This gives exact identity with zero floating-point comparisons.
 * Invariants (asserted by tests): 54 vertices, 72 edges, 30 coast edges.
 */

export interface HexDef {
  id: number;
  q: number;
  r: number;
}

export type VertexKey = string; // "q,r,N" | "q,r,S"

export interface PortDef {
  /** 3:1 generic, or a 2:1 resource port. */
  kind: 'any' | 'brick' | 'lumber' | 'wool' | 'grain' | 'ore';
  vertices: [number, number];
}

// ---------- hexes ----------
export const HEXES: HexDef[] = (() => {
  const out: HexDef[] = [];
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      if (Math.abs(q + r) <= 2) out.push({ id: out.length, q, r });
    }
  }
  return out;
})();

// ---------- canonical corner labels ----------
function cornersOf(q: number, r: number): VertexKey[] {
  // order: N, NE, SE, S, SW, NW
  return [
    `${q},${r},N`,
    `${q + 1},${r - 1},S`,
    `${q},${r + 1},N`,
    `${q},${r},S`,
    `${q - 1},${r + 1},N`,
    `${q},${r - 1},S`,
  ];
}

// ---------- derived tables ----------
const vertexKeys: VertexKey[] = [];
const vertexIdByKey = new Map<VertexKey, number>();
export const HEX_VERTICES: number[][] = []; // hexId → 6 vertex ids
export const VERTEX_HEXES: number[][] = []; // vertexId → adjacent board hex ids

for (const hex of HEXES) {
  const ids: number[] = [];
  for (const key of cornersOf(hex.q, hex.r)) {
    let vid = vertexIdByKey.get(key);
    if (vid === undefined) {
      vid = vertexKeys.length;
      vertexKeys.push(key);
      vertexIdByKey.set(key, vid);
      VERTEX_HEXES.push([]);
    }
    ids.push(vid);
    VERTEX_HEXES[vid]!.push(hex.id);
  }
  HEX_VERTICES.push(ids);
}

export const NUM_VERTICES = vertexKeys.length;

// edges: consecutive corner pairs of each hex, deduped
const edgeIdByKey = new Map<string, number>();
export const EDGE_VERTICES: [number, number][] = [];
for (const ids of HEX_VERTICES) {
  for (let i = 0; i < 6; i++) {
    const a = ids[i]!;
    const b = ids[(i + 1) % 6]!;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (!edgeIdByKey.has(key)) {
      edgeIdByKey.set(key, EDGE_VERTICES.length);
      EDGE_VERTICES.push(a < b ? [a, b] : [b, a]);
    }
  }
}
export const NUM_EDGES = EDGE_VERTICES.length;

export const VERTEX_EDGES: number[][] = Array.from({ length: NUM_VERTICES }, () => []);
export const VERTEX_ADJ: number[][] = Array.from({ length: NUM_VERTICES }, () => []);
EDGE_VERTICES.forEach(([a, b], eid) => {
  VERTEX_EDGES[a]!.push(eid);
  VERTEX_EDGES[b]!.push(eid);
  VERTEX_ADJ[a]!.push(b);
  VERTEX_ADJ[b]!.push(a);
});

/** Hexes adjacent to an edge = board hexes containing both its endpoints. */
export const EDGE_HEXES: number[][] = EDGE_VERTICES.map(([a, b]) =>
  VERTEX_HEXES[a]!.filter((h) => VERTEX_HEXES[b]!.includes(h)),
);

// ---------- rendering positions (unitless; client scales) ----------
const SQRT3 = Math.sqrt(3);

export function hexCenter(hexId: number): { x: number; y: number } {
  const { q, r } = HEXES[hexId]!;
  return { x: SQRT3 * (q + r / 2), y: 1.5 * r };
}

export function vertexPos(vertexId: number): { x: number; y: number } {
  const [q, r, side] = vertexKeys[vertexId]!.split(',');
  const cx = SQRT3 * (Number(q) + Number(r) / 2);
  const cy = 1.5 * Number(r);
  return { x: cx, y: side === 'N' ? cy - 1 : cy + 1 };
}

// ---------- ports ----------
// Coast edges (exactly one adjacent board hex), ordered by angle around the
// center, then 9 classic ports spread around the rim.
const coastEdges = EDGE_VERTICES.map((_, eid) => eid).filter((eid) => EDGE_HEXES[eid]!.length === 1);
const byAngle = [...coastEdges].sort((a, b) => {
  const mid = (eid: number) => {
    const [va, vb] = EDGE_VERTICES[eid]!;
    const pa = vertexPos(va);
    const pb = vertexPos(vb);
    return Math.atan2((pa.y + pb.y) / 2, (pa.x + pb.x) / 2);
  };
  return mid(a) - mid(b);
});
export const NUM_COAST_EDGES = coastEdges.length;

const PORT_KINDS: PortDef['kind'][] = ['any', 'wool', 'any', 'ore', 'grain', 'any', 'lumber', 'brick', 'any'];
const PORT_SPACING = [0, 3, 7, 10, 13, 17, 20, 23, 27];

export const PORTS: PortDef[] = PORT_KINDS.map((kind, i) => {
  const eid = byAngle[PORT_SPACING[i]! % byAngle.length]!;
  return { kind, vertices: EDGE_VERTICES[eid]! };
});

/** vertexId → port kind (if any). */
export const VERTEX_PORT: (PortDef['kind'] | null)[] = (() => {
  const out: (PortDef['kind'] | null)[] = Array(NUM_VERTICES).fill(null);
  for (const p of PORTS) {
    out[p.vertices[0]] = p.kind;
    out[p.vertices[1]] = p.kind;
  }
  return out;
})();
