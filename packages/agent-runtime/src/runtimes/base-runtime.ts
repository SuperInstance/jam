/**
 * @fileoverview BaseAgentRuntime - Abstract base class for agent runtime implementations.
 *
 * This module provides the Template Method pattern implementation for agent runtimes.
 * The base class owns the shared execute() lifecycle (spawn, stdio, abort, error handling),
 * while subclasses override hooks to customize behavior for specific AI tools.
 *
 * Design Patterns:
 * - Template Method: execute() is the final algorithm; subclasses override hooks
 * - Strategy Pattern: OutputStrategy for pluggable stdout processing
 * - Dependency Inversion: Depends on IAgentRuntime interface from @jam/core
 *
 * @module agent-runtime/runtimes/base-runtime
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { homedir } from 'node:os';
import type {
  IAgentRuntime,
  SpawnConfig,
  AgentOutput,
  InputContext,
  AgentProfile,
  ExecutionResult,
  ExecutionOptions,
  RuntimeMetadata,
} from '@jam/core';
import { createLogger } from '@jam/core';
import treeKill from 'tree-kill';
import { buildCleanEnv } from '../utils.js';
import type { OutputStrategy } from './output-strategy.js';

const log = createLogger('BaseAgentRuntime');

/**
 * Abstract base class for agent runtimes using the Template Method pattern.
 *
 * The BaseAgentRuntime owns the shared execute() lifecycle including:
 * - Process spawning with proper environment and working directory
 * - Stdout/stderr capture and processing
 * - Abort signal support for task cancellation
 * - Output capping (50MB limit) to prevent memory exhaustion
 * - Error handling and result parsing
 *
 * Subclasses override template method hooks to customize:
 * - CLI command to execute
 * - Command-line arguments
 * - Environment variables
 * - Output strategy (JSONL vs raw streaming)
 * - Input method (stdin vs CLI args)
 * - Result parsing
 *
 * @abstract
 * @class
 * @implements {IAgentRuntime}
 *
 * @example
 * ```typescript
 * class MyRuntime extends BaseAgentRuntime {
 *   readonly runtimeId = 'my-runtime';
 *   readonly metadata = { name: 'My Runtime', description: '...' };
 *
 *   protected getCommand() { return 'my-cli'; }
 *   protected buildExecuteArgs(profile, options) { return ['run']; }
 *   protected buildExecuteEnv(profile, options) { return { MY_VAR: 'value' }; }
 *   protected createOutputStrategy() { return new ThrottledOutputStrategy(...); }
 *   protected parseExecutionOutput(stdout, stderr, code) { return { success: true, text: stdout }; }
 * }
 * ```
 */
export abstract class BaseAgentRuntime implements IAgentRuntime {
  /** Unique identifier for this runtime (e.g., 'claude-code', 'cursor') */
  abstract readonly runtimeId: string;

  /** Metadata describing this runtime (name, description, etc.) */
  abstract readonly metadata: RuntimeMetadata;

  // --- IAgentRuntime interface (subclasses implement) ---

  /**
   * Builds the spawn configuration for an agent profile.
   *
   * This is called by the AgentManager to determine how to spawn the agent.
   *
   * @abstract
   * @param profile - The agent profile to build config for
   * @returns The spawn configuration
   */
  abstract buildSpawnConfig(profile: AgentProfile): SpawnConfig;

  /**
   * Parses raw agent output into structured AgentOutput.
   *
   * @abstract
   * @param raw - The raw stdout from the agent process
   * @returns Parsed agent output with structured data
   */
  abstract parseOutput(raw: string): AgentOutput;

  /**
   * Formats input text with optional shared context.
   *
   * The default implementation prepends shared context if provided.
   * Subclasses can override for runtime-specific formatting (e.g., XML tags, JSON wrapping).
   *
   * @virtual
   * @param text - The primary input text
   * @param context - Optional context from other agents
   * @returns Formatted input string
   */
  formatInput(text: string, context?: InputContext): string {
    let input = text;
    if (context?.sharedContext) {
      input = `[Context from other agents: ${context.sharedContext}]\n\n${input}`;
    }
    return input;
  }

  // --- Template method hooks ---

  /**
   * Returns the CLI command to execute (e.g., 'claude', 'opencode').
   *
   * @abstract
   * @returns The command name
   */
  protected abstract getCommand(): string;

  /**
   * Builds CLI arguments for one-shot execution.
   *
   * The `text` parameter is provided for runtimes that pass input as a CLI argument
   * (e.g., Codex CLI). For stdin-based runtimes, this parameter can be ignored.
   *
   * @abstract
   * @param profile - The agent profile
   * @param options - Execution options (cwd, env, signal, etc.)
   * @param text - Optional input text for CLI-arg runtimes
   * @returns Array of CLI arguments
   */
  protected abstract buildExecuteArgs(profile: AgentProfile, options?: ExecutionOptions, text?: string): string[];

  /**
   * Builds runtime-specific environment variables.
   *
   * These are merged with a clean process.env (PATH and core system vars only).
   *
   * @abstract
   * @param profile - The agent profile
   * @param options - Execution options
   * @returns Environment variables to set
   */
  protected abstract buildExecuteEnv(profile: AgentProfile, options?: ExecutionOptions): Record<string, string>;

  /**
   * Creates the output strategy for stdout processing.
   *
   * Two strategies are available:
   * - JsonlOutputStrategy: Line-buffered JSON parsing for structured runtimes
   * - ThrottledOutputStrategy: Raw streaming with progress throttling
   *
   * @abstract
   * @returns The output strategy instance
   */
  protected abstract createOutputStrategy(): OutputStrategy;

