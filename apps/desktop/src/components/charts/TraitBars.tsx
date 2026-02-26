import { useState } from 'react';

interface TraitBarsProps {
  traits: Record<string, number>;
  color?: string;
}

export function TraitBars({ traits, color = '#3b82f6' }: TraitBarsProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const sorted = Object.entries(traits).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return null;

  return (
    <div className="space-y-1">
      {sorted.map(([name, value]) => {
        const pct = Math.round(value * 100);
        const isHovered = hovered === name;

        return (
          <div
            key={name}
            className="flex items-center gap-2 group cursor-default"
            onMouseEnter={() => setHovered(name)}
            onMouseLeave={() => setHovered(null)}
          >
            {/* Label */}
            <span
              className={`text-[11px] w-44 text-right shrink-0 truncate transition-colors duration-150 ${
                isHovered ? 'text-zinc-200' : 'text-zinc-500'
              }`}
              title={name.replace(/_/g, ' ')}
            >
              {name.replace(/_/g, ' ')}
            </span>

            {/* Bar track */}
            <div className="flex-1 h-4 bg-zinc-800/60 rounded-sm overflow-hidden relative">
              <div
                className="h-full rounded-sm transition-all duration-300"
                style={{
                  width: `${pct}%`,
                  background: isHovered
                    ? `linear-gradient(90deg, ${color}, ${color}dd)`
                    : `linear-gradient(90deg, ${color}88, ${color}55)`,
                }}
              />
              {/* Value label inside bar on hover */}
              {isHovered && (
                <span className="absolute inset-0 flex items-center justify-end pr-1.5 text-[10px] font-medium text-white/90">
                  {pct}%
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
