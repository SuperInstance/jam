/**
 * Zustand record helper utilities.
 * Reduces boilerplate for common CRUD operations on Record<string, T> state.
 */

import type { StateCreator } from 'zustand';

/**
 * Entity with an ID field for record operations.
 */
export interface HasId {
  id: string;
}

/**
 * Get the ID key from an entity.
 * Defaults to 'id' but can be overridden for entities like AgentEntry that use 'profile.id'.
 */
export type IdExtractor<T> = (entity: T) => string;

/**
 * Actions for managing a record-based collection in Zustand.
 */
export interface RecordActions<T> {
  /** Set all records from an array (replaces existing) */
  setAll: (items: T[]) => void;
  /** Add or update a single record */
  upsert: (item: T) => void;
  /** Remove a record by ID */
  remove: (id: string) => void;
  /** Partially update a record (merges with existing) */
  update: (id: string, partial: Partial<T>) => void;
}

/**
 * Create record actions for a Zustand slice.
 *
 * @example
 * ```ts
 * interface TaskSlice {
 *   tasks: Record<string, TaskEntry>;
 *   // Actions created by helper
 *   setTasks: (tasks: TaskEntry[]) => void;
 *   addTask: (task: TaskEntry) => void;
 *   removeTask: (taskId: string) => void;
 *   updateTaskPartial: (taskId: string, partial: Partial<TaskEntry>) => void;
 * }
 *
 * const createTaskSlice: StateCreator<AppStore, [], [], TaskSlice> = (set) => {
 *   const actions = createRecordActions<TaskEntry>(
 *     set,
 *     (state) => state.tasks,
 *     'tasks',
 *     (task) => task.id
 *   );
 *
 *   return {
 *     tasks: {},
 *     setTasks: actions.setAll,
 *     addTask: actions.upsert,
 *     removeTask: actions.remove,
 *     updateTaskPartial: actions.update,
 *   };
 * };
 * ```
 */
export function createRecordActions<T>(
  set: Parameters<StateCreator<any>>[0],
  _getRecordState: () => Record<string, T>,
  stateKey: string,
  getId: IdExtractor<T>,
): RecordActions<T> {
  return {
    setAll: (items: T[]) => {
      const record: Record<string, T> = {};
      for (const item of items) {
        record[getId(item)] = item;
      }
      set({ [stateKey]: record });
    },

    upsert: (item: T) => {
      const id = getId(item);
      set((state: Record<string, unknown>) => ({
        [stateKey]: {
          ...(state[stateKey] as Record<string, T>),
          [id]: item,
        },
      }));
    },

    remove: (id: string) => {
      set((state: Record<string, unknown>) => {
        const record = state[stateKey] as Record<string, T>;
        const { [id]: _, ...rest } = record;
        return { [stateKey]: rest };
      });
    },

    update: (id: string, partial: Partial<T>) => {
      set((state: Record<string, unknown>) => {
        const record = state[stateKey] as Record<string, T>;
        const existing = record[id];
        if (!existing) return state;
        return {
          [stateKey]: {
            ...record,
            [id]: { ...existing, ...partial },
          },
        };
      });
    },
  };
}

/**
 * Simplified version for entities with a top-level `id` field.
 * Most common case - just pass set, getState accessor, and key name.
 */
export function createRecordActionsById<T extends HasId>(
  set: Parameters<StateCreator<any>>[0],
  getRecordState: () => Record<string, T>,
  stateKey: string,
): RecordActions<T> {
  return createRecordActions(set, getRecordState, stateKey, (item) => item.id);
}

/**
 * Convert an array to a record keyed by ID.
 */
export function arrayToRecord<T>(items: T[], getId: IdExtractor<T>): Record<string, T> {
  const record: Record<string, T> = {};
  for (const item of items) {
    record[getId(item)] = item;
  }
  return record;
}

/**
 * Convert a record to an array.
 */
export function recordToArray<T>(record: Record<string, T>): T[] {
  return Object.values(record);
}
