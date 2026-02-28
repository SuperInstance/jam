/**
 * @fileoverview OutputStrategy - Strategy pattern for processing agent stdout.
 *
 * This module provides pluggable strategies for processing child process stdout,
 * allowing different runtimes to handle output formats appropriately.
 *
 * Two implementations are provided:
 * - JsonlOutputStrategy: Line-buffered JSON parsing for structured runtimes
 * - ThrottledOutputStrategy: Raw streaming with progress throttling
 *
 * Design Patterns:
 * - Strategy Pattern: Pluggable output processing via OutputStrategy interface
 * - Template Method: processChunk() + flush() lifecycle
 *
 * @module agent-runtime/runtimes/output-strategy
 */

import type { ExecutionProgress } from '@jam/core';
import { stripAnsiSimple } from '../utils.js';

/**
 * Callbacks for output processing events.
 *
 * @interface
 */
export interface OutputCallbacks {
  /**
   * Called when a progress event should be emitted.
   * Progress events describe what the agent is currently doing.
   */
  onProgress?: (event: ExecutionProgress) => void;

  /**
   * Called when output data should be displayed.
   * This is typically text that appears in the terminal UI.
   */
  onOutput?: (data: string) => void;
}

/**
 * Strategy interface for processing child process stdout.
 *
 * Implementations handle different output formats:
 * - JSONL (newline-delimited JSON) for structured streaming
 * - Raw ANSI text for simple CLI tools
 *
 * @interface
 */
export interface OutputStrategy {
  /**
   * Processes a raw stdout chunk.
   *
   * This is called for each data event from the child process.
   * Implementations may buffer data and emit callbacks asynchronously.
   *
   * @param chunk - The raw stdout chunk
   * @param callbacks - Callbacks for progress and output events
   */
  processChunk(chunk: string, callbacks: OutputCallbacks): void;

  /**
   * Flushes any remaining buffered data.
   *
   * This is called when the process closes. Implementations with
   * buffered data (e.g., incomplete lines) should flush it here.
   *
   * @param callbacks - Callbacks for progress and output events
   */
  flush(callbacks: OutputCallbacks): void;
}

/**
 * Line-buffered JSONL strategy for runtimes that output stream-json format.
 *
 * This strategy buffers stdout by newline and processes each line as JSON.
 * It's used by runtimes like Claude Code and Cursor that emit structured events.
 *
 * @class
 *
 * @example
 * ```typescript
 * const strategy = new JsonlOutputStrategy(
 *   (line, onProgress) => {
 *     const event = JSON.parse(line);
 *     if (event.type === 'tool_use') {
 *       onProgress({ type: 'tool-use', summary: `Using ${event.name}` });
 *     }
 *   },
 *   (line, onOutput) => {
 *     const event = JSON.parse(line);
 *     if (event.type === 'content_block_delta') {
 *       onOutput(event.delta.text);
 *     }
 *   }
 * );
 * ```
 */
export class JsonlOutputStrategy implements OutputStrategy {
  /** Buffer for incomplete lines */
  private lineBuf = '';

  /**
   * Creates a new JsonlOutputStrategy.
   *
   * @param parseStreamEvent - Function to parse a JSON line and emit progress events
   * @param emitTerminalLine - Function to parse a JSON line and emit terminal output
   */
  constructor(
    private parseStreamEvent: (line: string, onProgress: (event: ExecutionProgress) => void) => void,
    private emitTerminalLine: (line: string, onOutput: (data: string) => void) => void,
  ) {}

  /**
   * Processes a stdout chunk as JSONL.
   *
   * Chunks are buffered by newline. Each complete line is parsed as JSON
   * and passed to the parse/emit callbacks.
   *
   * @param chunk - The raw stdout chunk
   * @param callbacks - Callbacks for progress and output events
   */
  processChunk(chunk: string, callbacks: OutputCallbacks): void {
    if (!callbacks.onProgress && !callbacks.onOutput) return;

    this.lineBuf += chunk;
    const lines = this.lineBuf.split('\n');
    this.lineBuf = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      if (callbacks.onProgress) this.parseStreamEvent(line, callbacks.onProgress);
      if (callbacks.onOutput) this.emitTerminalLine(line, callbacks.onOutput);
    }
  }

  /**
   * Flushes the remaining buffered line.
   *
   * Called when the process closes. Any remaining data in the line buffer
   * is processed as a final line.
   *
   * @param callbacks - Callbacks for progress and output events
   */
  flush(callbacks: OutputCallbacks): void {
    if (!this.lineBuf.trim()) return;
    if (callbacks.onProgress) this.parseStreamEvent(this.lineBuf, callbacks.onProgress);
    if (callbacks.onOutput) this.emitTerminalLine(this.lineBuf, callbacks.onOutput);
    this.lineBuf = '';
  }
}

/**
 * Chunk-based strategy for runtimes that output raw ANSI text.
 *
 * This strategy processes stdout chunks as-is, stripping ANSI codes and
 * emitting progress events at a throttled rate (max once per 5 seconds).
 *
 * Used by runtimes like Codex CLI that don't emit structured JSON output.
 *
 * @class
 */
export class ThrottledOutputStrategy implements OutputStrategy {
  /** Timestamp of the last progress emit */
  private lastProgressEmit = 0;

  /** Whether the first chunk has been sent (for initial "Processing..." message) */
  private firstChunkSent = false;

  /**
   * Creates a new ThrottledOutputStrategy.
   *
   * @param classifyChunk - Function to classify cleaned chunks into activity types
   */
  constructor(
    private classifyChunk: (cleaned: string) => 'tool-use' | 'thinking' | 'text',
  ) {}

  /**
   * Processes a stdout chunk with throttled progress updates.
   *
   * - Output is emitted immediately (with ANSI codes stripped)
   * - Progress events are throttled to max once per 5 seconds
   * - First chunk emits an immediate "Processing..." message
   *
   * @param chunk - The raw stdout chunk
   * @param callbacks - Callbacks for progress and output events
   */
  processChunk(chunk: string, callbacks: OutputCallbacks): void {
    if (callbacks.onOutput) {
      callbacks.onOutput(stripAnsiSimple(chunk));
    }

    if (callbacks.onProgress) {
      if (!this.firstChunkSent) {
        this.firstChunkSent = true;
        this.lastProgressEmit = Date.now();
        callbacks.onProgress({ type: 'thinking', summary: 'Processing request...' });
      }

      const now = Date.now();
      if (now - this.lastProgressEmit > 5000) {
        this.lastProgressEmit = now;
        const cleaned = stripAnsiSimple(chunk).trim();
        if (cleaned.length > 0) {
          const type = this.classifyChunk(cleaned);
          callbacks.onProgress({ type, summary: cleaned.slice(0, 80) });
        }
      }
    }
  }

  /**
   * Flush implementation (no-op for unbuffered strategy).
   *
   * This strategy doesn't buffer data, so there's nothing to flush.
   *
   * @param _callbacks - Callbacks (ignored)
   */
  flush(_callbacks: OutputCallbacks): void {
    // No buffering — nothing to flush
  }
}
