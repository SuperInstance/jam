import type { StateCreator } from 'zustand';
import type { AppStore } from './index';

export type VoiceMode = 'push-to-talk' | 'always-listening';
export type ViewMode = 'chat' | 'stage' | 'compact';

export type SandboxStatus = 'idle' | 'building-image' | 'starting-containers' | 'ready' | 'error' | 'unavailable';

export interface SettingsSlice {
  voiceMode: VoiceMode;
  navExpanded: boolean;
  logsDrawerOpen: boolean;
  viewMode: ViewMode;

  // Sandbox startup progress
  sandboxStatus: SandboxStatus;
  sandboxMessage: string;

  setNavExpanded: (expanded: boolean) => void;
  setLogsDrawerOpen: (open: boolean) => void;
  setVoiceMode: (mode: VoiceMode) => void;
  setViewMode: (mode: ViewMode) => void;
  setSandboxProgress: (status: SandboxStatus, message: string) => void;
}

export const createSettingsSlice: StateCreator<
  AppStore,
  [],
  [],
  SettingsSlice
> = (set) => ({
  voiceMode: 'always-listening',
  navExpanded: false,
  logsDrawerOpen: false,
  viewMode: 'chat',
  sandboxStatus: 'idle',
  sandboxMessage: '',

  setNavExpanded: (expanded) => set({ navExpanded: expanded }),
  setLogsDrawerOpen: (open) => set({ logsDrawerOpen: open }),
  setVoiceMode: (mode) => set({ voiceMode: mode }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setSandboxProgress: (status, message) => set({ sandboxStatus: status, sandboxMessage: message }),
});
