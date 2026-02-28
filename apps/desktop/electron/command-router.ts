/**
 * @fileoverview CommandRouter - Unified command routing for voice and text input.
 *
 * The CommandRouter eliminates duplication between voice and text IPC handlers by
 * providing a single source of truth for:
 * - Agent resolution (finding which agent should handle a command)
 * - Command classification (task, status-query, interrupt)
 * - Command dispatch (routing to appropriate handlers)
 *
 * Design Patterns:
 * - Handler Registry (OCP): New command types are registered via registerCommand()
 * - Fallback Chain: Tries explicit agent → last target → only running agent
 * - Intent-Based Routing: Classifies command intent for smart agent selection
 *
 * @module desktop/electron/command-router
 */

import type { AgentManager } from '@jam/agent-runtime';
import type { CommandParser, ParsedCommand } from '@jam/voice';
import type { VoiceService } from '@jam/voice';
import { createLogger } from '@jam/core';
import { buildAgentPayload, type AgentInfoPayload } from './utils/payload-builder.js';
import { IntentClassifier, type IntentClassification } from './intent-classifier.js';

const log = createLogger('CommandRouter');

/**
 * Result of executing a command against an agent.
 *
 * @interface
 */
export interface CommandResult {
  /** Whether the command was executed successfully */
  success: boolean;
  /** Response text to show in the chat UI */
  text?: string;
  /** Error message if execution failed */
  error?: string;
  /** ID of the agent that handled the command */
  agentId?: string;
  /** Display name of the agent */
  agentName?: string;
  /** Runtime type (e.g., 'claude-code', 'cursor') */
  agentRuntime?: string;
  /** Accent color for UI display */
  agentColor?: string;
}

// Re-export AgentInfoPayload as AgentInfo for backwards compatibility
export type AgentInfo = AgentInfoPayload;

/**
 * Handler function for a specific command type.
 *
 * @typedef {Function} CommandHandler
 * @param {string} agentId - The agent ID to execute the command on
 * @param {ParsedCommand} parsed - The parsed command object
 * @returns {CommandResult|Promise<CommandResult>} The command execution result
 */
type CommandHandler = (agentId: string, parsed: ParsedCommand) => CommandResult | Promise<CommandResult>;

/**
 * Unified command routing logic shared between voice and text IPC handlers.
 *
 * This class eliminates duplication of agent resolution, command classification,
 * and dispatch logic. It uses a handler registry following the Open/Closed Principle -
 * new command types are added via registerCommand() without modifying this class.
 *
 * Agent Resolution Strategy:
 * 1. Explicit agent name in the command (e.g., "Tell john to...")
 * 2. Last target for this input source (voice or text)
 * 3. Last target for the other input source
 * 4. Only running agent (if exactly one is running)
 *
 * @class
 *
 * @example
 * ```typescript
 * const router = new CommandRouter(agentManager, commandParser, voiceService);
 *
 * // Register a custom command type
 * router.registerCommand('custom', (agentId, parsed) => {
 *   return { success: true, text: 'Custom command executed', agentId };
 * });
 *
 * // Route a command
 * const parsed = commandParser.parse("Tell john to status");
 * const agentId = router.resolveTarget(parsed, 'voice');
 * const result = await router.dispatch(agentId!, parsed);
 * ```
 */
export class CommandRouter {
  /** Maps input sources to their last target agent IDs */
  private lastTargetIds = new Map<'voice' | 'text', string | null>();

  /** Registry of command type handlers */
  private commandHandlers = new Map<string, CommandHandler>();

  /**
   * Per-agent guard preventing duplicate in-flight voice commands.
   * This is used by voice handlers to debounce rapid voice commands.
   */
  readonly commandsInFlight = new Set<string>();

  /** Intent classifier for smart agent routing based on command content */
  readonly intentClassifier: IntentClassifier;

  /**
   * Creates a new CommandRouter instance.
   *
   * @param agentManager - The agent manager for agent lookups
   * @param commandParser - The command parser for text-based commands
   * @param voiceService - Optional voice service for voice-based command parsing
   */
  constructor(
    private agentManager: AgentManager,
    private commandParser: CommandParser,
    private voiceService: VoiceService | null,
  ) {
    // Initialize intent classifier
    this.intentClassifier = new IntentClassifier();

    // Register built-in command handlers
    this.registerCommand('status-query', (agentId) => this.handleStatusQuery(agentId));
    this.registerCommand('interrupt', (agentId) => this.handleInterrupt(agentId));
  }

