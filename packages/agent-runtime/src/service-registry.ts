import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createLogger } from '@jam/core';

const log = createLogger('ServiceRegistry');

const SERVICES_FILE = '.services.json';

/** Grace period (ms) after restart during which we trust the service is alive */
const RESTART_GRACE_MS = 10_000;
/** How often the health monitor checks services (ms) */
const HEALTH_CHECK_INTERVAL_MS = 8_000;
/** Consecutive failures before marking a service as dead */
const FAILURE_THRESHOLD = 3;

export interface TrackedService {
  agentId: string;
  /** Port the service listens on — primary identifier */
  port: number;
  name: string;
  logFile?: string;
  startedAt: string;
  alive?: boolean;
  /** The shell command used to start this service (for restart) */
  command?: string;
  /** Working directory the service was started from */
  cwd?: string;
}

export class ServiceRegistry {
  /** Cached services by agentId */
  private services = new Map<string, TrackedService[]>();
  /** Track recently restarted services (name → timestamp) to avoid false-dead during startup */
  private recentRestarts = new Map<string, number>();
  /** Consecutive health check failures per service (key: "agentId:name") */
  private failureCounts = new Map<string, number>();
  /** Health monitor interval handle */
  private healthInterval: ReturnType<typeof setInterval> | null = null;

