import { useState } from 'react';
import { TraitRadar } from './TraitRadar';
import { TraitBars } from './TraitBars';

type ViewMode = 'radar' | 'bars';

interface TraitViewsProps {
  traits: Record<string, number>;
  color?: string;
}

const VIEW_OPTIONS: { mode: ViewMode; label: string }[] = [
  { mode: 'radar', label: 'Radar' },
  { mode: 'bars', label: 'Bars' },
];

export function TraitViews({ traits, color }: TraitViewsProps) {
  const [view, setView] = useState<ViewMode>('radar');
  const count = Object.keys(traits).length;
  if (count < 3) return null;

  return (
    <div>
      {/* View toggle */}
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
          Traits ({count})
        </h4>
        <div className="flex bg-zinc-800 rounded-md p-0.5">
          {VIEW_OPTIONS.map(({ mode, label }) => (
            <button
              key={mode}
              onClick={() => setView(mode)}
              className={`text-[10px] px-2.5 py-0.5 rounded transition-colors ${
                view === mode
                  ? 'bg-zinc-700 text-zinc-200'
                  : 'text-zinc-500 hover:text-zinc-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* View content */}
      {view === 'radar' && (
        <div className="flex justify-center">
          <TraitRadar traits={traits} color={color} />
        </div>
      )}
      {view === 'bars' && <TraitBars traits={traits} color={color} />}
    </div>
  );
}
