import { v4 as uuid } from 'uuid';
import type {
  AgentId,
  AgentProfile,
  AgentState,
  AgentStatus,
  IEventBus,
  Events,
} from '@jam/core';
import { createLogger } from '@jam/core';
import { PtyManager } from './pty-manager.js';
import { RuntimeRegistry } from './runtime-registry.js';

const log = createLogger('AgentManager');

/** Max time to wait for a response before giving up on tracking */
const RESPONSE_TIMEOUT_MS = 60_000;
/** Max buffer size to prevent memory issues */
const RESPONSE_MAX_BUFFER = 50_000;

interface ResponseTracking {
  buffer: string;
  inputText: string;
  timeoutTimer: ReturnType<typeof setTimeout>;
}

export interface AgentStore {
  getProfiles(): AgentProfile[];
  saveProfile(profile: AgentProfile): void;
  deleteProfile(agentId: AgentId): void;
}

export class AgentManager {
  private agents = new Map<AgentId, AgentState>();
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  /** Tracks in-flight responses for agents that need TTS read-back */
  private responseTracking = new Map<AgentId, ResponseTracking>();

  constructor(
    private ptyManager: PtyManager,
    private runtimeRegistry: RuntimeRegistry,
    private eventBus: IEventBus,
    private store: AgentStore,
  ) {
    // Restore saved profiles
    for (const profile of this.store.getProfiles()) {
      this.agents.set(profile.id, {
        profile,
        status: 'stopped',
        visualState: 'offline',
      });
    }

    log.info(`Restored ${this.store.getProfiles().length} agent profiles`);

    // Wire PTY events
    this.ptyManager.onOutput((agentId, data) => {
      this.updateLastActivity(agentId);
      this.eventBus.emit('agent:output', { agentId, data });
      // Feed into response tracking if active for this agent
      this.handleResponseOutput(agentId, data);
    });

    this.ptyManager.onExit((agentId, exitCode) => {
      const state = this.agents.get(agentId);
      const name = state?.profile.name ?? agentId;
      if (exitCode === 0) {
        log.info(`Agent "${name}" exited normally`, undefined, agentId);
      } else {
        log.warn(`Agent "${name}" exited with code ${exitCode}`, undefined, agentId);
      }
      this.updateStatus(agentId, exitCode === 0 ? 'stopped' : 'error');
      this.updateVisualState(agentId, 'offline');
    });
  }

  create(
    input: Omit<AgentProfile, 'id'>,
  ): { success: boolean; agentId?: AgentId; error?: string } {
    const id = uuid();
    const profile: AgentProfile = { ...input, id };

    if (!this.runtimeRegistry.has(profile.runtime)) {
      const error = `Unknown runtime: ${profile.runtime}. Available: ${this.runtimeRegistry.list().map((r) => r.runtimeId).join(', ')}`;
      log.error(`Failed to create agent "${input.name}": ${error}`);
      return { success: false, error };
    }

    const state: AgentState = {
      profile,
      status: 'stopped',
      visualState: 'offline',
    };

    this.agents.set(id, state);
    this.store.saveProfile(profile);
    this.eventBus.emit('agent:created', { agentId: id, profile });
    log.info(`Created agent "${profile.name}" (${profile.runtime})`, undefined, id);

    return { success: true, agentId: id };
  }

  async start(
    agentId: AgentId,
  ): Promise<{ success: boolean; error?: string }> {
    const state = this.agents.get(agentId);
    if (!state) return { success: false, error: 'Agent not found' };
    if (state.status === 'running')
      return { success: false, error: 'Agent already running' };

    const runtime = this.runtimeRegistry.get(state.profile.runtime);
    if (!runtime)
      return { success: false, error: `Runtime not found: ${state.profile.runtime}` };

    this.updateStatus(agentId, 'starting');
    this.updateVisualState(agentId, 'idle');

    const spawnConfig = runtime.buildSpawnConfig(state.profile);
    log.info(
      `Starting agent "${state.profile.name}": ${spawnConfig.command} ${spawnConfig.args.join(' ')}`,
      { cwd: state.profile.cwd },
      agentId,
    );

    const result = await this.ptyManager.spawn(agentId, spawnConfig.command, spawnConfig.args, {
      cwd: state.profile.cwd,
      env: { ...spawnConfig.env, ...state.profile.env },
    });

    if (result.success) {
      state.pid = result.pid;
      state.startedAt = new Date().toISOString();
      this.updateStatus(agentId, 'running');
      log.info(`Agent "${state.profile.name}" started (PID: ${result.pid})`, undefined, agentId);
    } else {
      this.updateStatus(agentId, 'error');
      this.updateVisualState(agentId, 'error');
      log.error(`Failed to start agent "${state.profile.name}": ${result.error}`, undefined, agentId);
    }

    return result;
  }

