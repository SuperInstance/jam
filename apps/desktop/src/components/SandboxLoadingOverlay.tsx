import React from 'react';
import type { SandboxStatus } from '@/store/settingsSlice';

interface SandboxLoadingOverlayProps {
  status: SandboxStatus;
  message: string;
}

const STATUS_LABELS: Record<string, string> = {
  'building-image': 'Building sandbox image',
  'starting-containers': 'Starting containers',
  error: 'Sandbox initialization failed',
};

export const SandboxLoadingOverlay: React.FC<SandboxLoadingOverlayProps> = ({
  status,
  message,
}) => {
  const isError = status === 'error';
  const label = STATUS_LABELS[status] ?? 'Initializing sandbox';

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-zinc-950">
      {/* Title bar drag region */}
      <div className="absolute top-0 left-0 right-0 h-8" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

      {/* Spinner */}
      {!isError && (
        <div className="mb-6">
          <div className="w-10 h-10 border-2 border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
        </div>
      )}

      {/* Error icon */}
      {isError && (
        <div className="mb-6 w-10 h-10 flex items-center justify-center rounded-full bg-red-500/20">
          <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      )}

      <h2 className="text-sm font-medium text-zinc-200 mb-2">{label}</h2>

      {/* Progress message — truncated single line */}
      <p className="text-xs text-zinc-500 max-w-md text-center truncate px-4">
        {message || (status === 'building-image'
          ? 'This may take a few minutes on first launch...'
          : 'Please wait...')}
      </p>

      {/* Subtle animated dots for non-error states */}
      {!isError && (
        <div className="mt-4 flex gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-1 h-1 rounded-full bg-zinc-600 animate-pulse"
              style={{ animationDelay: `${i * 300}ms` }}
            />
          ))}
        </div>
      )}
    </div>
  );
};
