import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileStatsStore } from '../stores/file-stats-store.js';
import type { AgentStats } from '@jam/core';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

import { readFile, writeFile, mkdir } from 'node:fs/promises';

const mockedReadFile = vi.mocked(readFile);
const mockedWriteFile = vi.mocked(writeFile);
const mockedMkdir = vi.mocked(mkdir);

function makeStats(overrides: Partial<AgentStats> = {}): AgentStats {
  return {
    agentId: 'agent-1',
    tasksCompleted: 0,
    tasksFailed: 0,
    totalTokensIn: 0,
    totalTokensOut: 0,
    totalExecutionMs: 0,
    averageResponseMs: 0,
    uptime: 0,
    lastActive: '2026-01-01T00:00:00.000Z',
    streaks: { current: 0, best: 0 },
    ...overrides,
  };
}

describe('FileStatsStore', () => {
  let store: FileStatsStore;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockedReadFile.mockRejectedValue(new Error('ENOENT'));
    mockedWriteFile.mockResolvedValue(undefined);
    mockedMkdir.mockResolvedValue(undefined as any);
    store = new FileStatsStore('/tmp/test');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('get()', () => {
    it('should read from file and cache the result', async () => {
      const stats = makeStats({ agentId: 'agent-x' });
      mockedReadFile.mockResolvedValueOnce(JSON.stringify(stats));

      const result = await store.get('agent-x');

      expect(result).toEqual(stats);
      expect(mockedReadFile).toHaveBeenCalledWith(
        expect.stringContaining('agent-x.json'),
        'utf-8',
      );
    });

    it('should return null for missing agent (file not found)', async () => {
      mockedReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const result = await store.get('missing-agent');

      expect(result).toBeNull();
    });

    it('should return cached value on subsequent calls', async () => {
      const stats = makeStats({ agentId: 'cached-agent' });
      mockedReadFile.mockResolvedValueOnce(JSON.stringify(stats));

      const first = await store.get('cached-agent');
      const second = await store.get('cached-agent');
      const third = await store.get('cached-agent');

      expect(first).toEqual(stats);
      expect(second).toEqual(stats);
      expect(third).toEqual(stats);
      // Only one file read - subsequent calls use cache
      expect(mockedReadFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('update()', () => {
    it('should create default stats if none exist', async () => {
      // File does not exist
      mockedReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const result = await store.update('new-agent', { uptime: 100 });

      expect(result.agentId).toBe('new-agent');
      expect(result.tasksCompleted).toBe(0);
      expect(result.tasksFailed).toBe(0);
      expect(result.uptime).toBe(100);
      expect(result.streaks).toEqual({ current: 0, best: 0 });
    });

    it('should merge delta into existing stats', async () => {
      const existing = makeStats({
        agentId: 'agent-merge',
        tasksCompleted: 5,
        uptime: 200,
      });
      mockedReadFile.mockResolvedValueOnce(JSON.stringify(existing));

      const result = await store.update('agent-merge', {
        tasksCompleted: 10,
        uptime: 500,
      });

      expect(result.tasksCompleted).toBe(10);
      expect(result.uptime).toBe(500);
      // agentId should always stay correct
      expect(result.agentId).toBe('agent-merge');
    });

    it('should preserve agentId even if delta tries to override it', async () => {
      mockedReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const result = await store.update('correct-id', {
        agentId: 'wrong-id',
      } as Partial<AgentStats>);

      expect(result.agentId).toBe('correct-id');
    });

    it('should schedule a flush after updating', async () => {
      mockedReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      await store.update('flush-agent', { uptime: 50 });

      await vi.advanceTimersByTimeAsync(500);

      expect(mockedMkdir).toHaveBeenCalledWith(
        expect.stringContaining('stats'),
        { recursive: true },
      );
      expect(mockedWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('flush-agent.json'),
        expect.any(String),
        'utf-8',
      );
    });
  });

  describe('incrementTokens()', () => {
    it('should add to totals for existing stats', async () => {
      const existing = makeStats({
        agentId: 'token-agent',
        totalTokensIn: 100,
        totalTokensOut: 50,
      });
      mockedReadFile.mockResolvedValueOnce(JSON.stringify(existing));

      await store.incrementTokens('token-agent', 200, 75);

      const result = await store.get('token-agent');
      expect(result!.totalTokensIn).toBe(300);
      expect(result!.totalTokensOut).toBe(125);
    });

    it('should create default stats if none exist', async () => {
      mockedReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      await store.incrementTokens('new-token-agent', 50, 25);

      const result = await store.get('new-token-agent');
      expect(result!.totalTokensIn).toBe(50);
      expect(result!.totalTokensOut).toBe(25);
    });

    it('should update lastActive timestamp', async () => {
      const existing = makeStats({
        agentId: 'time-agent',
        lastActive: '2020-01-01T00:00:00.000Z',
      });
      mockedReadFile.mockResolvedValueOnce(JSON.stringify(existing));

      vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'));

      await store.incrementTokens('time-agent', 10, 5);

      const result = await store.get('time-agent');
      expect(result!.lastActive).toBe('2026-06-15T12:00:00.000Z');
    });

    it('should schedule a flush', async () => {
      mockedReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      await store.incrementTokens('flush-tokens', 10, 5);

      await vi.advanceTimersByTimeAsync(500);

      expect(mockedWriteFile).toHaveBeenCalled();
    });
  });

  describe('recordExecution()', () => {
    it('should set averageResponseMs to durationMs on first execution', async () => {
      mockedReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      await store.recordExecution('exec-agent', 1000, true);

      const result = await store.get('exec-agent');
      // First execution: totalExecs (0+0) = 0, so averageResponseMs = durationMs
      expect(result!.averageResponseMs).toBe(1000);
    });

    it('should compute running average on subsequent executions', async () => {
      const existing = makeStats({
        agentId: 'avg-agent',
        tasksCompleted: 1,
        tasksFailed: 0,
        averageResponseMs: 1000,
        totalExecutionMs: 1000,
      });
      mockedReadFile.mockResolvedValueOnce(JSON.stringify(existing));

      await store.recordExecution('avg-agent', 500, true);

      const result = await store.get('avg-agent');
      // totalExecs = 1+0 = 1, new avg = (1000*1 + 500) / 2 = 750
      expect(result!.averageResponseMs).toBe(750);
      expect(result!.totalExecutionMs).toBe(1500);
    });

    it('should increment tasksCompleted on success', async () => {
      mockedReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      await store.recordExecution('success-agent', 200, true);

      const result = await store.get('success-agent');
      expect(result!.tasksCompleted).toBe(1);
      expect(result!.tasksFailed).toBe(0);
    });

    it('should increment tasksFailed on failure', async () => {
      mockedReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      await store.recordExecution('fail-agent', 300, false);

      const result = await store.get('fail-agent');
      expect(result!.tasksCompleted).toBe(0);
      expect(result!.tasksFailed).toBe(1);
    });

    it('should update lastActive timestamp', async () => {
      mockedReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      vi.setSystemTime(new Date('2026-03-01T10:00:00.000Z'));

      await store.recordExecution('time-exec', 100, true);

      const result = await store.get('time-exec');
      expect(result!.lastActive).toBe('2026-03-01T10:00:00.000Z');
    });
  });

  describe('streak management', () => {
    it('should increment current streak on success', async () => {
      mockedReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      await store.recordExecution('streak-agent', 100, true);

      const result = await store.get('streak-agent');
      expect(result!.streaks.current).toBe(1);
    });

    it('should track best streak', async () => {
      const existing = makeStats({
        agentId: 'best-streak',
        tasksCompleted: 2,
        tasksFailed: 0,
        averageResponseMs: 100,
        streaks: { current: 2, best: 2 },
      });
      mockedReadFile.mockResolvedValueOnce(JSON.stringify(existing));

      await store.recordExecution('best-streak', 100, true);

      const result = await store.get('best-streak');
      expect(result!.streaks.current).toBe(3);
      expect(result!.streaks.best).toBe(3);
    });

    it('should reset current streak on failure', async () => {
      const existing = makeStats({
        agentId: 'reset-streak',
        tasksCompleted: 5,
        tasksFailed: 0,
        averageResponseMs: 100,
        streaks: { current: 5, best: 5 },
      });
      mockedReadFile.mockResolvedValueOnce(JSON.stringify(existing));

      await store.recordExecution('reset-streak', 100, false);

      const result = await store.get('reset-streak');
      expect(result!.streaks.current).toBe(0);
      expect(result!.streaks.best).toBe(5); // Best preserved
    });

    it('should not update best streak when current is less than best', async () => {
      const existing = makeStats({
        agentId: 'lower-streak',
        tasksCompleted: 1,
        tasksFailed: 1,
        averageResponseMs: 100,
        streaks: { current: 1, best: 10 },
      });
      mockedReadFile.mockResolvedValueOnce(JSON.stringify(existing));

      await store.recordExecution('lower-streak', 100, true);

      const result = await store.get('lower-streak');
      expect(result!.streaks.current).toBe(2);
      expect(result!.streaks.best).toBe(10); // Best unchanged
    });
  });

  describe('flush', () => {
    it('should write compact JSON (no pretty-printing)', async () => {
      mockedReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      await store.update('compact-agent', { uptime: 42 });

      await vi.advanceTimersByTimeAsync(500);

      const writeCall = mockedWriteFile.mock.calls[0];
      const written = writeCall[1] as string;

      // Compact JSON should NOT have newlines or indentation
      expect(written).not.toContain('\n');
      expect(written).not.toContain('  ');
      // Should be valid JSON
      expect(() => JSON.parse(written)).not.toThrow();
    });

    it('should debounce multiple rapid changes for the same agent', async () => {
      const existing = makeStats({ agentId: 'debounce-agent' });
      mockedReadFile.mockResolvedValueOnce(JSON.stringify(existing));

      await store.update('debounce-agent', { uptime: 1 });
      await store.update('debounce-agent', { uptime: 2 });
      await store.update('debounce-agent', { uptime: 3 });

      await vi.advanceTimersByTimeAsync(500);

      expect(mockedWriteFile).toHaveBeenCalledTimes(1);
    });
  });
});