  /**
   * Parses final stdout and stderr into an ExecutionResult.
   *
   * This is called after the process exits. JSONL runtimes should override to
   * parse structured output from the stdout.
   *
   * @abstract
   * @param stdout - The accumulated stdout
   * @param stderr - The accumulated stderr
   * @param code - The process exit code (0 for success, non-zero for failure)
   * @returns The parsed execution result
   */
  protected abstract parseExecutionOutput(stdout: string, stderr: string, code: number): ExecutionResult;

  /**
   * Writes input to the child process.
   *
   * The default implementation writes to stdin and closes the stream.
   * CLI-arg runtimes (e.g., Codex) should override to handle input differently.
   *
   * @virtual
   * @param child - The child process
   * @param _profile - The agent profile (unused in default impl)
   * @param text - The input text to write
   */
  protected writeInput(child: ChildProcess, _profile: AgentProfile, text: string): void {
    if (!child.stdin) {
      log.warn('stdin not available, skipping input write');
      return;
    }
    child.stdin.write(text);
    child.stdin.end();
  }

  /**
   * Spawns a child process.
   *
   * This is extracted as a hook so sandboxed runtimes can override to route
   * through `docker exec` instead of native process spawning.
   *
   * @virtual
   * @param command - The command to execute
   * @param args - Command arguments
   * @param options - Spawn options (cwd, env)
   * @returns The spawned child process
   */
  protected spawnProcess(
    command: string,
    args: string[],
    options: { cwd: string; env: Record<string, string> },
  ): ChildProcess {
    return spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  /**
   * Executes a command using the runtime.
   *
   * This is the concrete Template Method implementation that defines the
   * shared execution lifecycle:
   *
   * 1. Build command, args, and env from hooks
   * 2. Spawn the child process
   * 3. Write input to the process
   * 4. Set up abort signal handler
   * 5. Capture stdout/stderr with output capping (50MB)
   * 6. Process output through the output strategy
   * 7. Parse final result and return
   *
   * The method handles all error cases and ensures proper cleanup.
   *
   * @async
   * @param profile - The agent profile defining runtime configuration
   * @param text - The input text to send to the agent
   * @param options - Optional execution parameters
   * @returns Promise resolving to the execution result
   *
   * @example
   * ```typescript
   * const result = await runtime.execute(
   *   { id: 'agent-1', name: 'John', runtime: 'claude-code', model: 'claude-3-5-sonnet', ... },
   *   "Write a hello world function",
   *   { cwd: '/path/to/workspace' }
   * );
   * console.log(result.text);
   * ```
   */
  async execute(profile: AgentProfile, text: string, options?: ExecutionOptions): Promise<ExecutionResult> {
    const command = this.getCommand();
    const args = this.buildExecuteArgs(profile, options, text);
    const env = buildCleanEnv({ ...this.buildExecuteEnv(profile, options), ...options?.env });
    const cwd = options?.cwd ?? profile.cwd ?? homedir();

    log.info(`Executing: ${command} ${args.join(' ').slice(0, 80)}`, undefined, profile.id);

    return new Promise((resolve) => {
      const child = this.spawnProcess(command, args, { cwd, env });

      // Write input via hook (stdin by default, CLI arg for Codex)
      this.writeInput(child, profile, text);

      // Abort signal support — kill entire process tree on abort
      const abortHandler = options?.signal ? () => {
        if (child.pid) treeKill(child.pid, 'SIGTERM');
      } : undefined;
      if (options?.signal && abortHandler) {
        options.signal.addEventListener('abort', abortHandler, { once: true });
      }

      const MAX_OUTPUT = 50 * 1024 * 1024; // 50 MB cap
      let stdout = '';
      let stderr = '';
      let stdoutCapped = false;
      const strategy = this.createOutputStrategy();
      const callbacks = {
        onProgress: options?.onProgress,
        onOutput: options?.onOutput,
      };

      child.stdout!.on('data', (chunk: Buffer) => {
        const chunkStr = chunk.toString();
        if (!stdoutCapped) {
          if (stdout.length + chunkStr.length > MAX_OUTPUT) {
            stdout += chunkStr.slice(0, MAX_OUTPUT - stdout.length);
            stdoutCapped = true;
          } else {
            stdout += chunkStr;
          }
        }
        strategy.processChunk(chunkStr, callbacks);
      });

      child.stderr!.on('data', (chunk: Buffer) => {
        if (stderr.length < MAX_OUTPUT) {
          stderr += chunk.toString();
        }
      });

      const cleanup = () => {
        if (options?.signal && abortHandler) {
          options.signal.removeEventListener('abort', abortHandler);
        }
      };

      child.on('close', (code) => {
        cleanup();
        strategy.flush(callbacks);

        if (code !== 0) {
          const result = this.parseExecutionOutput(stdout, stderr, code ?? 1);
          if (!result.success) {
            log.error(`Execute failed (exit ${code}): ${result.error}`, undefined, profile.id);
          }
          resolve(result);
          return;
        }

        const result = this.parseExecutionOutput(stdout, stderr, 0);
        log.info(`Execute complete: ${result.text.length} chars`, undefined, profile.id);
        resolve(result);
      });

      child.on('error', (err) => {
        cleanup();
        log.error(`Spawn error: ${String(err)}`, undefined, profile.id);
        resolve({ success: false, text: '', error: String(err) });
      });
    });
  }
}
