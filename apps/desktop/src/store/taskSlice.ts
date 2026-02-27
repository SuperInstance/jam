import type { StateCreator } from 'zustand';
import type { AppStore } from './index';
import { createRecordActionsById } from './helpers';

// Re-export shared type for convenience
export type { TaskEntry } from '@/types/ipc-types';

import type { TaskEntry } from '@/types/ipc-types';

export interface TaskSlice {
  tasks: Record<string, TaskEntry>;
  taskFilter: { status?: string; assignedTo?: string };

  setTasks: (tasks: TaskEntry[]) => void;
  addTask: (task: TaskEntry) => void;
  updateTask: (task: TaskEntry) => void;
  removeTask: (taskId: string) => void;
  setTaskFilter: (filter: { status?: string; assignedTo?: string }) => void;
}

export const createTaskSlice: StateCreator<
  AppStore,
  [],
  [],
  TaskSlice
> = (set, get) => {
  // Use record helper for CRUD operations
  const actions = createRecordActionsById<TaskEntry>(
    set,
    () => get().tasks,
    'tasks',
  );

  return {
    tasks: {},
    taskFilter: {},

    setTasks: actions.setAll,
    addTask: actions.upsert,
    updateTask: actions.upsert, // Same as add for full replacement
    removeTask: actions.remove,
    setTaskFilter: (filter) => set({ taskFilter: filter }),
  };
};
