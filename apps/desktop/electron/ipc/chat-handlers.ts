/**
 * Chat IPC Handlers
 *
 * This module handles all chat-related IPC communication between the
 * renderer process (React UI) and main process (Electron). It provides:
 * - Sending text commands to agents
 * - Interrupting running agent tasks
 * - Loading conversation history
 *
 * Architecture:
 * - Uses CommandParser to extract agent names and commands from text
 * - Uses CommandRouter to resolve which agent should receive the command
 * - Uses AgentManager to queue and execute commands
 *
 * Flow:
 * 1. User types "/status alice" or "alice, fix the bug"
 * 2. CommandParser extracts target agent name and command text
 * 3. CommandRouter resolves to specific agent ID
 * 4. AgentManager queues the command (agents handle one at a time)
 * 5. Result is sent back to renderer via IPC
 *
 * Security:
 * - Commands are parsed, not executed directly
 * - Agent names are validated against known agents
 * - No arbitrary code execution from chat input
 */
import { ipcMain, type BrowserWindow } from 'electron';
import { createLogger } from '@jam/core';
import type { AgentManager } from '@jam/agent-runtime';
import type { CommandParser } from '@jam/voice';
import type { CommandRouter } from '../command-router';

const log = createLogger('ChatHandlers');

/**
 * Narrow dependency interface — only what chat handlers need.
 * This follows the Interface Segregation Principle (ISP).
 */
export interface ChatHandlerDeps {
  /** Parser for extracting agent names and commands from text */
  commandParser: CommandParser;
  /** Manager for agent lifecycle and command execution */
  agentManager: AgentManager;
}

/**
 * Register all chat-related IPC handlers.
 *
 * @param deps - Dependencies (command parser, agent manager)
 * @param router - Command router for target resolution and dispatch
 * @param getWindow - Function to get the main window (for sending events back)
 */
export function registerChatHandlers(
  deps: ChatHandlerDeps,
  router: CommandRouter,
  getWindow: () => BrowserWindow | null,
): void {
  const { commandParser, agentManager } = deps;

  /**
   * Send a text command to an agent.
   *
   * Command formats:
   * - "fix the bug" - sent to last used or only running agent
   * - "alice, fix the bug" - sent to agent named "alice"
   * - "/status alice" - query status of agent "alice"
   *
   * Returns:
   * - success: true + agent response if command executed
   * - success: false + error message if routing/execution failed
   */
  ipcMain.handle('chat:sendCommand', async (_, text: string) => {
    // Input validation
    if (!text || typeof text !== 'string') {
      return { success: false, error: 'Invalid command' };
    }

    // Handle /status command specially (doesn't require agent to be running)
    const statusMatch = text.match(/^\/status\s*(.*)/i);
    if (statusMatch) {
      const agentName = statusMatch[1].trim().toLowerCase();
      let targetId: string | undefined;
      if (agentName) {
        targetId = commandParser.resolveAgentId(agentName);
      }
      if (!targetId) {
        // Use router's resolve logic for fallback
        targetId = router.resolveTarget(
          { targetAgentName: null, command: text, isMetaCommand: false, commandType: 'status-query' },
          'text',
        );
      }
      if (!targetId) return { success: false, error: 'No agent specified. Use /status <agent-name>' };
      return router.handleStatusQuery(targetId);
    }

    // Parse the command to extract target agent and command text
    const parsed = commandParser.parse(text);

    // Meta commands (like "stop all agents") are handled separately
    if (parsed.isMetaCommand) {
      return { success: false, error: 'Meta commands not yet supported via text' };
    }

    // Resolve which agent should receive this command
    const targetId = router.resolveTarget(parsed, 'text');

    // Handle routing failures with helpful error messages
    if (!targetId) {
      if (parsed.targetAgentName) {
        return { success: false, error: `Agent "${parsed.targetAgentName}" not found` };
      }
      const running = router.getRunningAgentNames();
      if (running.length === 0) {
        return { success: false, error: 'No agents running' };
      }
      return {
        success: false,
        error: `Multiple agents running — say the agent's name (${running.join(', ')})`,
      };
    }

    // Track that this agent was last targeted (for next command without name)
    router.recordTarget(targetId, 'text');
    const info = router.getAgentInfo(targetId);
    if (!info) return { success: false, error: 'Agent not found' };

    // Dispatch special command types via registry (status-query, interrupt, etc.)
    // Returns null for regular task commands
    const dispatched = router.dispatch(targetId, parsed);
    if (dispatched) return dispatched;

    // Log the command (truncated for privacy/brevity)
    const cmdPreview = (parsed.command || '').slice(0, 60);
    log.info(`Chat → "${info.agentName}": "${cmdPreview}"`, undefined, targetId);

    // Queue the command (agents process one at a time per agent)
    const { promise, queuePosition } = agentManager.enqueueCommand(targetId, parsed.command || '', 'text');

    // If agent is busy, notify the user about queue position
    if (queuePosition > 0) {
      const win = getWindow();
      win?.webContents.send('chat:messageQueued', {
        agentId: targetId,
        agentName: info.agentName,
        agentRuntime: info.agentRuntime,
        agentColor: info.agentColor,
        queuePosition,
        command: cmdPreview,
      });
    }

    // Wait for command to complete
    const result = await promise;

    return {
      success: result.success,
      text: result.text,
      error: result.error,
      agentId: targetId,
      agentName: info.agentName,
      agentRuntime: info.agentRuntime,
      agentColor: info.agentColor,
    };
  });

  /**
   * Interrupt a running agent task.
   * Sends SIGINT to the agent's process, similar to Ctrl+C.
   */
  ipcMain.handle('chat:interruptAgent', (_, agentId: string) => {
    if (!agentId) return { success: false, error: 'No agent ID provided' };
    return router.handleInterrupt(agentId);
  });

  /**
   * Load conversation history from disk.
   * Used for:
   * - Initial load when app starts
   * - Scrolling up in chat view (infinite scroll)
   *
   * Options:
   * - agentId: Filter to specific agent (optional)
   * - before: ISO timestamp to load older messages (optional)
   * - limit: Max messages to return (default: 50)
   */
  ipcMain.handle('chat:loadHistory', async (_, options?: { agentId?: string; before?: string; limit?: number }) => {
    return agentManager.loadConversationHistory(options);
  });
}
