import React from 'react';
import { AgentStatusBadge } from './AgentStatusBadge';
import type { AgentVisualState } from '@/store/agentSlice';

interface AgentCardProps {
  name: string;
  runtime: string;
  color: string;
  visualState: AgentVisualState;
  isSelected: boolean;
  onClick: () => void;
  onStart: () => void;
  onStop: () => void;
  onDelete: () => void;
  isRunning: boolean;
}

export const AgentCard: React.FC<AgentCardProps> = ({
  name,
  runtime,
  color,
  visualState,
  isSelected,
  onClick,
  onStart,
  onStop,
  onDelete,
  isRunning,
}) => {
  return (
    <div
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      role="button"
      tabIndex={0}
      className={`
        flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-colors
        ${isSelected ? 'bg-zinc-800 border border-zinc-600' : 'hover:bg-zinc-800/50 border border-transparent'}
      `}
    >
      {/* Color dot */}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
        style={{ backgroundColor: `${color}30`, color }}
      >
        {name.charAt(0).toUpperCase()}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-zinc-200 truncate">
          {name}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">{runtime}</span>
          <AgentStatusBadge state={visualState} />
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={(e) => {
            e.stopPropagation();
            isRunning ? onStop() : onStart();
          }}
          className={`
            titlebar-no-drag w-7 h-7 flex items-center justify-center rounded
            transition-colors text-xs
            ${isRunning
              ? 'hover:bg-red-900/50 text-red-400 hover:text-red-300'
              : 'hover:bg-green-900/50 text-green-400 hover:text-green-300'
            }
          `}
          aria-label={isRunning ? 'Stop agent' : 'Start agent'}
        >
          {isRunning ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <rect width="10" height="10" rx="1" />
            </svg>
          ) : (
            <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor">
              <path d="M0 0L10 6L0 12Z" />
            </svg>
          )}
        </button>
        {!isRunning && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="titlebar-no-drag w-7 h-7 flex items-center justify-center rounded transition-colors text-xs hover:bg-red-900/50 text-zinc-500 hover:text-red-400"
            aria-label="Delete agent"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none">
              <line x1="1" y1="1" x2="9" y2="9" />
              <line x1="9" y1="1" x2="1" y2="9" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};