  stop(agentId: AgentId): { success: boolean; error?: string } {
    const state = this.agents.get(agentId);
    if (!state) return { success: false, error: 'Agent not found' };

    this.ptyManager.kill(agentId);
    state.pid = undefined;
    this.updateStatus(agentId, 'stopped');
    this.updateVisualState(agentId, 'offline');

    return { success: true };
  }

  async restart(
    agentId: AgentId,
  ): Promise<{ success: boolean; error?: string }> {
    this.updateStatus(agentId, 'restarting');
    this.stop(agentId);
    await new Promise((r) => setTimeout(r, 500));
    return this.start(agentId);
  }

  delete(agentId: AgentId): { success: boolean; error?: string } {
    const state = this.agents.get(agentId);
    if (!state) return { success: false, error: 'Agent not found' };

    if (state.status === 'running') {
      this.ptyManager.kill(agentId);
    }

    this.agents.delete(agentId);
    this.store.deleteProfile(agentId);
    this.eventBus.emit('agent:deleted', { agentId });

    return { success: true };
  }

  update(
    agentId: AgentId,
    updates: Partial<Omit<AgentProfile, 'id'>>,
  ): { success: boolean; error?: string } {
    const state = this.agents.get(agentId);
    if (!state) return { success: false, error: 'Agent not found' };

    state.profile = { ...state.profile, ...updates };
    this.store.saveProfile(state.profile);

    return { success: true };
  }

  sendInput(agentId: AgentId, text: string, options?: { trackResponse?: boolean }): void {
    const state = this.agents.get(agentId);
    if (!state || state.status !== 'running') {
      log.warn(`sendInput ignored: agent ${agentId} status=${state?.status ?? 'not found'}`);
      return;
    }

    const runtime = this.runtimeRegistry.get(state.profile.runtime);
    if (!runtime) return;

    const formatted = runtime.formatInput(text);
    log.info(`Sending input to "${state.profile.name}": "${formatted.slice(0, 100)}${formatted.length > 100 ? '...' : ''}"`, undefined, agentId);

    // Start response tracking before writing (so we don't miss early output)
    if (options?.trackResponse) {
      this.startResponseTracking(agentId, formatted);
    }

    this.ptyManager.write(agentId, formatted + '\n');
    this.updateVisualState(agentId, 'listening');
    this.updateLastActivity(agentId);
  }

  get(agentId: AgentId): AgentState | undefined {
    return this.agents.get(agentId);
  }

  list(): AgentState[] {
    return Array.from(this.agents.values());
  }

  stopAll(): void {
    for (const [agentId, state] of this.agents) {
      if (state.status === 'running') {
        this.stop(agentId);
      }
    }
  }

  startHealthCheck(intervalMs = 10_000): void {
    this.healthCheckInterval = setInterval(() => {
      for (const [agentId, state] of this.agents) {
        if (state.status === 'running' && !this.ptyManager.isRunning(agentId)) {
          log.error(`Agent "${state.profile.name}" PTY died unexpectedly`, undefined, agentId);
          this.updateStatus(agentId, 'error');
          this.updateVisualState(agentId, 'error');
        }
      }
    }, intervalMs);
  }

  stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  private updateStatus(agentId: AgentId, status: AgentStatus): void {
    const state = this.agents.get(agentId);
    if (!state) return;

    const previousStatus = state.status;
    state.status = status;
    this.eventBus.emit('agent:statusChanged', {
      agentId,
      status,
      previousStatus,
    });
  }

