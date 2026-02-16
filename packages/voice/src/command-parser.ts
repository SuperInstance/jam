import type { AgentId } from '@jam/core';

export interface ParsedCommand {
  targetAgentName: string | null;
  command: string;
  isMetaCommand: boolean;
}

const META_COMMANDS = [
  'create',
  'delete',
  'stop',
  'start',
  'restart',
  'list',
  'configure',
  'status',
];

export class CommandParser {
  private agentNames: Map<string, AgentId> = new Map();

  updateAgentNames(agents: Array<{ id: AgentId; name: string }>): void {
    this.agentNames.clear();
    for (const agent of agents) {
      this.agentNames.set(agent.name.toLowerCase(), agent.id);
    }
  }

  parse(transcript: string): ParsedCommand {
    const trimmed = transcript.trim();
    const cleaned = trimmed.toLowerCase();

    // Check for "hey <name>" or "ok <name>" prefix patterns
    // Match against original-case transcript to preserve command casing
    const addressPatterns = [
      /^(?:hey|hi|ok|yo)\s+(\w+)[,.]?\s*(.*)/i,
      /^(\w+)[,.]?\s+(.*)/i,
    ];

    for (const pattern of addressPatterns) {
      const match = trimmed.match(pattern);
      if (match) {
        const possibleName = match[1].toLowerCase();
        if (this.agentNames.has(possibleName)) {
          const command = match[2].trim();

          return {
            targetAgentName: possibleName,
            // If no explicit command after name, send the whole transcript
            command: command || trimmed,
            isMetaCommand: false,
          };
        }
      }
    }

    // Check for meta commands (e.g., "create new agent named Ray")
    for (const meta of META_COMMANDS) {
      if (cleaned.startsWith(meta)) {
        return {
          targetAgentName: null,
          command: trimmed,
          isMetaCommand: true,
        };
      }
    }

    // No agent addressed - send to default/active agent
    return {
      targetAgentName: null,
      command: trimmed,
      isMetaCommand: false,
    };
  }

  resolveAgentId(name: string): AgentId | undefined {
    return this.agentNames.get(name.toLowerCase());
  }
}
