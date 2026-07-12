import { TERRITORIES, type RiskView } from '@gamehub/shared';
import React, { useMemo } from 'react';
import { playerColor } from '../colors.js';
import { CONTINENT_COLORS, HEX_R, LAYOUT, VIEW_H, VIEW_W, hexPoints } from './mapLayout.js';

export interface BoardProps {
  view: RiskView;
  /** Territories the local player may currently click. */
  clickable: Set<number>;
  /** Currently selected source territory (attack/fortify). */
  selected: number | null;
  /** Valid targets for the selected source. */
  targets: Set<number>;
  onTerritoryClick(id: number): void;
}

export default function RiskBoard({ view, clickable, selected, targets, onTerritoryClick }: BoardProps): React.JSX.Element {
  // Adjacency edges (each pair once). Alaska↔Kamchatka wraps the map edge.
  const edges = useMemo(() => {
    const out: { a: number; b: number }[] = [];
    for (const t of TERRITORIES) {
      for (const nb of t.adjacent) if (t.id < nb) out.push({ a: t.id, b: nb });
    }
    return out;
  }, []);

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label="World map">
      {/* ocean */}
      <defs>
        <radialGradient id="ocean" cx="50%" cy="40%">
          <stop offset="0%" stopColor="#1f5c4d" />
          <stop offset="100%" stopColor="#133f34" />
        </radialGradient>
      </defs>
      <rect width={VIEW_W} height={VIEW_H} fill="url(#ocean)" />

      {/* adjacency routes */}
      <g stroke="rgba(241,223,178,0.28)" strokeWidth={2.5}>
        {edges.map(({ a, b }) => {
          if ((a === 0 && b === 29) || (a === 29 && b === 0)) return null; // wrap link drawn as stubs
          const pa = LAYOUT[a]!;
          const pb = LAYOUT[b]!;
          return <line key={`${a}-${b}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} />;
        })}
        {/* Alaska ↔ Kamchatka wrap stubs */}
        <line x1={LAYOUT[0]!.x} y1={LAYOUT[0]!.y} x2={-30} y2={LAYOUT[0]!.y} strokeDasharray="7 6" />
        <line x1={LAYOUT[29]!.x} y1={LAYOUT[29]!.y} x2={VIEW_W + 30} y2={LAYOUT[29]!.y} strokeDasharray="7 6" />
      </g>

      {/* territories */}
      {TERRITORIES.map((t) => {
        const p = LAYOUT[t.id]!;
        const ts = view.territories[t.id]!;
        const isClickable = clickable.has(t.id);
        const isSelected = selected === t.id;
        const isTarget = targets.has(t.id);
        const fill = playerColor(ts.owner);
        return (
          <g
            key={t.id}
            onClick={() => (isClickable || isTarget || isSelected) && onTerritoryClick(t.id)}
            style={{ cursor: isClickable || isTarget ? 'pointer' : 'default' }}
          >
            {(isSelected || isTarget) && (
              <polygon
                points={hexPoints(p.x, p.y, HEX_R + 7)}
                fill="none"
                stroke={isSelected ? '#eec25a' : '#ffffff'}
                strokeWidth={4}
                strokeDasharray={isTarget ? '8 5' : undefined}
              >
                {isTarget && (
                  <animate attributeName="stroke-opacity" values="1;0.35;1" dur="1.2s" repeatCount="indefinite" />
                )}
              </polygon>
            )}
            <polygon
              points={hexPoints(p.x, p.y, HEX_R)}
              fill={fill}
              fillOpacity={isClickable || isSelected || isTarget ? 1 : 0.82}
              stroke={CONTINENT_COLORS[t.continent]}
              strokeWidth={4}
            >
              <title>{t.name} — {ts.armies} armies</title>
            </polygon>
            {isClickable && !isSelected && (
              <polygon points={hexPoints(p.x, p.y, HEX_R)} fill="#ffffff" fillOpacity={0.12}>
                <animate attributeName="fill-opacity" values="0.2;0.05;0.2" dur="1.6s" repeatCount="indefinite" />
              </polygon>
            )}
          </g>
        );
      })}

      {/* labels + army badges on a TOP layer so nothing ever covers them */}
      {TERRITORIES.map((t) => {
        const p = LAYOUT[t.id]!;
        const ts = view.territories[t.id]!;
        const pillW = p.label.length * 7.4 + 14;
        return (
          <g key={`lbl-${t.id}`} pointerEvents="none">
            {/* army count badge */}
            <circle cx={p.x} cy={p.y - 8} r={17} fill="#fdf3d7" stroke="#3a2210" strokeWidth={2.5} />
            <text
              x={p.x}
              y={p.y - 2}
              textAnchor="middle"
              fontFamily="Verdana, Arial, sans-serif"
              fontWeight={700}
              fontSize={16}
              fill="#2b1a0c"
            >
              {ts.armies}
            </text>
            {/* territory name in a parchment pill — readable on any background */}
            <rect
              x={p.x - pillW / 2}
              y={p.y + 12}
              width={pillW}
              height={19}
              rx={9.5}
              fill="#fdf3d7"
              stroke="#3a2210"
              strokeWidth={1.4}
              opacity={0.97}
            />
            <text
              x={p.x}
              y={p.y + 26}
              textAnchor="middle"
              fontFamily="Verdana, Arial, sans-serif"
              fontWeight={700}
              fontSize={12}
              fill="#2b1a0c"
            >
              {p.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