  /**
   * Registers a handler for a command type.
   *
   * This follows the Open/Closed Principle - new command types can be added
   * without modifying this class.
   *
   * @param type - The command type identifier (e.g., 'status-query', 'interrupt')
   * @param handler - The handler function to execute for this command type
   *
   * @example
   * ```typescript
   * router.registerCommand('restart', async (agentId) => {
   *   await agentManager.stop(agentId);
   *   await agentManager.start(agentId);
   *   return { success: true, text: 'Agent restarted', agentId };
   * });
   * ```
   */
  registerCommand(type: string, handler: CommandHandler): void {
    this.commandHandlers.set(type, handler);
  }

  /**
   * Dispatches a parsed command by type.
   *
   * If a handler is registered for the command type, it will be executed.
   * Otherwise, returns null (indicating a standard task command should be executed).
   *
   * @param agentId - The agent ID to execute the command on
   * @param parsed - The parsed command object
   * @returns The command result, or null for standard task commands
   */
  dispatch(agentId: string, parsed: ParsedCommand): CommandResult | Promise<CommandResult> | null {
    const handler = this.commandHandlers.get(parsed.commandType);
    return handler ? handler(agentId, parsed) : null;
  }

  /**
   * Classifies the intent of a command string.
   *
   * Uses the intent classifier to determine what type of operation the user
   * is requesting (e.g., code-edit, file-read, analysis, etc.).
   *
   * @param command - The raw command text to classify
   * @returns The intent classification with confidence score and patterns
   */
  classifyIntent(command: string): IntentClassification {
    return this.intentClassifier.classify(command);
  }

  /**
   * Updates the voice service reference.
   *
   * This is called when the voice service is initialized after construction.
   *
   * @param service - The voice service instance, or null to disable voice
   */
  updateVoiceService(service: VoiceService | null): void {
    this.voiceService = service;
  }

  /**
   * Resolves the target agent for a parsed command.
   *
   * Uses a fallback chain:
   * 1. Explicit agent name from the command
   * 2. Last target for this input source (voice/text)
   * 3. Last target for the other input source
   * 4. Only running agent (if exactly one is running)
   *
   * For text commands, only running agents are considered. For voice commands,
   * any running agent (including the system agent) can be targeted.
   *
   * @param parsed - The parsed command object
   * @param source - The input source ('voice' or 'text')
   * @returns The target agent ID, or undefined if no agent could be resolved
   */
  resolveTarget(parsed: ParsedCommand, source: 'voice' | 'text'): string | undefined {
    let targetId: string | undefined;

    // 1. Explicit agent name from command
    if (parsed.targetAgentName) {
      const resolver = source === 'voice' && this.voiceService
        ? this.voiceService
        : this.commandParser;
      targetId = resolver.resolveAgentId(parsed.targetAgentName);
      if (!targetId) {
        log.warn(`Agent name "${parsed.targetAgentName}" not found`);
      }
    }

    // 2. Fallback: last target for this source, then the other source
    if (!targetId) {
      const lastSame = this.lastTargetIds.get(source);
      const lastOther = this.lastTargetIds.get(source === 'voice' ? 'text' : 'voice');

      if (lastSame) {
        const agent = this.agentManager.get(lastSame);
        if (source === 'voice' || (agent && agent.status === 'running')) {
          targetId = lastSame;
          log.debug(`Routing to last ${source} target: ${targetId}`);
        }
      }
      if (!targetId && lastOther) {
        const agent = this.agentManager.get(lastOther);
        if (source === 'voice' || (agent && agent.status === 'running')) {
          targetId = lastOther;
          log.debug(`Routing to last ${source === 'voice' ? 'text' : 'voice'} target: ${targetId}`);
        }
      }
    }

    // 3. Fallback: only running agent (including system agent)
    if (!targetId) {
      const running = this.agentManager.list()
        .filter((a) => a.status === 'running');
      if (running.length === 1) {
        targetId = running[0].profile.id;
        log.debug(`Routing to only running agent: ${targetId}`);
      }
    }

    return targetId;
  }

