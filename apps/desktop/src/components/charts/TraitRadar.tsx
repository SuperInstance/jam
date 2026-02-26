import { useState } from 'react';

interface TraitRadarProps {
  traits: Record<string, number>;
  size?: number;
  color?: string;
}

/** Compute smart text anchor based on angle position */
function getLabelAnchor(angle: number): { textAnchor: 'start' | 'middle' | 'end'; dx: number } {
  const cos = Math.cos(angle);
  if (cos > 0.3) return { textAnchor: 'start', dx: 6 };
  if (cos < -0.3) return { textAnchor: 'end', dx: -6 };
  return { textAnchor: 'middle', dx: 0 };
}

export function TraitRadar({ traits, size = 800, color = '#3b82f6' }: TraitRadarProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const entries = Object.entries(traits);
  if (entries.length < 3) return null;

  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 140;
  const angleStep = (2 * Math.PI) / entries.length;

  const dataPoints = entries.map(([, value], i) => {
    const angle = angleStep * i - Math.PI / 2;
    const r = value * radius;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  });

  const polygon = dataPoints.map((p) => `${p.x},${p.y}`).join(' ');
  const rings = [0.25, 0.5, 0.75, 1.0];

  return (
    <svg
      width={size}
      height={size}
      className="overflow-visible"
      onMouseLeave={() => setHovered(null)}
    >
      {/* Grid */}
      {rings.map((ring) => (
        <polygon
          key={ring}
          points={entries
            .map((_, i) => {
              const angle = angleStep * i - Math.PI / 2;
              const r = ring * radius;
              return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
            })
            .join(' ')}
          fill="none"
          stroke="#374151"
          strokeWidth={0.5}
        />
      ))}

      {/* Axes */}
      {entries.map(([, ], i) => {
        const angle = angleStep * i - Math.PI / 2;
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={cx + radius * Math.cos(angle)}
            y2={cy + radius * Math.sin(angle)}
            stroke="#374151"
            strokeWidth={0.5}
          />
        );
      })}

      {/* Data polygon */}
      <polygon points={polygon} fill={color} opacity={0.15} stroke={color} strokeWidth={1.5} />

      {/* Interactive data points — larger hit area + hover tooltip */}
      {dataPoints.map((p, i) => (
        <g key={i} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}>
          {/* Invisible larger hit target */}
          <circle cx={p.x} cy={p.y} r={10} fill="transparent" className="cursor-pointer" />
          {/* Visible dot */}
          <circle
            cx={p.x}
            cy={p.y}
            r={hovered === i ? 5 : 3}
            fill={hovered === i ? '#fff' : color}
            stroke={hovered === i ? color : 'none'}
            strokeWidth={2}
            className="transition-all duration-150"
          />
        </g>
      ))}

      {/* Labels */}
      {entries.map(([name], i) => {
        const angle = angleStep * i - Math.PI / 2;
        const labelR = radius + 14;
        const { textAnchor, dx } = getLabelAnchor(angle);
        return (
          <text
            key={name}
            x={cx + labelR * Math.cos(angle) + dx}
            y={cy + labelR * Math.sin(angle)}
            textAnchor={textAnchor}
            dominantBaseline="central"
            fill={hovered === i ? '#e4e4e7' : '#6b7280'}
            fontSize={9}
            className="transition-colors duration-150"
          >
            {name.replace(/_/g, ' ')}
          </text>
        );
      })}

      {/* Hover tooltip — value badge near the hovered dot */}
      {hovered !== null && (() => {
        const [, value] = entries[hovered];
        const p = dataPoints[hovered];
        const label = `${Math.round(value * 100)}%`;

        return (
          <g>
            <rect
              x={p.x + 8}
              y={p.y - 12}
              width={label.length * 7.5 + 8}
              height={20}
              rx={4}
              fill="#18181b"
              stroke="#3f3f46"
              strokeWidth={1}
            />
            <text
              x={p.x + 12}
              y={p.y - 2}
              textAnchor="start"
              dominantBaseline="central"
              fill="#e4e4e7"
              fontSize={11}
              fontWeight={600}
            >
              {label}
            </text>
          </g>
        );
      })()}
    </svg>
  );
}
