/**
 * @fileoverview JSONL Parser - Shared utilities for parsing JSONL stream output.
 *
 * This module provides a single source of truth for parsing JSONL (newline-delimited JSON)
 * output from agent runtimes like Claude Code and Cursor. It eliminates duplication
 * between runtime implementations.
 *
 * Functions:
 * - parseJsonlStreamEvent: Parses a single line and emits progress events
 * - emitJsonlTerminalLine: Converts JSON events to markdown-friendly terminal output
 * - hasResultEvent: Checks if stdout contains a result event
 * - parseJsonlResult: Extracts the final result and token usage from stdout
 *
 * @module agent-runtime/runtimes/jsonl-parser
 */

import type { ExecutionProgress, ExecutionResult, TokenUsage } from '@jam/core';
import { stripAnsiSimple } from '../utils.js';

/**
 * Parses a single JSONL stream event and emits structured progress.
 *
 * This function handles various event shapes from different runtimes:
 * - Tool use events (type: 'tool_use' or tool_name field)
 * - Content block events (type: 'content_block_start')
 * - Thinking events
 * - Message start events
 *
 * Unrecognized JSON is silently ignored.
 *
 * @param line - A single line of JSONL output
 * @param onProgress - Callback to emit progress events
 *
 * @example
 * ```typescript
 * parseJsonlStreamEvent('{"type":"tool_use","tool_name":"bash","input":{"command":"ls"}}', (event) => {
 *   console.log(event); // { type: 'tool-use', summary: 'Using bash: ls' }
 * });
 * ```
 */
export function parseJsonlStreamEvent(
  line: string,
  onProgress: (event: ExecutionProgress) => void,
): void {
  try {
    const event = JSON.parse(line);

    // Tool use events
    if (event.type === 'tool_use' || event.tool_name) {
      const toolName = event.tool_name ?? event.name ?? 'a tool';
      const input = event.input?.command ?? event.input?.file_path ?? '';
      const summary = input
        ? `Using ${toolName}: ${String(input).slice(0, 60)}`
        : `Using ${toolName}`;
      onProgress({ type: 'tool-use', summary });
      return;
    }

    // Content block with tool_use type
    if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      const name = event.content_block.name ?? 'a tool';
      onProgress({ type: 'tool-use', summary: `Using ${name}` });
      return;
    }

    // Thinking events
    if (event.type === 'thinking' || (event.type === 'content_block_start' && event.content_block?.type === 'thinking')) {
      onProgress({ type: 'thinking', summary: 'Thinking...' });
      return;
    }

    // Message start
    if (event.type === 'message_start') {
      onProgress({ type: 'thinking', summary: 'Processing request...' });
      return;
    }

    // Text content block
    if (event.type === 'content_block_start' && event.content_block?.type === 'text') {
      onProgress({ type: 'text', summary: 'Composing response...' });
      return;
    }
  } catch {
    // Not JSON or unrecognized format — ignore
  }
}

/**
 * Converts a JSONL event into markdown-friendly text for terminal rendering.
 *
 * This function transforms structured JSON events into human-readable text:
 * - Tool use: Rendered as inline code with command/file
 * - Tool result: Rendered as code block
 * - Text content: Emitted as-is for streaming
 * - Thinking: Rendered as italic placeholder
 *
 * Non-JSON lines are emitted as-is (fallback for malformed output).
 *
 * @param line - A single line of JSONL output
 * @param onOutput - Callback to emit terminal text
 *
 * @example
 * ```typescript
 * emitJsonlTerminalLine('{"type":"tool_use","name":"bash","input":{"command":"ls"}}', (text) => {
 *   console.log(text); // "\n`bash` ls\n"
 * });
 * ```
 */
export function emitJsonlTerminalLine(
  line: string,
  onOutput: (data: string) => void,
): void {
  try {
    const raw = JSON.parse(line);
    // Unwrap stream_event wrapper if present
    const event = raw.type === 'stream_event' && raw.event ? raw.event : raw;

    // Tool use — show as inline code block
    if (event.type === 'tool_use' || event.tool_name) {
      const toolName = event.tool_name ?? event.name ?? 'tool';
      const input = event.input?.command ?? event.input?.file_path ?? '';
      onOutput(`\n\`${toolName}\` ${input ? String(input).slice(0, 200) : ''}\n`);
      return;
    }
    if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      const name = event.content_block.name ?? 'tool';
      onOutput(`\n\`${name}\` `);
      return;
    }

    // Tool result — show as code block
    if (event.type === 'tool_result' || event.content_type === 'tool_result') {
      const output = event.output ?? event.content ?? '';
      if (output) onOutput(`\n\`\`\`\n${String(output).slice(0, 500)}\n\`\`\`\n`);
      return;
    }

    // Text content delta — stream text as it arrives
    if (event.type === 'content_block_delta') {
      const text = event.delta?.text ?? event.delta?.thinking;
      if (text) {
        onOutput(text);
        return;
      }
    }

    // Thinking indicator
    if (event.type === 'thinking' || (event.type === 'content_block_start' && event.content_block?.type === 'thinking')) {
      onOutput('\n*thinking...*\n');
      return;
    }

    // Assistant message — contains the full response
    if (event.type === 'assistant' && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === 'text' && block.text) {
          onOutput(block.text);
        } else if (block.type === 'tool_use') {
          const input = block.input?.command ?? block.input?.file_path ?? '';
          onOutput(`\n\`${block.name}\` ${input ? String(input).slice(0, 200) : ''}\n`);
        }
      }
      return;
    }

    // Result event — show final result text
    if (event.type === 'result' && event.result) {
      onOutput(`\n${event.result}\n`);
      return;
    }

    // system, message_start, message_stop, content_block_stop — skip silently
  } catch {
    // Not JSON — emit raw line as-is
    const trimmed = line.trim();
    if (trimmed) onOutput(trimmed + '\n');
  }
}

