import React, { useState, useEffect } from 'react';

interface SetupStatus {
  hasRuntime: boolean;
  hasVoiceKeys: boolean;
  hasAgents: boolean;
  missing: string[];
}

const MESSAGES: Record<string, { text: string; action: string }> = {
  runtime: {
    text: 'No AI runtime detected.',
    action: 'Install Claude Code or OpenCode CLI to get started.',
  },
  'voice-keys': {
    text: 'Voice not configured.',
    action: 'Add API keys in Settings to enable voice control.',
  },
  agent: {
    text: 'No agents created yet.',
    action: 'Create an agent from the sidebar to get started.',
  },
};

export const SetupBanner: React.FC<{ onOpenSettings: () => void }> = ({ onOpenSettings }) => {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    window.jam.setup.getSetupStatus().then(setStatus);
  }, []);

  if (!status || status.missing.length === 0) return null;

  const visible = status.missing.filter((m) => !dismissed.has(m));
  if (visible.length === 0) return null;

  return (
    <div className="px-4 py-2 space-y-1">
      {visible.map((key) => {
        const msg = MESSAGES[key];
        if (!msg) return null;
        return (
          <div
            key={key}
            className="flex items-center justify-between px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20"
          >
            <div className="flex items-center gap-2 text-xs">
              <span className="text-amber-400">{msg.text}</span>
              {key === 'voice-keys' ? (
                <button
                  onClick={onOpenSettings}
                  className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
                >
                  Open Settings
                </button>
              ) : (
                <span className="text-zinc-500">{msg.action}</span>
              )}
            </div>
            <button
              onClick={() => setDismissed((prev) => new Set(prev).add(key))}
              className="text-zinc-600 hover:text-zinc-400 text-xs ml-2"
            >
              dismiss
            </button>
          </div>
        );
      })}
    </div>
  );
};
