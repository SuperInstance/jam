import type { AgentId, IContainerManager, IDockerClient } from '@jam/core';
import { createLogger } from '@jam/core';
import type {
  IPtyManager,
  PtySpawnOptions,
  PtySpawnResult,
  PtyOutputHandler,
  PtyExitHandler,
} from '@jam/agent-runtime';
import { shellEscape, buildCleanEnv } from '@jam/agent-runtime';
import { PtyDataHandler } from '@jam/agent-runtime';

const log = createLogger('SandboxedPtyManager');

interface SandboxedPtyInstance {
  agentId: AgentId;
  process: { write: (data: string) => void; resize: (cols: number, rows: number) => void; pid: number };
  dataHandler: PtyDataHandler;
}

/**
 * PTY manager that runs agent commands inside Docker containers via `docker exec -it`.
 *
 * Implements the same IPtyManager interface as the native PtyManager.
 * `node-pty` spawns `docker exec -it {containerId} bash -c "claude ..."` instead of
 * spawning the agent CLI directly. All PTY data flow (output batching, DSR interception,
 * scrollback, resize) works identically because Docker transparently bridges the TTY.
 */
export class SandboxedPtyManager implements IPtyManager {
  private instances = new Map<string, SandboxedPtyInstance>();
  private outputHandler: PtyOutputHandler | null = null;
  private exitHandler: PtyExitHandler | null = null;

  constructor(
    private readonly containerManager: IContainerManager,
    private readonly dockerClient: IDockerClient,
  ) {}

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

    const containerId = this.containerManager.getContainerId(agentId);
    if (!containerId) {
      return { success: false, error: 'No running container for this agent' };
    }

    try {
      const nodePty = await import('node-pty');

      // Build the command to run inside the container
      const agentCmd = [command, ...args].map(shellEscape).join(' ');

      // Build docker exec args: docker exec -it -w /workspace -e KEY=VAL ... {cid} bash -c "cmd"
      const execArgs = this.dockerClient.execInteractiveArgs(
        containerId,
        ['/bin/bash', '-c', agentCmd],
        options.env ?? {},
      );

      log.info(`Spawning in container: docker exec ${execArgs.join(' ')}`, undefined, agentId);

      // node-pty spawns "docker" — the PTY is bridged through Docker transparently
      const ptyProcess = nodePty.spawn('docker', execArgs, {
        name: 'xterm-256color',
        cols: options.cols ?? 120,
        rows: options.rows ?? 30,
        // cwd is irrelevant on host — -w flag sets it inside container
        env: buildCleanEnv({ TERM: 'xterm-256color' }),
      });

      // Shared data handler: DSR interception, scrollback, output batching
      const dataHandler = new PtyDataHandler(agentId, ptyProcess, () => this.outputHandler);

      const instance: SandboxedPtyInstance = {
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
      log.info(`Spawned sandboxed PTY (PID: ${ptyProcess.pid}, container: ${containerId.slice(0, 12)})`, undefined, agentId);
      return { success: true, pid: ptyProcess.pid };
    } catch (error) {
      log.error(`Failed to spawn sandboxed PTY: ${String(error)}`, { command, args }, agentId);
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
      this.instances.delete(agentId);
      // In Docker mode, stopping the container kills everything — no tree-kill needed.
      // The container manager handles the stop.
      this.containerManager.stop(agentId);
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
