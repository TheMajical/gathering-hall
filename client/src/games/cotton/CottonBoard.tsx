import {
  EDGE_VERTICES,
  HEXES,
  hexCenter,
  vertexPos,
  type CottonView,
  type Terrain,
} from '@gamehub/shared';
import React from 'react';
import { playerColor } from '../colors.js';

const S = 60; // world scale
const HEX_R = 57;

const TERRAIN_FILL: Record<Terrain, string> = {
  lumber: '#2f6b3a',
  wool: '#9fbe6e',
  grain: '#dfb94f',
  brick: '#b3552e',
  ore: '#7d8592',
  desert: '#d8c89a',
};
const TERRAIN_ICON: Record<Terrain, string> = {
  lumber: '🌲',
  wool: '🐑',
  grain: '🌾',
  brick: '🧱',
  ore: '⛰',
  desert: '🏜',
};
export const PORT_LABEL: Record<string, string> = {
  any: '3:1',
  brick: '🧱2:1',
  lumber: '🌲2:1',
  wool: '🐑2:1',
  grain: '🌾2:1',
  ore: '⛰2:1',
};

function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30); // pointy-top
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

export interface CottonBoardProps {
  view: CottonView;
  clickableVertices: Set<number>;
  clickableEdges: Set<number>;
  clickableHexes: Set<number>;
  selectedHex: number | null;
  onVertex(v: number): void;
  onEdge(e: number): void;
  onHex(h: number): void;
}

