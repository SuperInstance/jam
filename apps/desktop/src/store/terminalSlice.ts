import type { StateCreator } from 'zustand';
import type { AppStore } from './index';

/** Maximum scrollback entries kept in memory per agent */
const MAX_SCROLLBACK = 500;

export interface TerminalBuffer {
  /** Data waiting to be written to a mounted xterm.js instance */
  pendingData: string[];
  /** Scrollback history — kept even after pendingData is flushed.
   *  Used to populate the ThreadDrawer when it mounts after output has passed. */
  scrollback: string[];
}

export interface TerminalSlice {
  terminalBuffers: Record<string, TerminalBuffer>;
  /** Execute output per agent — markdown text for streamdown rendering in ThreadDrawer */
  executeOutput: Record<string, string>;

  appendTerminalData: (agentId: string, data: string) => void;
  flushTerminalData: (agentId: string) => void;
  clearTerminal: (agentId: string) => void;
  appendExecuteOutput: (agentId: string, data: string, clear?: boolean) => void;
}

export const createTerminalSlice: StateCreator<
  AppStore,
  [],
  [],
  TerminalSlice
> = (set) => ({
  terminalBuffers: {},
  executeOutput: {},

  appendTerminalData: (agentId, data) =>
    set((state) => {
      const existing = state.terminalBuffers[agentId] ?? { pendingData: [], scrollback: [] };
      const scrollback = [...existing.scrollback, data];
      // Cap scrollback to prevent unbounded memory growth
      if (scrollback.length > MAX_SCROLLBACK) {
        scrollback.splice(0, scrollback.length - MAX_SCROLLBACK);
      }
      return {
        terminalBuffers: {
          ...state.terminalBuffers,
          [agentId]: {
            pendingData: [...existing.pendingData, data],
            scrollback,
          },
        },
      };
    }),

  flushTerminalData: (agentId) =>
    set((state) => {
      const existing = state.terminalBuffers[agentId];
      if (!existing) return state;
      return {
        terminalBuffers: {
          ...state.terminalBuffers,
          [agentId]: { pendingData: [], scrollback: existing.scrollback },
        },
      };
    }),

  clearTerminal: (agentId) =>
    set((state) => ({
      terminalBuffers: {
        ...state.terminalBuffers,
        [agentId]: { pendingData: [], scrollback: [] },
      },
    })),

  appendExecuteOutput: (agentId, data, clear) =>
    set((state) => {
      const prev = clear ? '' : (state.executeOutput[agentId] ?? '');
      return {
        executeOutput: {
          ...state.executeOutput,
          [agentId]: prev + data,
        },
      };
    }),
});
