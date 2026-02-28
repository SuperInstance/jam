/**
 * @fileoverview CommandParser - Extracts agent names and command types from text.
 *
 * The CommandParser analyzes natural language text to identify:
 * - Target agent name (if specified)
 * - Command type (task, status-query, interrupt, meta)
 * - Cleaned command text without agent prefix
 *
 * Agent Name Extraction Strategies (in order):
 * 1. Greeting prefix: "Hey/hi/ok/yo [,] <name>"
 * 2. First word: "<name>, ..." or "<name> ..."
 * 3. Ask/tell pattern: "Ask/tell <name> ..."
 * 4. Fuzzy scan: Scan entire input for known agent names
 *
 * @module voice/command-parser
 */

import type { AgentId } from '@jam/core';

/**
 * Types of commands that can be parsed.
 *
 * @typedef {'task' | 'status-query' | 'interrupt' | 'meta'} CommandType
 */
export type CommandType = 'task' | 'status-query' | 'interrupt' | 'meta';

/**
 * Result of parsing a command string.
 *
 * @interface
 */
export interface ParsedCommand {
  /**
   * The name of the target agent extracted from the command.
   * Null if no agent was explicitly mentioned.
   */
  targetAgentName: string | null;

  /**
   * The cleaned command text with agent prefix removed.
   */
  command: string;

  /**
   * Whether this is a meta command (create, delete, restart, list, configure).
   */
  isMetaCommand: boolean;

  /**
   * The classified command type.
   */
  commandType: CommandType;
}

/** List of meta command prefixes that manage agents rather than executing tasks */
const META_COMMANDS = [
  'create',
  'delete',
  'restart',
  'list',
  'configure',
];

/** Regular expressions for detecting status query commands */
const STATUS_PATTERNS = [
  /\bstatus\b/i,
  /\bupdate\b/i,
  /\bprogress\b/i,
  /\bwhat are you doing\b/i,
  /\bwhat's happening\b/i,
  /\bwhats happening\b/i,
  /\bwhere are you\b/i,
  /\bhow's it going\b/i,
  /\bhows it going\b/i,
  /\bwhat are you working on\b/i,
  /\bare you done\b/i,
  /\bare you busy\b/i,
  /\bhow far along\b/i,
];

/** Regular expressions for detecting interrupt commands */
const INTERRUPT_PATTERNS = [
  /\bstop\b/i,
  /\bcancel\b/i,
  /\babort\b/i,
  /\bnever\s?mind\b/i,
  /\bquit\b/i,
  /\bforget it\b/i,
];

/**
 * Parses agent names and command types from text input.
 *
 * This class is used by both voice and text input handlers to extract
 * structured command information from natural language.
 *
 * @class
 *
 * @example
 * ```typescript
 * const parser = new CommandParser();
 * parser.updateAgentNames([{ id: 'agent-1', name: 'John' }]);
 *
 * const parsed = parser.parse("Hey John, what's the status?");
 * console.log(parsed);
 * // {
 * //   targetAgentName: 'john',
 * //   command: "what's the status?",
 * //   isMetaCommand: false,
 * //   commandType: 'status-query'
 * // }
 * ```
 */
export class CommandParser {
  /** Maps lowercase agent names to their IDs */
  private agentNames: Map<string, AgentId> = new Map();

  /**
   * Gets all registered agent names.
   *
   * @returns Array of agent names
   */
  getAgentNames(): string[] {
    return Array.from(this.agentNames.keys());
  }

  /**
   * Updates the agent name registry.
   *
   * This is called when agents are created/deleted to keep the
   * parser in sync with the current agent roster.
   *
   * @param agents - Array of agent IDs and names
   */
  updateAgentNames(agents: Array<{ id: AgentId; name: string }>): void {
    this.agentNames.clear();
    for (const agent of agents) {
      this.agentNames.set(agent.name.toLowerCase(), agent.id);
    }
  }

  /**
   * Parses a command string into structured components.
   *
   * This performs the following steps:
   * 1. Check for meta commands (create, delete, etc.)
   * 2. Extract target agent name using multiple strategies
   * 3. Strip the agent prefix from the command
   * 4. Classify the command type
   *
   * @param transcript - The command text to parse
   * @returns The parsed command structure
   */
  parse(transcript: string): ParsedCommand {
    const trimmed = transcript.trim();
    const lower = trimmed.toLowerCase();

    // Check for meta commands first (e.g., "create new agent named Ray")
    for (const meta of META_COMMANDS) {
      if (lower.startsWith(meta)) {
        return {
          targetAgentName: null,
          command: trimmed,
          isMetaCommand: true,
          commandType: 'meta',
        };
      }
    }

    // Extract target agent name first
    const targetAgentName = this.extractAgentName(trimmed, lower);
    const command = targetAgentName
      ? this.stripAgentPrefix(trimmed, targetAgentName)
      : trimmed;

    // Classify the command (after stripping agent name prefix)
    const commandType = this.classifyCommand(command);

    return {
      targetAgentName,
      command,
      isMetaCommand: false,
      commandType,
    };
  }

