import type { StateCreator } from 'zustand';
import type { AppStore } from './index';

export type VoiceMode = 'push-to-talk' | 'always-listening';
export type ViewMode = 'chat' | 'stage' | 'compact';

export interface SettingsSlice {
  voiceMode: VoiceMode;
  navExpanded: boolean;
  logsDrawerOpen: boolean;
  viewMode: ViewMode;

  setNavExpanded: (expanded: boolean) => void;
  setLogsDrawerOpen: (open: boolean) => void;
  setVoiceMode: (mode: VoiceMode) => void;
  setViewMode: (mode: ViewMode) => void;
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

  setNavExpanded: (expanded) => set({ navExpanded: expanded }),
  setLogsDrawerOpen: (open) => set({ logsDrawerOpen: open }),
  setVoiceMode: (mode) => set({ voiceMode: mode }),
  setViewMode: (mode) => set({ viewMode: mode }),
});