  private updateVisualState(
    agentId: AgentId,
    visualState: AgentState['visualState'],
  ): void {
    const state = this.agents.get(agentId);
    if (!state) return;

    state.visualState = visualState;
    this.eventBus.emit('agent:visualStateChanged', { agentId, visualState });
  }

  // --- Response Tracking ---
  // When a voice command is sent, we track the agent's output until the runtime
  // detects the response is complete (e.g. prompt appears). No timers or debounce —
  // just checking on every PTY output chunk.

  private startResponseTracking(agentId: AgentId, inputText: string): void {
    // Clean up any existing tracking
    this.stopResponseTracking(agentId);

    const timeoutTimer = setTimeout(() => {
      log.warn('Response tracking timed out, emitting what we have', undefined, agentId);
      this.emitResponseComplete(agentId);
    }, RESPONSE_TIMEOUT_MS);

    this.responseTracking.set(agentId, { buffer: '', inputText, timeoutTimer });
    log.debug('Response tracking started', undefined, agentId);
  }

  private stopResponseTracking(agentId: AgentId): void {
    const tracking = this.responseTracking.get(agentId);
    if (tracking) {
      clearTimeout(tracking.timeoutTimer);
      this.responseTracking.delete(agentId);
    }
  }

  private handleResponseOutput(agentId: AgentId, data: string): void {
    const tracking = this.responseTracking.get(agentId);
    if (!tracking) return;

    tracking.buffer += data;

    // Cap buffer to prevent memory issues
    if (tracking.buffer.length > RESPONSE_MAX_BUFFER) {
      tracking.buffer = tracking.buffer.slice(-RESPONSE_MAX_BUFFER);
    }

    // Ask the runtime if the response is complete
    const state = this.agents.get(agentId);
    if (!state) return;

    const runtime = this.runtimeRegistry.get(state.profile.runtime);
    if (!runtime) return;

    // Parse and check: only consider complete if we have meaningful content
    const parsed = runtime.parseOutput(tracking.buffer);
    const cleanText = parsed.content.trim();

    if (cleanText.length > 10 && runtime.detectResponseComplete(tracking.buffer)) {
      log.debug(`Response complete detected (${cleanText.length} chars)`, undefined, agentId);
      this.emitResponseComplete(agentId);
    }
  }

  private emitResponseComplete(agentId: AgentId): void {
    const tracking = this.responseTracking.get(agentId);
    if (!tracking) return;

    const text = this.extractResponseText(tracking);
    this.stopResponseTracking(agentId);

    if (text.length > 0) {
      this.eventBus.emit('agent:responseComplete', { agentId, text });
      log.info(`Response complete: ${text.length} chars`, undefined, agentId);
    } else {
      log.debug('Response tracking ended with no meaningful content', undefined, agentId);
    }
  }

  /** Extract the agent's actual response from the raw terminal buffer.
   *  Strips: ANSI codes, echoed input, status lines (Thinking...), and prompt. */
  private extractResponseText(tracking: ResponseTracking): string {
    // Strip ANSI escape codes
    // eslint-disable-next-line no-control-regex
    const cleaned = tracking.buffer.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

    const lines = cleaned.split('\n').map((l) => l.trimEnd());

    // Filter out noise: echoed input, status indicators, prompt lines, blanks
    const inputLower = tracking.inputText.toLowerCase().trim();
    const filtered = lines.filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      // Remove echoed input (PTY echo)
      if (trimmed.toLowerCase() === inputLower) return false;
      // Remove common status indicators
      if (/^(⏳\s*)?thinking\.{0,3}$/i.test(trimmed)) return false;
      if (/^⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/.test(trimmed)) return false; // spinner chars
      // Remove prompt lines
      if (/^[>❯$%#]\s*$/.test(trimmed)) return false;
      return true;
    });

    return filtered.join('\n').trim();
  }

  private updateLastActivity(agentId: AgentId): void {
    const state = this.agents.get(agentId);
    if (state) {
      state.lastActivity = new Date().toISOString();
    }
  }
}
