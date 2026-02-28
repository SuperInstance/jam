/**
 * @fileoverview TeamExecutor - Serialized queue for team AI operations.
 *
 * The TeamExecutor provides serialized execution of team operations through a
 * dedicated runtime, preventing overwhelming the system with concurrent LLM calls.
 *
 * Design Patterns:
 * - Queue Pattern: Operations are executed one at a time in FIFO order
 * - Dependency Inversion: Depends on ITeamExecutor interface, delegates to injected runtime function
 *
 * Use Cases:
 * - Agent self-reflection (periodic, every few hours per agent)
 * - Task assignment decisions
 * - Communication analysis
 * - Code improvement suggestions
 *
 * @module team/team-executor
 */

import type { IModelResolver, TeamOperation, IEventBus } from '@jam/core';
import { createLogger } from '@jam/core';

const log = createLogger('TeamExecutor');

/**
 * Interface for team executor implementations.
 *
 * @interface
 */
export interface ITeamExecutor {
  /**
   * Executes a team operation with the given prompt.
   *
   * @param operation - The type of team operation to execute
   * @param prompt - The prompt to send to the LLM
   * @param cwd - Optional working directory
   * @returns Promise resolving to the LLM response text
   */
  execute(operation: TeamOperation, prompt: string, cwd?: string): Promise<string>;
}

/**
 * Queue item for pending team operations.
 *
 * @interface
 * @private
 */
interface QueueItem {
  /** The type of operation to execute */
  operation: TeamOperation;

  /** The prompt to send to the LLM */
  prompt: string;

  /** Optional working directory */
  cwd?: string;

  /** Resolve callback for the promise */
  resolve: (value: string) => void;

  /** Reject callback for the promise */
  reject: (error: Error) => void;
}

/**
 * Serialized queue that executes team AI operations via the dedicated team runtime.
 *
 * Sequential execution prevents overwhelming a single runtime — 10 agents' periodic
 * operations (reflection every few hours) are easily handled one at a time.
 *
 * This class delegates actual LLM invocation to the injected `executeOnRuntime`
 * function, keeping it decoupled from the Electron layer (Dependency Inversion).
 *
 * @class
 * @implements {ITeamExecutor}
 *
 * @example
 * ```typescript
 * const executor = new TeamExecutor(
 *   modelResolver,
 *   async (runtimeId, model, prompt, cwd) => {
 *     // Delegate to a runtime implementation
 *     return await someRuntime.execute(profile, prompt, { cwd });
 *   },
 *   eventBus
 * );
 *
 * const result = await executor.execute('self:reflect', 'Reflect on your work');
 * ```
 */
export class TeamExecutor implements ITeamExecutor {
  /** Queue of pending operations */
  private readonly queue: QueueItem[] = [];

  /** Whether the queue is currently being processed */
  private processing = false;

  /**
   * Creates a new TeamExecutor instance.
   *
   * @param modelResolver - Resolves models for different operation types
   * @param executeOnRuntime - Function to invoke LLM on a runtime (injected dependency)
   * @param _eventBus - Optional event bus for logging
   */
  constructor(
    private readonly modelResolver: IModelResolver,
    private readonly executeOnRuntime: (
      runtimeId: string,
      model: string,
      prompt: string,
      cwd?: string,
    ) => Promise<string>,
    private readonly _eventBus?: IEventBus,
  ) {}

  /**
   * Executes a team operation.
   *
   * The operation is added to a queue and executed serially. Multiple calls
   * to this method will complete in FIFO order.
   *
   * @param operation - The type of team operation to execute
   * @param prompt - The prompt to send to the LLM
   * @param cwd - Optional working directory
   * @returns Promise resolving to the LLM response text
   */
  async execute(operation: TeamOperation, prompt: string, cwd?: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.queue.push({ operation, prompt, cwd, resolve, reject });
      this.processQueue();
    });
  }

  /**
   * Processes the queue, executing operations one at a time.
   *
   * This method:
   * 1. Checks if already processing (guards against re-entry)
   * 2. Takes the next item from the queue
   * 3. Resolves the runtime and model for the operation
   * 4. Executes the operation via the injected runtime function
   * 5. Resolves or rejects the item's promise
   * 6. Continues to the next item
   *
   * @private
   */
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      const { runtime, model } = this.modelResolver.resolve(item.operation);

      try {
        log.info(`Executing ${item.operation} with ${runtime}/${model}`);
        const result = await this.executeOnRuntime(runtime, model, item.prompt, item.cwd);
        item.resolve(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`${item.operation} failed: ${message}`);
        item.reject(error instanceof Error ? error : new Error(message));
      }
    }

    this.processing = false;
  }

  /**
   * Gets the number of operations currently in the queue.
   *
   * @returns The pending queue count
   */
  get pendingCount(): number {
    return this.queue.length;
  }
}
