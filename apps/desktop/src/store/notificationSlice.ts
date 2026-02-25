import type { StateCreator } from 'zustand';
import type { AppStore } from './index';

export interface Notification {
  id: string;
  type: 'task_completed' | 'task_failed';
  agentId: string;
  title: string;
  summary: string;
  taskId: string;
  timestamp: number;
  read: boolean;
}

export interface NotificationSlice {
  notifications: Notification[];
  addNotification: (n: Notification) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  clearAllNotifications: () => void;
}

export const createNotificationSlice: StateCreator<
  AppStore,
  [],
  [],
  NotificationSlice
> = (set) => ({
  notifications: [],

  addNotification: (n) =>
    set((state) => ({
      notifications: [n, ...state.notifications],
    })),

  markNotificationRead: (id) =>
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n,
      ),
    })),

  markAllNotificationsRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
    })),

  clearAllNotifications: () =>
    set({ notifications: [] }),
});
