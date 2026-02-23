import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '@jam/core';

const log = createLogger('ServiceRegistry');

const SERVICES_FILE = '.services.json';

export interface TrackedService {
  agentId: string;
  pid: number;
  port?: number;
  name: string;
  logFile?: string;
  startedAt: string;
  alive?: boolean;
}

/** Tracks background processes spawned by agents.
 *  Agents write to `.services.json` in their workspace directory.
 *  Jam reads these files to monitor, display, and clean up services. */
export class ServiceRegistry {
  /** Cached services by agentId */
  private services = new Map<string, TrackedService[]>();

  /** Scan an agent's workspace for `.services.json` and update cache.
   *  Prunes entries whose PIDs are no longer alive. */
  async scan(agentId: string, cwd: string): Promise<TrackedService[]> {
    const filePath = join(cwd, SERVICES_FILE);
    if (!existsSync(filePath)) {
      this.services.delete(agentId);
      return [];
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const entries: TrackedService[] = [];

      for (const line of lines) {
        try {
          const raw = JSON.parse(line);
          if (!raw.pid || !raw.name) continue;
          const alive = isProcessAlive(raw.pid);
          entries.push({
            agentId,
            pid: raw.pid,
            port: raw.port ?? undefined,
            name: raw.name,
            logFile: raw.logFile ?? undefined,
            startedAt: raw.startedAt ?? new Date().toISOString(),
            alive,
          });
        } catch { /* skip malformed line */ }
      }

      // Prune dead entries and rewrite the file
      const alive = entries.filter(s => s.alive);
      if (alive.length < entries.length) {
        await this.rewriteFile(filePath, alive);
      }

      this.services.set(agentId, alive);
      return alive;
    } catch (err) {
      log.warn(`Failed to scan services for ${agentId}: ${String(err)}`);
      return [];
    }
  }

  /** Scan all agents' workspaces */
  async scanAll(agents: Array<{ id: string; cwd?: string }>): Promise<void> {
    await Promise.all(
      agents
        .filter(a => a.cwd)
        .map(a => this.scan(a.id, a.cwd!)),
    );
  }

  /** List all tracked services across all agents */
  list(): TrackedService[] {
    const all: TrackedService[] = [];
    for (const services of this.services.values()) {
      all.push(...services);
    }
    return all;
  }

  /** List services for a specific agent */
  listForAgent(agentId: string): TrackedService[] {
    return this.services.get(agentId) ?? [];
  }

  /** Stop a specific service by PID */
  stopService(pid: number): boolean {
    try {
      process.kill(pid, 'SIGTERM');
      log.info(`Stopped service PID ${pid}`);
      // Remove from cache
      for (const [agentId, services] of this.services) {
        const filtered = services.filter(s => s.pid !== pid);
        if (filtered.length < services.length) {
          this.services.set(agentId, filtered);
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Stop all tracked services for a specific agent */
  stopForAgent(agentId: string): void {
    const services = this.services.get(agentId) ?? [];
    for (const svc of services) {
      try {
        process.kill(svc.pid, 'SIGTERM');
        log.info(`Stopped service "${svc.name}" (PID ${svc.pid}) for agent ${agentId}`);
      } catch { /* already dead */ }
    }
    this.services.delete(agentId);
  }

  /** Stop ALL tracked services across all agents */
  stopAll(): void {
    for (const [agentId, services] of this.services) {
      for (const svc of services) {
        try {
          process.kill(svc.pid, 'SIGTERM');
          log.info(`Stopped service "${svc.name}" (PID ${svc.pid}) for agent ${agentId}`);
        } catch { /* already dead */ }
      }
    }
    this.services.clear();
  }

  /** Rewrite .services.json with only alive entries */
  private async rewriteFile(filePath: string, services: TrackedService[]): Promise<void> {
    const lines = services.map(s => JSON.stringify({
      pid: s.pid,
      port: s.port,
      name: s.name,
      logFile: s.logFile,
      startedAt: s.startedAt,
    }));
    await writeFile(filePath, lines.join('\n') + '\n', 'utf-8');
  }
}

/** Check if a process is alive */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
