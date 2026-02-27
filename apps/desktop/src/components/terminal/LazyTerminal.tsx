import React, { lazy, Suspense, useEffect, useState } from 'react';

// Lazy load the terminal container with xterm (reduces initial bundle size)
const AgentTerminalContainerLazy = lazy(() =>
  import('@/containers/AgentTerminalContainer').then((module) => ({
    default: module.AgentTerminalContainer,
  }))
);

interface LazyTerminalProps {
  agentId: string;
}

// Loading placeholder for terminal
const TerminalLoadingFallback: React.FC = () => (
  <div className="h-full w-full flex items-center justify-center bg-zinc-950 text-zinc-500 text-sm">
    <div className="flex items-center gap-2">
      <div className="w-4 h-4 border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" />
      Loading terminal...
    </div>
  </div>
);

/**
 * Lazy-loaded terminal component.
 * Code-splits xterm.js and its dependencies to reduce initial bundle size.
 * The xterm CSS is loaded dynamically when the terminal is first rendered.
 */
export const LazyTerminal: React.FC<LazyTerminalProps> = ({ agentId }) => {
  const [xtermCssLoaded, setXtermCssLoaded] = useState(false);

  // Load xterm CSS dynamically on first render
  useEffect(() => {
    if (!xtermCssLoaded) {
      import('@xterm/xterm/css/xterm.css').then(() => {
        setXtermCssLoaded(true);
      }).catch((err) => {
        console.warn('Failed to load xterm CSS:', err);
        setXtermCssLoaded(true); // Continue anyway
      });
    }
  }, [xtermCssLoaded]);

  if (!xtermCssLoaded) {
    return <TerminalLoadingFallback />;
  }

  return (
    <Suspense fallback={<TerminalLoadingFallback />}>
      <AgentTerminalContainerLazy agentId={agentId} />
    </Suspense>
  );
};
