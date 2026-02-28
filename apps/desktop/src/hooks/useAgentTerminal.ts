import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/store';

// Terminal configuration constants
const TERMINAL_SCROLLBACK = 5000;
const TERMINAL_FONT_SIZE = 13;
const TERMINAL_THEME = {
  background: '#09090b',
  foreground: '#e6edf3',
  cursor: '#58a6ff',
  selectionBackground: '#264f78',
} as const;

// Types for dynamically imported modules
type TerminalType = typeof import('@xterm/xterm').Terminal;
type FitAddonType = typeof import('@xterm/addon-fit').FitAddon;

export function useAgentTerminal(agentId: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<InstanceType<TerminalType> | null>(null);
  const fitAddonRef = useRef<InstanceType<FitAddonType> | null>(null);
  const [isReady, setIsReady] = useState(false);

  const pendingData = useAppStore(
    (s) => s.terminalBuffers[agentId]?.pendingData,
  );
  const flushTerminalData = useAppStore((s) => s.flushTerminalData);

  // Initialize terminal + load scrollback history (with dynamic imports)
  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;

    // Dynamic import to reduce initial bundle size
    Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
    ]).then(([{ Terminal }, { FitAddon }]) => {
      if (disposed) return;

      const terminal = new Terminal({
        theme: TERMINAL_THEME,
        fontSize: TERMINAL_FONT_SIZE,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        cursorBlink: true,
        scrollback: TERMINAL_SCROLLBACK,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(containerRef.current!);
      fitAddon.fit();

      // Forward user input to main process
      terminal.onData((data) => {
        window.jam.terminal.write(agentId, data);
      });

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      // Replay scrollback history so the terminal shows past output
      const scrollback = useAppStore.getState().terminalBuffers[agentId]?.scrollback ?? [];
      for (const data of scrollback) {
        terminal.write(data);
      }

      setIsReady(true);
    }).catch((err) => {
      console.error('Failed to load xterm:', err);
    });

    return () => {
      disposed = true;
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      setIsReady(false);
    };
  }, [agentId]);

  // Write pending data — join into single write to avoid layout thrashing
  useEffect(() => {
    if (!terminalRef.current || !pendingData?.length) return;

    terminalRef.current.write(pendingData.join(''));
    flushTerminalData(agentId);
  }, [agentId, pendingData, flushTerminalData]);

  // Handle resize
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver(() => {
      fitAddonRef.current?.fit();

      if (terminalRef.current) {
        const { cols, rows } = terminalRef.current;
        window.jam.terminal.resize(agentId, cols, rows);
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [agentId]);

  return {
    containerRef,
    isReady,
  };
}