  /** Scan an agent's workspace for `.services.json` and update cache.
   *  Checks both the root cwd and immediate subdirectories (agents may
   *  create projects in subdirs that register their own services).
   *  Keeps dead entries visible (alive=false) for restart capability. */
  async scan(agentId: string, cwd: string): Promise<TrackedService[]> {
    // Collect all .services.json paths: root + one level of subdirectories
    const servicePaths: string[] = [];
    const rootPath = join(cwd, SERVICES_FILE);
    if (existsSync(rootPath)) servicePaths.push(rootPath);

    try {
      const SKIP = new Set(['node_modules', '.git', '__pycache__', 'conversations']);
      const dirEntries = await readdir(cwd, { withFileTypes: true });
      for (const entry of dirEntries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
        const subPath = join(cwd, entry.name, SERVICES_FILE);
        if (existsSync(subPath)) servicePaths.push(subPath);
      }
    } catch { /* cwd might not exist or be unreadable */ }

    if (servicePaths.length === 0) {
      this.services.delete(agentId);
      return [];
    }

    const allEntries: TrackedService[] = [];

    for (const filePath of servicePaths) {
      try {
        const content = await readFile(filePath, 'utf-8');
        const lines = content.trim().split('\n').filter(Boolean);
        // Derive cwd for this .services.json (the directory it lives in)
        const serviceCwd = filePath.replace(/[/\\]\.services\.json$/, '');

        for (const line of lines) {
          try {
            const raw = JSON.parse(line);
            // Port is required — services without a port can't be tracked
            if (!raw.port || !raw.name) continue;

            // Check if port is responding (primary alive indicator)
            let alive = await isPortAlive(raw.port);

            // During the grace period after restart, trust the service is alive
            const restartedAt = this.recentRestarts.get(raw.name);
            if (!alive && restartedAt && Date.now() - restartedAt < RESTART_GRACE_MS) {
              alive = true;
            }

            allEntries.push({
              agentId,
              port: raw.port,
              name: raw.name,
              logFile: raw.logFile ?? undefined,
              startedAt: raw.startedAt ?? new Date().toISOString(),
              alive,
              command: raw.command ?? undefined,
              cwd: raw.cwd ?? serviceCwd,
            });
          } catch { /* skip malformed line */ }
        }
      } catch (err) {
        log.warn(`Failed to read ${filePath}: ${String(err)}`);
      }
    }

    // Deduplicate: keep the latest entry per service name AND per port.
    // Same port = same service even if the name changed between runs.
    const byName = new Map<string, TrackedService>();
    const byPort = new Map<number, TrackedService>();

    // Sort oldest-first so later (newer) entries overwrite earlier ones
    allEntries.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

    for (const entry of allEntries) {
      // If this port was already claimed by a newer-named service, evict the old name
      const prev = byPort.get(entry.port);
      if (prev && prev.name !== entry.name) {
        byName.delete(prev.name);
      }
      byPort.set(entry.port, entry);
      byName.set(entry.name, entry);
    }
    const deduped = Array.from(byName.values());

    this.services.set(agentId, deduped);
    return deduped;
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

  /** Stop a service by port — resolves the actual PID via lsof and kills it */
  async stopService(port: number): Promise<boolean> {
    const pid = await findPidByPort(port);
    if (!pid) {
      log.warn(`No process found listening on port ${port}`);
      return false;
    }
    try {
      process.kill(pid, 'SIGTERM');
      log.info(`Stopped service on port ${port} (PID ${pid})`);
      // Mark as dead in cache (keep the entry for restart)
      for (const [, services] of this.services) {
        for (const svc of services) {
          if (svc.port === port) {
            svc.alive = false;
            const key = `${svc.agentId}:${svc.name}`;
            this.failureCounts.delete(key);
          }
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Restart a stopped service by name. Requires `command` + `cwd` in the entry. */
  restartService(serviceName: string): { success: boolean; error?: string } {
    // Find the service entry
    let entry: TrackedService | undefined;
    for (const services of this.services.values()) {
      entry = services.find(s => s.name === serviceName);
      if (entry) break;
    }

    if (!entry) return { success: false, error: 'Service not found' };
    if (!entry.command) return { success: false, error: 'No command recorded — cannot restart' };
    if (entry.alive) return { success: false, error: 'Service is already running' };

    const cwd = entry.cwd || process.cwd();
    const logFile = entry.logFile || `logs/${entry.name}.log`;
    const logPath = join(cwd, logFile);

    try {
      const child = spawn('sh', ['-c', `${entry.command} > ${logPath} 2>&1`], {
        cwd,
        detached: true,
        stdio: 'ignore',
      });
      child.unref();

      log.info(`Restarted service "${entry.name}" on port ${entry.port} in ${cwd}`);

      // Update the cache entry in-place
      entry.alive = true;
      entry.startedAt = new Date().toISOString();

      // Mark grace period so health checks don't prematurely mark it dead
      this.recentRestarts.set(entry.name, Date.now());
      // Reset failure counter
      this.failureCounts.delete(`${entry.agentId}:${entry.name}`);

      // Append new entry to .services.json (port-based, no PID)
      const servicesFile = join(cwd, SERVICES_FILE);
      const line = JSON.stringify({
        port: entry.port,
        name: entry.name,
        command: entry.command,
        cwd,
        logFile,
        startedAt: entry.startedAt,
      });
      writeFile(servicesFile, line + '\n', { flag: 'a' }).catch(() => {});

      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  // ── Health Monitor ──────────────────────────────────────────────

  /** Start the background health monitor.
   *  Checks all cached services on an interval, using consecutive failure
   *  thresholds to avoid flicker from transient check failures. */
  startHealthMonitor(): void {
    if (this.healthInterval) return;
    log.info(`Health monitor started (interval=${HEALTH_CHECK_INTERVAL_MS}ms, threshold=${FAILURE_THRESHOLD})`);
    this.healthInterval = setInterval(() => {
      this.runHealthChecks().catch((err) =>
        log.warn(`Health check error: ${String(err)}`),
      );
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  /** Stop the background health monitor */
  stopHealthMonitor(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
      log.info('Health monitor stopped');
    }
  }

  /** Run a single health check cycle across all cached services */
  private async runHealthChecks(): Promise<void> {
    for (const [, services] of this.services) {
      for (const svc of services) {
        const key = `${svc.agentId}:${svc.name}`;

        // Skip services in restart grace period
        const restartedAt = this.recentRestarts.get(svc.name);
        if (restartedAt && Date.now() - restartedAt < RESTART_GRACE_MS) {
          continue;
        }

        // Port-based health check — the only indicator we use
        const healthy = await isPortAlive(svc.port);

        if (healthy) {
          // Service is up — reset failure count and mark alive
          if (!svc.alive) {
            log.info(`Service "${svc.name}" (port ${svc.port}) is now alive`);
          }
          svc.alive = true;
          this.failureCounts.delete(key);
        } else {
          // Service check failed — increment failure counter
          const failures = (this.failureCounts.get(key) ?? 0) + 1;
          this.failureCounts.set(key, failures);

          if (failures >= FAILURE_THRESHOLD && svc.alive !== false) {
            log.warn(`Service "${svc.name}" (port ${svc.port}) marked dead after ${failures} consecutive failures`);
            svc.alive = false;
          }
        }
      }
    }
  }

  /** Stop all tracked services for a specific agent */
  async stopForAgent(agentId: string): Promise<void> {
    const services = this.services.get(agentId) ?? [];
    await Promise.all(services.map(svc => this.killServiceByPort(svc.port, svc.name)));
    this.services.delete(agentId);
  }

  /** Stop ALL tracked services across all agents */
  async stopAll(): Promise<void> {
    this.stopHealthMonitor();
    const kills: Promise<void>[] = [];
    for (const [, services] of this.services) {
      for (const svc of services) {
        kills.push(this.killServiceByPort(svc.port, svc.name));
      }
    }
    await Promise.all(kills);
    this.services.clear();
  }

  /** Safely kill a service by finding the PID listening on its port */
  private async killServiceByPort(port: number, name: string): Promise<void> {
    const pid = await findPidByPort(port);
    if (!pid) return;

    try {
      process.kill(pid, 'SIGTERM');
      log.info(`Stopped service "${name}" (PID ${pid}, port ${port})`);
    } catch { /* already dead */ }
  }
}

/** Check if a port is reachable via TCP connect (health check) */
function isPortAlive(port: number, timeoutMs = 2000): Promise<boolean> {
  const { createConnection } = require('node:net') as typeof import('node:net');
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => { resolve(false); });
  });
}

/** Find the PID listening on a given port using lsof.
 *  Uses `-sTCP:LISTEN` to only match the server process (not clients).
 *  Excludes our own PID to prevent self-kill. */
function findPidByPort(port: number): Promise<number | null> {
  const { execSync } = require('node:child_process') as typeof import('node:child_process');
  const ownPid = process.pid;
  try {
    const output = execSync(`lsof -ti :${port} -sTCP:LISTEN`, { encoding: 'utf-8', timeout: 3000 });
    const pids = output.trim().split('\n')
      .map(l => parseInt(l.trim(), 10))
      .filter(p => Number.isFinite(p) && p !== ownPid);
    return Promise.resolve(pids.length > 0 ? pids[0] : null);
  } catch {
    return Promise.resolve(null);
  }
}