/**
 * Checks if JSONL stdout contains an explicit result event.
 *
 * This is used to distinguish genuine agent output (which has a result event)
 * from raw text fallback (which doesn't).
 *
 * @param stdout - The full stdout from the agent process
 * @returns True if a result event is found
 *
 * @example
 * ```typescript
 * if (hasResultEvent(stdout)) {
 *   const result = parseJsonlResult(stdout);
 *   console.log(result.text);
 * }
 * ```
 */
export function hasResultEvent(stdout: string): boolean {
  for (const line of stdout.trim().split('\n')) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'result') return true;
    } catch { /* skip */ }
  }
  return false;
}

/**
 * Extracts the result from JSONL stdout.
 *
 * This function:
 * 1. Searches backward for the last 'result' event (most recent result wins)
 * 2. Aggregates token usage from all events that report it
 * 3. Falls back to parsing as single JSON if no result event found
 * 4. Final fallback: returns raw stdout stripped of ANSI codes
 *
 * Token usage aggregation supports multiple event shapes:
 * - Claude Code: result event with total_input_tokens / total_output_tokens
 * - Generic: message events with usage.input_tokens / usage.output_tokens
 *
 * @param stdout - The full stdout from the agent process
 * @returns The parsed execution result with text, session ID, and token usage
 *
 * @example
 * ```typescript
 * const result = parseJsonlResult(stdout);
 * console.log(result.text);      // Agent's response text
 * console.log(result.usage);     // { inputTokens: 1000, outputTokens: 500 }
 * console.log(result.sessionId); // "sess_abc123"
 * ```
 */
export function parseJsonlResult(stdout: string): ExecutionResult {
  const lines = stdout.trim().split('\n');
  const usage = extractTokenUsage(lines);

  // Look for the result event (last one wins)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (obj.type === 'result') {
        return {
          success: true,
          text: obj.result ?? '',
          sessionId: obj.session_id,
          usage,
        };
      }
    } catch { /* skip non-JSON lines */ }
  }

  // Fallback: try as single JSON
  try {
    const data = JSON.parse(stdout);
    // System init message is not result text — skip it
    if (data.type === 'system' && data.subtype === 'init') {
      return { success: true, text: '', sessionId: data.session_id, usage };
    }
    return {
      success: true,
      text: data.result ?? data.text ?? data.content ?? stdout,
      sessionId: data.session_id,
      usage,
    };
  } catch {
    // Last resort: return raw stdout stripped of ANSI
    return { success: true, text: stripAnsiSimple(stdout).trim(), usage };
  }
}

/**
 * Aggregates token usage from JSONL stream events.
 *
 * This function extracts token usage from various event shapes:
 * - Claude Code result event: total_input_tokens / total_output_tokens
 * - Claude Code result event (nested): usage.input_tokens / usage.output_tokens
 * - Anthropic API message events: usage.input_tokens / usage.output_tokens
 * - Nested message events: message.usage.input_tokens / message.usage.output_tokens
 *
 * @param lines - Array of JSONL lines from stdout
 * @returns Token usage with input/output counts, or undefined if not found
 * @private
 */
function extractTokenUsage(lines: string[]): TokenUsage | undefined {
  let inputTokens = 0;
  let outputTokens = 0;
  let found = false;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);

      // Claude Code result event includes total usage
      if (obj.type === 'result' && obj.total_input_tokens != null) {
        return {
          inputTokens: obj.total_input_tokens,
          outputTokens: obj.total_output_tokens ?? 0,
        };
      }

      // Claude Code result event — usage nested under result
      if (obj.type === 'result' && obj.usage) {
        return {
          inputTokens: obj.usage.input_tokens ?? 0,
          outputTokens: obj.usage.output_tokens ?? 0,
        };
      }

      // Message-level usage (Anthropic API shape: message_start, message_stop)
      if (obj.usage?.input_tokens != null || obj.usage?.output_tokens != null) {
        inputTokens += obj.usage.input_tokens ?? 0;
        outputTokens += obj.usage.output_tokens ?? 0;
        found = true;
        continue;
      }

      // Nested under message (e.g. message_start event)
      if (obj.message?.usage?.input_tokens != null) {
        inputTokens += obj.message.usage.input_tokens ?? 0;
        outputTokens += obj.message.usage.output_tokens ?? 0;
        found = true;
      }
    } catch { /* skip non-JSON */ }
  }

  return found ? { inputTokens, outputTokens } : undefined;
}