export default function CottonBoard(p: CottonBoardProps): React.JSX.Element {
  const { view } = p;
  const vp = (v: number) => {
    const { x, y } = vertexPos(v);
    return { x: x * S, y: y * S };
  };

  return (
    <svg viewBox="-350 -300 700 600" role="img" aria-label="Island board">
      <defs>
        <radialGradient id="cotton-sea" cx="50%" cy="45%">
          <stop offset="0%" stopColor="#1f5c4d" />
          <stop offset="100%" stopColor="#133f34" />
        </radialGradient>
      </defs>
      <rect x={-350} y={-300} width={700} height={600} fill="url(#cotton-sea)" />

      {/* hex tiles */}
      {HEXES.map((h) => {
        const c = hexCenter(h.id);
        const cx = c.x * S;
        const cy = c.y * S;
        const tile = view.hexes[h.id]!;
        const clickable = p.clickableHexes.has(h.id);
        const isSel = p.selectedHex === h.id;
        return (
          <g key={h.id} onClick={() => clickable && p.onHex(h.id)} style={{ cursor: clickable ? 'pointer' : 'default' }}>
            <polygon
              points={hexPoints(cx, cy, HEX_R)}
              fill={TERRAIN_FILL[tile.terrain]}
              stroke={isSel ? '#eec25a' : '#3a2210'}
              strokeWidth={isSel ? 5 : 3}
            >
              <title>{tile.terrain}{tile.token ? ` — ${tile.token}` : ''}</title>
            </polygon>
            {clickable && (
              <polygon points={hexPoints(cx, cy, HEX_R)} fill="#ffffff" fillOpacity={0.15}>
                <animate attributeName="fill-opacity" values="0.25;0.05;0.25" dur="1.4s" repeatCount="indefinite" />
              </polygon>
            )}
            <text x={cx} y={cy - 22} textAnchor="middle" fontSize={17}>{TERRAIN_ICON[tile.terrain]}</text>
            {tile.token !== null && (
              <>
                <circle cx={cx} cy={cy + 6} r={15} fill="#fdf3d7" stroke="#3a2210" strokeWidth={1.6} />
                <text
                  x={cx}
                  y={cy + 11.5}
                  textAnchor="middle"
                  fontFamily="Verdana, sans-serif"
                  fontWeight={700}
                  fontSize={15}
                  fill={tile.token === 6 || tile.token === 8 ? '#a8402c' : '#2b1a0c'}
                >
                  {tile.token}
                </text>
              </>
            )}
            {view.robberHex === h.id && (
              <g>
                <ellipse cx={cx} cy={cy + 30} rx={11} ry={14} fill="#241b12" stroke="#0c0805" strokeWidth={2} />
                <circle cx={cx} cy={cy + 18} r={7} fill="#241b12" stroke="#0c0805" strokeWidth={2} />
                <title>The robber</title>
              </g>
            )}
          </g>
        );
      })}

      {/* ports */}
      {view.ports.map((port, i) => {
        const a = vp(port.vertices[0]);
        const b = vp(port.vertices[1]);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        // push the marker outward from the island center
        const len = Math.hypot(mx, my) || 1;
        const ox = mx + (mx / len) * 34;
        const oy = my + (my / len) * 34;
        return (
          <g key={i}>
            <line x1={mx} y1={my} x2={ox} y2={oy} stroke="rgba(241,223,178,0.5)" strokeWidth={2} strokeDasharray="4 4" />
            <rect x={ox - 24} y={oy - 11} width={48} height={22} rx={11} fill="#fdf3d7" stroke="#3a2210" strokeWidth={1.4} />
            <text x={ox} y={oy + 4.5} textAnchor="middle" fontSize={11.5} fontFamily="Verdana, sans-serif" fontWeight={700} fill="#2b1a0c">
              {PORT_LABEL[port.kind]}
            </text>
          </g>
        );
      })}

      {/* roads */}
      {view.roads.map((owner, e) => {
        const [va, vb] = EDGE_VERTICES[e]!;
        const a = vp(va);
        const b = vp(vb);
        const clickable = p.clickableEdges.has(e);
        if (owner === null && !clickable) return null;
        // shrink toward the middle so roads don't cover the vertices
        const t = 0.18;
        const x1 = a.x + (b.x - a.x) * t;
        const y1 = a.y + (b.y - a.y) * t;
        const x2 = b.x - (b.x - a.x) * t;
        const y2 = b.y - (b.y - a.y) * t;
        return (
          <g key={e} onClick={() => clickable && p.onEdge(e)} style={{ cursor: clickable ? 'pointer' : 'default' }}>
            {/* generous invisible hit area */}
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={16} />
            {owner !== null ? (
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={playerColor(owner)} strokeWidth={9} strokeLinecap="round" />
            ) : (
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#ffffff" strokeWidth={7} strokeLinecap="round" strokeDasharray="6 5" opacity={0.75}>
                <animate attributeName="opacity" values="0.9;0.4;0.9" dur="1.4s" repeatCount="indefinite" />
              </line>
            )}
          </g>
        );
      })}

      {/* buildings + clickable vertices */}
      {view.buildings.map((b, v) => {
        const pos = vp(v);
        const clickable = p.clickableVertices.has(v);
        if (!b && !clickable) return null;
        return (
          <g key={v} onClick={() => clickable && p.onVertex(v)} style={{ cursor: clickable ? 'pointer' : 'default' }}>
            <circle cx={pos.x} cy={pos.y} r={14} fill="transparent" />
            {clickable && (
              <circle cx={pos.x} cy={pos.y} r={9} fill="#ffffff" opacity={0.85} stroke="#3a2210" strokeWidth={1.5}>
                <animate attributeName="r" values="9;11;9" dur="1.2s" repeatCount="indefinite" />
              </circle>
            )}
            {b && !b.city && (
              <path
                d={`M ${pos.x - 9} ${pos.y + 8} v -9 l 9 -8 l 9 8 v 9 z`}
                fill={playerColor(b.owner)}
                stroke="#241505"
                strokeWidth={1.8}
              >
                <title>Settlement</title>
              </path>
            )}
            {b && b.city && (
              <path
                d={`M ${pos.x - 11} ${pos.y + 9} v -11 l 7 -6 l 7 6 h 8 v 11 z`}
                fill={playerColor(b.owner)}
                stroke="#241505"
                strokeWidth={1.8}
              >
                <title>City</title>
              </path>
            )}
          </g>
        );
      })}
    </svg>
  );
}