  /**
   * Resolves the target agent using intent-based routing.
   *
   * This method uses the intent classifier to select the best agent based on command type.
   *
   * Note: For true intent-based routing, agents would need a 'capabilities' or 'tags' field
   * in their profile. For now, this provides the classification that can be used by the
   * caller to make routing decisions.
   *
   * @param commandText - The raw command text to classify
   * @param source - Whether this is from 'voice' or 'text'
   * @returns Object with target agent ID (if found) and intent classification
   */
  resolveTargetByIntent(
    commandText: string,
    source: 'voice' | 'text'
  ): { targetId?: string; intent: IntentClassification } {
    // Classify the intent
    const intent = this.classifyIntent(commandText);

    // Get all running non-system agents
    const runningAgents = this.agentManager.list()
      .filter((a) => a.status === 'running' && !a.profile.isSystem);

    // TODO: When agents have capabilities/tags, we can match intent to agent capabilities
    // For now, we'll return the intent classification for the caller to use
    //
    // Future implementation:
    // const matchedAgent = runningAgents.find(agent =>
    //   agent.profile.capabilities?.includes(intent.type)
    // );

    // Fall back to existing resolveTarget logic
    const targetId = this.resolveTarget(
      { commandType: 'task', text: commandText },
      source
    );

    log.debug(
      `Intent-based routing: intent=${intent.type} confidence=${intent.confidence.toFixed(2)} ` +
      `target=${targetId || 'none'}`
    );

    return { targetId, intent };
  }

  /**
   * Gets the names of all currently running agents.
   *
   * This is used for error messages when no agent can be resolved.
   *
   * @returns Array of running agent names
   */
  getRunningAgentNames(): string[] {
    return this.agentManager.list()
      .filter((a) => a.status === 'running')
      .map((a) => a.profile.name);
  }

  /**
   * Records that a command was routed to a specific agent.
   *
   * This is used for the fallback chain - the next command from the same
   * source will target this agent if no explicit agent is specified.
   *
   * @param agentId - The agent ID that handled the command
   * @param source - The input source ('voice' or 'text')
   */
  recordTarget(agentId: string, source: 'voice' | 'text'): void {
    this.lastTargetIds.set(source, agentId);
  }

  /**
   * Gets agent metadata for chat responses.
   *
   * @param agentId - The agent ID to look up
   * @returns Agent info payload, or null if agent not found
   */
  getAgentInfo(agentId: string): AgentInfo | null {
    const agent = this.agentManager.get(agentId);
    if (!agent) return null;
    return buildAgentPayload(agent);
  }

  /**
   * Handles a status query command.
   *
   * This reads the agent's current status from the task tracker without
   * disturbing the agent's work. Returns a summary of what the agent
   * is currently working on.
   *
   * @param agentId - The agent ID to query
   * @returns Command result with status text and agent metadata
   * @private
   */
  handleStatusQuery(agentId: string): CommandResult {
    const info = this.getAgentInfo(agentId);
    const summary = this.agentManager.getTaskStatusSummary(agentId);
    return {
      success: true,
      text: summary,
      agentId,
      agentName: info?.agentName ?? 'Agent',
      agentRuntime: info?.agentRuntime ?? '',
      agentColor: info?.agentColor ?? '#6b7280',
    };
  }

  /**
   * Handles an interrupt command.
   *
   * This aborts the agent's current task. If the agent is not working on
   * anything, a friendly message is returned.
   *
   * @param agentId - The agent ID to interrupt
   * @returns Command result indicating whether the task was aborted
   * @private
   */
  handleInterrupt(agentId: string): CommandResult {
    const aborted = this.agentManager.abortTask(agentId);
    this.commandsInFlight.delete(agentId);
    const info = this.getAgentInfo(agentId);
    const name = info?.agentName ?? 'Agent';
    return {
      success: true,
      text: aborted
        ? `Stopped ${name}'s current task.`
        : `${name} isn't working on anything right now.`,
      agentId,
      agentName: name,
      agentRuntime: info?.agentRuntime ?? '',
      agentColor: info?.agentColor ?? '#6b7280',
    };
  }
}
