import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentStats, IStatsStore } from '@jam/core';
import { DebouncedFileWriter, writeJsonFile } from '../utils/debounced-writer.js';

function defaultStats(agentId: string): AgentStats {
  return {
    agentId,
    tasksCompleted: 0,
    tasksFailed: 0,
    totalTokensIn: 0,
    totalTokensOut: 0,
    totalExecutionMs: 0,
    averageResponseMs: 0,
    uptime: 0,
    lastActive: new Date().toISOString(),
    streaks: { current: 0, best: 0 },
  };
}

export class FileStatsStore implements IStatsStore {
  private readonly baseDir: string;
  private cache: Map<string, AgentStats> = new Map();
  private writers: Map<string, DebouncedFileWriter> = new Map();

  constructor(baseDir: string) {
    this.baseDir = join(baseDir, 'stats');
  }

  async get(agentId: string): Promise<AgentStats | null> {
    if (this.cache.has(agentId)) {
      return this.cache.get(agentId)!;
    }

    const filePath = join(this.baseDir, `${agentId}.json`);
    try {
      const data = await readFile(filePath, 'utf-8');
      const stats: AgentStats = JSON.parse(data);
      this.cache.set(agentId, stats);
      return stats;
    } catch {
      return null;
    }
  }

  async update(agentId: string, delta: Partial<AgentStats>): Promise<AgentStats> {
    let stats = await this.get(agentId);
    if (!stats) {
      stats = defaultStats(agentId);
    }
    Object.assign(stats, delta, { agentId });
    this.cache.set(agentId, stats);
    this.scheduleFlush(agentId);
    return stats;
  }

  async incrementTokens(
    agentId: string,
    tokensIn: number,
    tokensOut: number,
  ): Promise<void> {
    let stats = await this.get(agentId);
    if (!stats) {
      stats = defaultStats(agentId);
    }
    stats.totalTokensIn += tokensIn;
    stats.totalTokensOut += tokensOut;
    stats.lastActive = new Date().toISOString();
    this.cache.set(agentId, stats);
    this.scheduleFlush(agentId);
  }

  async recordExecution(
    agentId: string,
    durationMs: number,
    success: boolean,
  ): Promise<void> {
    let stats = await this.get(agentId);
    if (!stats) {
      stats = defaultStats(agentId);
    }

    const totalExecs = stats.tasksCompleted + stats.tasksFailed;
    stats.totalExecutionMs += durationMs;
    stats.averageResponseMs =
      totalExecs === 0
        ? durationMs
        : (stats.averageResponseMs * totalExecs + durationMs) / (totalExecs + 1);

    if (success) {
      stats.tasksCompleted++;
      stats.streaks.current++;
      stats.streaks.best = Math.max(stats.streaks.best, stats.streaks.current);
    } else {
      stats.tasksFailed++;
      stats.streaks.current = 0;
    }

    stats.lastActive = new Date().toISOString();
    this.cache.set(agentId, stats);
    this.scheduleFlush(agentId);
  }

  private scheduleFlush(agentId: string): void {
    let writer = this.writers.get(agentId);
    if (!writer) {
      writer = new DebouncedFileWriter(500);
      this.writers.set(agentId, writer);
    }
    writer.schedule(() => this.flush(agentId));
  }

  private async flush(agentId: string): Promise<void> {
    const stats = this.cache.get(agentId);
    if (!stats) return;
    const filePath = join(this.baseDir, `${agentId}.json`);
    await writeJsonFile(filePath, stats);
  }

  /** Force-flush all pending writes (call before shutdown). */
  async stop(): Promise<void> {
    const flushes = Array.from(this.writers.entries()).map(([agentId, writer]) =>
      writer.flushNow(() => this.flush(agentId)),
    );
    await Promise.all(flushes);
  }
}
