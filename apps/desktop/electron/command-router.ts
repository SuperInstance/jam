import type { AgentManager } from '@jam/agent-runtime';
import type { CommandParser, ParsedCommand } from '@jam/voice';
import type { VoiceService } from '@jam/voice';
import { createLogger } from '@jam/core';
import { buildAgentPayload, type AgentInfoPayload } from './utils/payload-builder.js';
import { IntentClassifier, type IntentClassification } from './intent-classifier.js';

const log = createLogger('CommandRouter');

export interface CommandResult {
  success: boolean;
  text?: string;
  error?: string;
  agentId?: string;
  agentName?: string;
  agentRuntime?: string;
  agentColor?: string;
}

// Re-export AgentInfoPayload as AgentInfo for backwards compatibility
export type AgentInfo = AgentInfoPayload;

type CommandHandler = (agentId: string, parsed: ParsedCommand) => CommandResult | Promise<CommandResult>;

/**
 * Unified command routing logic shared between voice and text IPC handlers.
 * Eliminates duplication of agent resolution, command classification, and dispatch.
 * Uses a handler registry (OCP) — new command types are added via registerCommand().
 */
export class CommandRouter {
  private lastTargetIds = new Map<'voice' | 'text', string | null>();
  private commandHandlers = new Map<string, CommandHandler>();
  /** Per-agent guard preventing duplicate in-flight voice commands */
  readonly commandsInFlight = new Set<string>();
  /** Intent classifier for smart agent routing */
  readonly intentClassifier: IntentClassifier;

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

  /** Register a handler for a command type. New types are added here (OCP). */
  registerCommand(type: string, handler: CommandHandler): void {
    this.commandHandlers.set(type, handler);
  }

  /** Dispatch a parsed command by type. Returns null for standard task commands. */
  dispatch(agentId: string, parsed: ParsedCommand): CommandResult | Promise<CommandResult> | null {
    const handler = this.commandHandlers.get(parsed.commandType);
    return handler ? handler(agentId, parsed) : null;
  }

  /**
   * Classify the intent of a command string.
   * Returns the intent type with confidence score and matched patterns.
   */
  classifyIntent(command: string): IntentClassification {
    return this.intentClassifier.classify(command);
  }

  updateVoiceService(service: VoiceService | null): void {
    this.voiceService = service;
  }

  /** Resolve the target agent for a parsed command, using source-specific fallback chain */
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
   * Resolve the target agent using intent-based routing.
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

  /** Get metadata about the running agents (for error messages) */
  getRunningAgentNames(): string[] {
    return this.agentManager.list()
      .filter((a) => a.status === 'running')
      .map((a) => a.profile.name);
  }

  /** Record that a command was routed to this agent */
  recordTarget(agentId: string, source: 'voice' | 'text'): void {
    this.lastTargetIds.set(source, agentId);
  }

  /** Get agent metadata for chat responses */
  getAgentInfo(agentId: string): AgentInfo | null {
    const agent = this.agentManager.get(agentId);
    if (!agent) return null;
    return buildAgentPayload(agent);
  }

  /** Handle status query — read from task tracker, never disturb the agent */
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

  /** Handle interrupt — abort current task */
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
