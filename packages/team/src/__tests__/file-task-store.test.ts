import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileTaskStore } from '../stores/file-task-store.js';
import type { Task } from '@jam/core';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  appendFile: vi.fn(),
}));

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid-1234'),
}));

import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const mockedReadFile = vi.mocked(readFile);
const mockedWriteFile = vi.mocked(writeFile);
const mockedMkdir = vi.mocked(mkdir);
const mockedAppendFile = vi.mocked(appendFile);
const mockedRandomUUID = vi.mocked(randomUUID);

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Test task',
    description: 'A test task',
    status: 'pending',
    priority: 'normal',
    source: 'user',
    createdBy: 'user',
    createdAt: new Date().toISOString(),
    tags: [],
    ...overrides,
  };
}

describe('FileTaskStore', () => {
  let store: FileTaskStore;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockedReadFile.mockRejectedValue(new Error('ENOENT'));
    mockedWriteFile.mockResolvedValue(undefined);
    mockedMkdir.mockResolvedValue(undefined as any);
    mockedAppendFile.mockResolvedValue(undefined);
    store = new FileTaskStore('/tmp/test');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('create()', () => {
    it('should generate UUID and add task to cache', async () => {
      mockedRandomUUID.mockReturnValueOnce('generated-uuid' as any);

      const input: Omit<Task, 'id'> = {
        title: 'New task',
        description: 'Description',
        status: 'pending',
        priority: 'normal',
        source: 'user',
        createdBy: 'user',
        createdAt: new Date().toISOString(),
        tags: ['test'],
      };

      const task = await store.create(input);

      expect(task.id).toBe('generated-uuid');
      expect(task.title).toBe('New task');
      expect(task.tags).toEqual(['test']);
    });

    it('should make the created task retrievable via get()', async () => {
      mockedRandomUUID.mockReturnValueOnce('new-id' as any);

      const input: Omit<Task, 'id'> = {
        title: 'Retrievable task',
        description: 'Desc',
        status: 'pending',
        priority: 'high',
        source: 'agent',
        createdBy: 'agent-1',
        createdAt: new Date().toISOString(),
        tags: [],
      };

      await store.create(input);
      const retrieved = await store.get('new-id');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.title).toBe('Retrievable task');
    });

    it('should schedule a flush after creating a task', async () => {
      const input: Omit<Task, 'id'> = {
        title: 'Flush task',
        description: '',
        status: 'pending',
        priority: 'normal',
        source: 'user',
        createdBy: 'user',
        createdAt: new Date().toISOString(),
        tags: [],
      };

      await store.create(input);

      // Advance timers to trigger the debounced flush
      await vi.advanceTimersByTimeAsync(500);

      expect(mockedMkdir).toHaveBeenCalled();
      expect(mockedWriteFile).toHaveBeenCalled();
    });
  });

  describe('get()', () => {
    it('should return task by ID', async () => {
      const task = makeTask({ id: 'task-abc' });
      mockedReadFile.mockResolvedValueOnce(JSON.stringify([task]));

      const result = await store.get('task-abc');

      expect(result).toEqual(task);
    });

    it('should return null for non-existent task', async () => {
      mockedReadFile.mockResolvedValueOnce(JSON.stringify([]));

      const result = await store.get('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('update()', () => {
    it('should merge updates and preserve ID', async () => {
      const task = makeTask({ id: 'task-update' });
      mockedReadFile.mockResolvedValueOnce(JSON.stringify([task]));

      const updated = await store.update('task-update', {
        status: 'completed',
        result: 'Done!',
        id: 'should-be-ignored',
      });

      expect(updated.id).toBe('task-update'); // ID preserved, not overwritten
      expect(updated.status).toBe('completed');
      expect(updated.result).toBe('Done!');
      expect(updated.title).toBe('Test task'); // Original field preserved
    });

    it('should throw for non-existent task', async () => {
      mockedReadFile.mockResolvedValueOnce(JSON.stringify([]));

      await expect(
        store.update('missing-id', { status: 'completed' }),
      ).rejects.toThrow('Task not found: missing-id');
    });

    it('should schedule a flush after updating', async () => {
      const task = makeTask({ id: 'task-flush' });
      mockedReadFile.mockResolvedValueOnce(JSON.stringify([task]));

      await store.update('task-flush', { status: 'running' });

      await vi.advanceTimersByTimeAsync(500);

      expect(mockedWriteFile).toHaveBeenCalled();
    });
  });

  describe('list()', () => {
    const tasks: Task[] = [
      makeTask({ id: '1', status: 'pending', assignedTo: 'agent-a', createdBy: 'user', source: 'user' }),
      makeTask({ id: '2', status: 'completed', assignedTo: 'agent-b', createdBy: 'agent-a', source: 'agent' }),
      makeTask({ id: '3', status: 'pending', assignedTo: 'agent-a', createdBy: 'agent-b', source: 'system' }),
      makeTask({ id: '4', status: 'failed', assignedTo: 'agent-c', createdBy: 'user', source: 'schedule' }),
    ];

    beforeEach(() => {
      mockedReadFile.mockResolvedValueOnce(JSON.stringify(tasks));
    });

    it('should return all tasks when no filter provided', async () => {
      const result = await store.list();

      expect(result).toHaveLength(4);
    });

    it('should filter by status', async () => {
      const result = await store.list({ status: 'pending' });

      expect(result).toHaveLength(2);
      expect(result.every((t) => t.status === 'pending')).toBe(true);
    });

    it('should filter by assignedTo', async () => {
      const result = await store.list({ assignedTo: 'agent-a' });

      expect(result).toHaveLength(2);
      expect(result.every((t) => t.assignedTo === 'agent-a')).toBe(true);
    });

    it('should filter by createdBy', async () => {
      const result = await store.list({ createdBy: 'user' });

      expect(result).toHaveLength(2);
      expect(result.every((t) => t.createdBy === 'user')).toBe(true);
    });

    it('should filter by source', async () => {
      const result = await store.list({ source: 'agent' });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('2');
    });

    it('should combine multiple filters', async () => {
      const result = await store.list({ status: 'pending', assignedTo: 'agent-a' });

      expect(result).toHaveLength(2);
    });
  });

  describe('delete()', () => {
    it('should remove task from cache', async () => {
      const task = makeTask({ id: 'task-delete' });
      mockedReadFile.mockResolvedValueOnce(JSON.stringify([task]));

      await store.delete('task-delete');

      const result = await store.get('task-delete');
      expect(result).toBeNull();
    });

    it('should schedule flush after deletion', async () => {
      const task = makeTask({ id: 'task-del-flush' });
      mockedReadFile.mockResolvedValueOnce(JSON.stringify([task]));

      await store.delete('task-del-flush');

      await vi.advanceTimersByTimeAsync(500);

      expect(mockedWriteFile).toHaveBeenCalled();
    });
  });

  describe('loadCache()', () => {
    it('should parse JSON file and cache tasks', async () => {
      const tasks = [makeTask({ id: 'cached-1' }), makeTask({ id: 'cached-2' })];
      mockedReadFile.mockResolvedValueOnce(JSON.stringify(tasks));

      const result = await store.list();

      expect(result).toHaveLength(2);
      expect(mockedReadFile).toHaveBeenCalledWith(
        expect.stringContaining('tasks.json'),
        'utf-8',
      );
    });

    it('should handle missing file gracefully (returns empty)', async () => {
      mockedReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const result = await store.list();

      expect(result).toEqual([]);
    });

    it('should handle corrupt JSON gracefully (returns empty)', async () => {
      mockedReadFile.mockResolvedValueOnce('not valid json {{{');

      const result = await store.list();

      expect(result).toEqual([]);
    });

    it('should only read from file once (uses cache on subsequent calls)', async () => {
      mockedReadFile.mockResolvedValueOnce(JSON.stringify([makeTask()]));

      await store.list();
      await store.list();
      await store.list();

      expect(mockedReadFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('task archival', () => {
    it('should archive completed tasks older than 7 days to tasks-archive.jsonl', async () => {
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      const oldCompleted = makeTask({
        id: 'old-done',
        status: 'completed',
        completedAt: eightDaysAgo,
      });
      const recentPending = makeTask({ id: 'active', status: 'pending' });

      mockedReadFile.mockResolvedValueOnce(JSON.stringify([oldCompleted, recentPending]));

      const result = await store.list();

      // Active task should remain
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('active');

      // Archived task written to archive file
      expect(mockedAppendFile).toHaveBeenCalledWith(
        expect.stringContaining('tasks-archive.jsonl'),
        expect.stringContaining('"old-done"'),
        'utf-8',
      );
    });

    it('should archive failed tasks older than 7 days', async () => {
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const oldFailed = makeTask({
        id: 'old-failed',
        status: 'failed',
        completedAt: oldDate,
      });

      mockedReadFile.mockResolvedValueOnce(JSON.stringify([oldFailed]));

      const result = await store.list();

      expect(result).toHaveLength(0);
      expect(mockedAppendFile).toHaveBeenCalled();
    });

    it('should archive cancelled tasks older than 7 days', async () => {
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const oldCancelled = makeTask({
        id: 'old-cancelled',
        status: 'cancelled',
        completedAt: oldDate,
      });

      mockedReadFile.mockResolvedValueOnce(JSON.stringify([oldCancelled]));

      const result = await store.list();

      expect(result).toHaveLength(0);
      expect(mockedAppendFile).toHaveBeenCalled();
    });

    it('should keep active tasks in primary store', async () => {
      const recentCompleted = makeTask({
        id: 'recent-done',
        status: 'completed',
        completedAt: new Date().toISOString(), // Just now, not old enough
      });
      const runningTask = makeTask({ id: 'running', status: 'running' });
      const pendingTask = makeTask({ id: 'pending', status: 'pending' });

      mockedReadFile.mockResolvedValueOnce(
        JSON.stringify([recentCompleted, runningTask, pendingTask]),
      );

      const result = await store.list();

      expect(result).toHaveLength(3);
      expect(mockedAppendFile).not.toHaveBeenCalled();
    });

    it('should not archive completed tasks without completedAt', async () => {
      const completedNoDate = makeTask({
        id: 'no-date',
        status: 'completed',
        completedAt: undefined,
      });

      mockedReadFile.mockResolvedValueOnce(JSON.stringify([completedNoDate]));

      const result = await store.list();

      expect(result).toHaveLength(1);
      expect(mockedAppendFile).not.toHaveBeenCalled();
    });

    it('should trigger flush when tasks are archived', async () => {
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const oldTask = makeTask({
        id: 'archived',
        status: 'completed',
        completedAt: oldDate,
      });

      mockedReadFile.mockResolvedValueOnce(JSON.stringify([oldTask]));

      await store.list();

      // Flush should be scheduled due to archival
      await vi.advanceTimersByTimeAsync(500);

      expect(mockedWriteFile).toHaveBeenCalled();
    });
  });

  describe('flush', () => {
    it('should write compact JSON (no pretty-printing)', async () => {
      const task = makeTask({ id: 'compact' });
      mockedReadFile.mockResolvedValueOnce(JSON.stringify([task]));

      await store.list(); // load cache
      await store.update('compact', { status: 'running' });

      await vi.advanceTimersByTimeAsync(500);

      const writeCall = mockedWriteFile.mock.calls[0];
      const written = writeCall[1] as string;

      // Compact JSON should NOT have newlines or indentation
      expect(written).not.toContain('\n');
      expect(written).not.toContain('  ');
      // It should be valid JSON
      expect(() => JSON.parse(written)).not.toThrow();
    });

    it('should create directory before writing', async () => {
      mockedReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      await store.create({
        title: 'Mkdir task',
        description: '',
        status: 'pending',
        priority: 'normal',
        source: 'user',
        createdBy: 'user',
        createdAt: new Date().toISOString(),
        tags: [],
      });

      await vi.advanceTimersByTimeAsync(500);

      expect(mockedMkdir).toHaveBeenCalledWith(
        expect.any(String),
        { recursive: true },
      );
    });
  });

  describe('scheduleFlush debouncing', () => {
    it('should only create one timer for multiple rapid changes', async () => {
      const tasks = [
        makeTask({ id: 't1' }),
        makeTask({ id: 't2' }),
        makeTask({ id: 't3' }),
      ];
      mockedReadFile.mockResolvedValueOnce(JSON.stringify(tasks));

      // Multiple rapid updates
      await store.update('t1', { status: 'running' });
      await store.update('t2', { status: 'running' });
      await store.update('t3', { status: 'running' });

      // Advance timers once
      await vi.advanceTimersByTimeAsync(500);

      // Should only have written once due to debouncing
      expect(mockedWriteFile).toHaveBeenCalledTimes(1);
    });

    it('should allow a new flush after the previous timer fires', async () => {
      const tasks = [makeTask({ id: 't1' }), makeTask({ id: 't2' })];
      mockedReadFile.mockResolvedValueOnce(JSON.stringify(tasks));

      // First batch
      await store.update('t1', { status: 'running' });
      await vi.advanceTimersByTimeAsync(500);

      // Second batch
      await store.update('t2', { status: 'completed' });
      await vi.advanceTimersByTimeAsync(500);

      expect(mockedWriteFile).toHaveBeenCalledTimes(2);
    });
  });
});
