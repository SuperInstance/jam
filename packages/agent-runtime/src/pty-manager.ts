import type { AgentId } from '@jam/core';
import { createLogger } from '@jam/core';
import type * as pty from 'node-pty';
import treeKill from 'tree-kill';
import { buildCleanEnv } from './utils.js';
import { PtyDataHandler } from './pty-utils.js';

const log = createLogger('PtyManager');

/**
 * Escape a string for use in a shell command.
 * Wraps in single quotes, escaping any embedded single quotes.
 */
export function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export interface PtySpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

export interface PtySpawnResult {
  success: boolean;
  pid?: number;
  error?: string;
}

export interface PtyOutputHandler {
  (agentId: AgentId, data: string): void;
}

export interface PtyExitHandler {
  (agentId: AgentId, exitCode: number, lastOutput: string): void;
}

/** Abstract interface for PTY management — enables native and Docker implementations */
export interface IPtyManager {
  spawn(agentId: AgentId, command: string, args: string[], options: PtySpawnOptions): Promise<PtySpawnResult>;
  write(agentId: AgentId, data: string): void;
  resize(agentId: AgentId, cols: number, rows: number): void;
  kill(agentId: AgentId): void;
  getScrollback(agentId: AgentId): string;
  isRunning(agentId: AgentId): boolean;
  killAll(): void;
  onOutput(handler: PtyOutputHandler): void;
  onExit(handler: PtyExitHandler): void;
}

export interface PtyInstance {
  agentId: AgentId;
  process: pty.IPty;
  dataHandler: PtyDataHandler;
}

export class PtyManager implements IPtyManager {
  private instances = new Map<string, PtyInstance>();
  private outputHandler: PtyOutputHandler | null = null;
  private exitHandler: PtyExitHandler | null = null;
  onOutput(handler: PtyOutputHandler): void {
    this.outputHandler = handler;
  }

  onExit(handler: PtyExitHandler): void {
    this.exitHandler = handler;
  }

  async spawn(
    agentId: AgentId,
    command: string,
    args: string[],
    options: PtySpawnOptions,
  ): Promise<PtySpawnResult> {
    if (this.instances.has(agentId)) {
      return { success: false, error: 'PTY already exists for this agent' };
    }

    try {
      // Dynamic import to avoid issues in renderer/test contexts
      const nodePty = await import('node-pty');

      // Spawn through the user's shell (non-login). We use -c instead of -lc
      // because: (1) the Electron main process already resolves the full PATH
      // via fixPath() at startup, (2) login shells re-source profiles which can
      // override PATH (e.g. nvm resets to an older Node version), and (3) we
      // pass the complete env explicitly so login profile sourcing is unnecessary.
      const shell = process.env.SHELL || '/bin/zsh';
      const agentCmd = [command, ...args].map(shellEscape).join(' ');
      const shellCmd = agentCmd;
      log.info(`Spawning via shell: ${shell} -c ${shellCmd}`, undefined, agentId);

      // Build a clean env — filter out vars that break posix_spawnp
      // or cause nested-session detection (CLAUDECODE, CLAUDE_PARENT_CLI)
      const env = buildCleanEnv({
        ...options.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      });

      const ptyProcess = nodePty.spawn(shell, ['-c', shellCmd], {
        name: 'xterm-256color',
        cols: options.cols ?? 120,
        rows: options.rows ?? 30,
        cwd: options.cwd ?? process.env.HOME ?? '/',
        env,
      });

      // Shared data handler: DSR interception, scrollback, output batching
      const dataHandler = new PtyDataHandler(agentId, ptyProcess, () => this.outputHandler);

      const instance: PtyInstance = {
        agentId,
        process: ptyProcess,
        dataHandler,
      };

      ptyProcess.onData((data: string) => dataHandler.onData(data));

      ptyProcess.onExit(({ exitCode }) => {
        dataHandler.flush();
        const lastOutput = dataHandler.getLastOutput();
        this.instances.delete(agentId);
        this.exitHandler?.(agentId, exitCode, lastOutput);
      });

      this.instances.set(agentId, instance);
      log.info(`Spawned PTY for agent: ${command} ${args.join(' ')} (PID: ${ptyProcess.pid})`, undefined, agentId);
      return { success: true, pid: ptyProcess.pid };
    } catch (error) {
      log.error(`Failed to spawn PTY: ${String(error)}`, { command, args }, agentId);
      return { success: false, error: String(error) };
    }
  }

  write(agentId: AgentId, data: string): void {
    const instance = this.instances.get(agentId);
    if (instance) {
      instance.process.write(data);
    }
  }

  resize(agentId: AgentId, cols: number, rows: number): void {
    const instance = this.instances.get(agentId);
    if (instance) {
      instance.process.resize(cols, rows);
    }
  }

  kill(agentId: AgentId): void {
    const instance = this.instances.get(agentId);
    if (instance) {
      const pid = instance.process.pid;
      this.instances.delete(agentId);
      // Kill the entire process tree (shell + all children spawned by the agent)
      // Uses pgrep -P on macOS to recursively find descendants, like VS Code's terminateProcess.sh
      treeKill(pid, 'SIGTERM', (err) => {
        if (err) log.warn(`tree-kill failed for PID ${pid}: ${err.message}`, undefined, agentId);
      });
    }
  }

  getScrollback(agentId: AgentId): string {
    const instance = this.instances.get(agentId);
    return instance ? instance.dataHandler.scrollback.join('\n') : '';
  }

  isRunning(agentId: AgentId): boolean {
    return this.instances.has(agentId);
  }

  killAll(): void {
    for (const [agentId] of this.instances) {
      this.kill(agentId);
    }
  }
}