  /**
   * Resolves an agent name to an agent ID.
   *
   * @param name - The agent name to resolve (case-insensitive)
   * @returns The agent ID, or undefined if not found
   */
  resolveAgentId(name: string): AgentId | undefined {
    return this.agentNames.get(name.toLowerCase());
  }

  /**
   * Classifies a command into its type.
   *
   * Classification rules:
   * - Only short commands (<= 6 words) are classified as status queries
   * - Only short commands (<= 3 words) are classified as interrupts
   * - This prevents "stop the server" from being classified as interrupt
   * - Everything else is a task
   *
   * @param command - The command text (without agent prefix)
   * @returns The command type
   * @private
   */
  private classifyCommand(command: string): CommandType {
    const words = command.trim().split(/\s+/);

    // Only classify short commands as status queries or interrupts.
    // Long sentences (> 6 words) that happen to contain "status" or "update"
    // are clearly task descriptions, not status queries.
    if (words.length <= 6) {
      for (const pattern of STATUS_PATTERNS) {
        if (pattern.test(command)) return 'status-query';
      }
    }

    // Check if it's an interrupt command (short commands only — "stop working" is interrupt, "stop the server" is a task)
    if (words.length <= 3) {
      for (const pattern of INTERRUPT_PATTERNS) {
        if (pattern.test(command)) return 'interrupt';
      }
    }

    return 'task';
  }

  /**
   * Extracts the target agent name from the command text.
   *
   * Tries multiple strategies in order:
   * 1. Greeting prefix: "Hey/hi/ok/yo [,] <name>"
   * 2. First word: "<name>, ..." or "<name> ..."
   * 3. Ask/tell pattern: "Ask/tell <name> ..."
   * 4. Fuzzy scan: Scan entire input for known agent names
   *
   * @param trimmed - The original trimmed command text
   * @param lower - The lowercase version of the command
   * @returns The extracted agent name, or null if not found
   * @private
   */
  private extractAgentName(trimmed: string, lower: string): string | null {
    // Strategy 1: "hey/hi/ok/yo [,] <name>" prefix — with optional comma/punctuation
    const greetingMatch = trimmed.match(
      /^(?:hey|hi|ok|yo|hello)[,.]?\s+(\w+)[,.]?\s*(.*)/i,
    );
    if (greetingMatch) {
      const possibleName = greetingMatch[1].toLowerCase();
      if (this.agentNames.has(possibleName)) return possibleName;
    }

    // Strategy 2: "<name>, ..." or "<name> ..." as the first word
    const firstWordMatch = trimmed.match(/^(\w+)[,.]?\s+(.*)/i);
    if (firstWordMatch) {
      const possibleName = firstWordMatch[1].toLowerCase();
      if (this.agentNames.has(possibleName)) return possibleName;
    }

    // Strategy 3: "ask/tell <name> ..." or "ask <name> to ..."
    const askTellMatch = trimmed.match(
      /^(?:ask|tell)\s+(\w+)[,.]?\s+(?:to\s+)?(.*)/i,
    );
    if (askTellMatch) {
      const possibleName = askTellMatch[1].toLowerCase();
      if (this.agentNames.has(possibleName)) return possibleName;
    }

    // Strategy 4: Scan anywhere for a known agent name as a whole word
    for (const [name] of this.agentNames) {
      const nameRegex = new RegExp(`\\b${name}\\b`, 'i');
      if (nameRegex.test(lower)) return name;
    }

    return null;
  }

  /**
   * Strips the agent name prefix from the command text.
   *
   * This removes the greeting/prefix that was used to address the agent,
   * returning just the command itself.
   *
   * @param trimmed - The original trimmed command text
   * @param _agentName - The agent name that was extracted (unused in implementation)
   * @returns The command text with agent prefix removed
   * @private
   */
  private stripAgentPrefix(trimmed: string, _agentName: string): string {
    // Try to strip greeting + name prefix
    const greetingMatch = trimmed.match(
      /^(?:hey|hi|ok|yo|hello)[,.]?\s+\w+[,.]?\s*(.*)/i,
    );
    if (greetingMatch && greetingMatch[1].trim()) return greetingMatch[1].trim();

    // Try to strip name as first word
    const firstWordMatch = trimmed.match(/^\w+[,.]?\s+(.*)/i);
    if (firstWordMatch && firstWordMatch[1].trim()) return firstWordMatch[1].trim();

    // Try ask/tell pattern
    const askTellMatch = trimmed.match(
      /^(?:ask|tell)\s+\w+[,.]?\s+(?:to\s+)?(.*)/i,
    );
    if (askTellMatch && askTellMatch[1].trim()) return askTellMatch[1].trim();

    return trimmed;
  }
}
