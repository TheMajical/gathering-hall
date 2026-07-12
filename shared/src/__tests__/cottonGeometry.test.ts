import { describe, expect, it } from 'vitest';
import {
  EDGE_HEXES,
  EDGE_VERTICES,
  HEXES,
  HEX_VERTICES,
  NUM_COAST_EDGES,
  NUM_EDGES,
  NUM_VERTICES,
  PORTS,
  VERTEX_ADJ,
  VERTEX_EDGES,
  VERTEX_HEXES,
  vertexPos,
} from '../games/cotton/geometry.js';

describe('Cotton board geometry (derived)', () => {
  it('has the classic counts: 19 hexes, 54 vertices, 72 edges, 30 coast edges', () => {
    expect(HEXES).toHaveLength(19);
    expect(NUM_VERTICES).toBe(54);
    expect(NUM_EDGES).toBe(72);
    expect(NUM_COAST_EDGES).toBe(30);
  });

  it('every hex has 6 distinct vertices; every vertex touches 1-3 hexes', () => {
    for (const vs of HEX_VERTICES) {
      expect(vs).toHaveLength(6);
      expect(new Set(vs).size).toBe(6);
    }
    for (const hs of VERTEX_HEXES) {
      expect(hs.length).toBeGreaterThanOrEqual(1);
      expect(hs.length).toBeLessThanOrEqual(3);
    }
    // interior vertex count sanity: 54 total = 6 center-ring... every vertex of 3 hexes is interior
    const interior = VERTEX_HEXES.filter((h) => h.length === 3).length;
    expect(interior).toBe(24); // classic board: 24 interior vertices
  });

  it('edges are symmetric and consistent with vertex adjacency', () => {
    EDGE_VERTICES.forEach(([a, b], eid) => {
      expect(a).not.toBe(b);
      expect(VERTEX_EDGES[a]).toContain(eid);
      expect(VERTEX_EDGES[b]).toContain(eid);
      expect(VERTEX_ADJ[a]).toContain(b);
      expect(VERTEX_ADJ[b]).toContain(a);
    });
    for (const edges of VERTEX_EDGES) {
      expect(edges.length).toBeGreaterThanOrEqual(2);
      expect(edges.length).toBeLessThanOrEqual(3);
    }
  });

  it('each edge borders 1 or 2 hexes; hex-edge incidence is consistent', () => {
    for (const hs of EDGE_HEXES) {
      expect(hs.length).toBeGreaterThanOrEqual(1);
      expect(hs.length).toBeLessThanOrEqual(2);
    }
    // total (hex,edge) incidences = 19 hexes × 6 edges = 114 = sum over edges
    expect(EDGE_HEXES.reduce((s, h) => s + h.length, 0)).toBe(114);
  });

  it('vertex positions are unique (no two vertices collapse)', () => {
    const seen = new Set<string>();
    for (let v = 0; v < NUM_VERTICES; v++) {
      const p = vertexPos(v);
      const key = `${p.x.toFixed(4)},${p.y.toFixed(4)}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('9 ports on 9 distinct coastal edges with classic kinds', () => {
    expect(PORTS).toHaveLength(9);
    const kinds = PORTS.map((p) => p.kind).sort();
    expect(kinds).toEqual(['any', 'any', 'any', 'any', 'brick', 'grain', 'lumber', 'ore', 'wool']);
    const keys = PORTS.map((p) => [...p.vertices].sort((a, b) => a - b).join('-'));
    expect(new Set(keys).size).toBe(9);
    // port vertices must be coastal (touch ≤2 hexes)
    for (const p of PORTS) {
      for (const v of p.vertices) expect(VERTEX_HEXES[v]!.length).toBeLessThanOrEqual(2);
    }
  });
});
