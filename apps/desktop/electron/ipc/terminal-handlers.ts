/**
 * Terminal IPC Handlers
 *
 * This module handles all terminal-related IPC communication between the
 * renderer process (React UI) and main process (Electron). It provides:
 * - Writing data to agent PTYs (pseudo-terminals)
 * - Resizing terminal dimensions
 * - Fetching scrollback buffer history
 *
 * Architecture:
 * - Uses ipcMain.on() for fire-and-forget operations (write, resize)
 * - Uses ipcMain.handle() for request/response operations (getScrollback)
 * - Delegates to PtyManager which owns the actual PTY instances
 *
 * Security:
 * - Agent IDs are validated by PtyManager
 * - No shell command injection possible - data is written directly to PTY
 * - Terminal size is clamped to reasonable values by PtyManager
 */
import { ipcMain } from 'electron';
import type { PtyManager } from '@jam/agent-runtime';

/**
 * Narrow dependency interface — only what terminal handlers need.
 * This follows the Interface Segregation Principle (ISP) - handlers only
 * depend on the specific functionality they require, not the entire app.
 */
export interface TerminalHandlerDeps {
  /** The PTY manager instance that owns all agent pseudo-terminals */
  ptyManager: PtyManager;
}

/**
 * Register all terminal-related IPC handlers.
 *
 * Handlers registered:
 * - 'terminal:write' (fire-and-forget) - Write data to an agent's PTY stdin
 * - 'terminal:resize' (fire-and-forget) - Update terminal dimensions
 * - 'terminal:getScrollback' (request/response) - Get terminal history buffer
 *
 * @param deps - Dependencies containing the PTY manager
 */
export function registerTerminalHandlers(deps: TerminalHandlerDeps): void {
  const { ptyManager } = deps;

  /**
   * Write data to an agent's PTY.
   * Used for:
   * - User keyboard input in terminal view
   * - Programmatic input (e.g., answering prompts)
   *
   * Note: This is fire-and-forget (ipcMain.on) for performance.
   * Errors are logged by PtyManager, not propagated to renderer.
   */
  ipcMain.on('terminal:write', (_, agentId: string, data: string) => {
    // Validate inputs to prevent issues
    if (!agentId || typeof data !== 'string') return;
    ptyManager.write(agentId, data);
  });

  /**
   * Resize an agent's terminal.
   * Called when:
   * - User resizes the terminal panel
   * - Agent detail view is opened/closed
   * - Window is resized
   *
   * The PTY will automatically reflow content to fit new dimensions.
   */
  ipcMain.on(
    'terminal:resize',
    (_, agentId: string, cols: number, rows: number) => {
      // Validate dimensions to prevent crashes
      if (!agentId) return;
      const safeCols = Math.max(1, Math.min(cols, 1000));
      const safeRows = Math.max(1, Math.min(rows, 1000));
      ptyManager.resize(agentId, safeCols, safeRows);
    },
  );

  /**
   * Get the scrollback buffer for an agent's terminal.
   * Used when switching to terminal view to show history.
   *
   * Returns: Array of output chunks with timestamps
   */
  ipcMain.handle('terminal:getScrollback', (_, agentId: string) => {
    if (!agentId) return [];
    return ptyManager.getScrollback(agentId);
  });
}
