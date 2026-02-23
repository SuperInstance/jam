import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
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
import { stripAnsiSimple, buildCleanEnv } from '../utils.js';

const log = createLogger('ClaudeCodeRuntime');

export class ClaudeCodeRuntime implements IAgentRuntime {
  readonly runtimeId = 'claude-code';

  readonly metadata: RuntimeMetadata = {
    id: 'claude-code',
    displayName: 'Claude Code',
    cliCommand: 'claude',
    installHint: 'npm install -g @anthropic-ai/claude-code',
    supportsFullAccess: true,
    nodeVersionRequired: 20,
    models: [
      { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', group: 'Claude 4' },
      { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5', group: 'Claude 4' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', group: 'Claude 4' },
      { id: 'opus', label: 'Opus (latest)', group: 'Aliases' },
      { id: 'sonnet', label: 'Sonnet (latest)', group: 'Aliases' },
      { id: 'haiku', label: 'Haiku (latest)', group: 'Aliases' },
    ],
    detectAuth(homedir: string): boolean {
      const claudeDir = `${homedir}/.claude`;
      return existsSync(`${claudeDir}/statsCache`) ||
        existsSync(`${claudeDir}/stats-cache.json`) ||
        (existsSync(`${claudeDir}/projects`) &&
          readdirSync(`${claudeDir}/projects`).length > 0);
    },
    getAuthHint: () => 'Run "claude" in your terminal to authenticate via browser',
  };

  buildSpawnConfig(profile: AgentProfile): SpawnConfig {
    const args: string[] = [];

    if (profile.allowFullAccess) {
      args.push('--dangerously-skip-permissions');
    }

    if (profile.model) {
      args.push('--model', profile.model);
    }

    const systemPrompt = this.buildSystemPrompt(profile);
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    return {
      command: 'claude',
      args,
      env: {
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      },
    };
  }

  parseOutput(raw: string): AgentOutput {
    const cleaned = stripAnsiSimple(raw);

    if (cleaned.includes('Tool use:') || cleaned.includes('Running:')) {
      return { type: 'tool-use', content: cleaned.trim(), raw };
    }

    if (cleaned.includes('Thinking...') || cleaned.includes('thinking')) {
      return { type: 'thinking', content: cleaned.trim(), raw };
    }

    return { type: 'text', content: cleaned.trim(), raw };
  }

  formatInput(text: string, context?: InputContext): string {
    let input = text;

    if (context?.sharedContext) {
      input = `[Context from other agents: ${context.sharedContext}]\n\n${input}`;
    }

    return input;
  }

  async execute(profile: AgentProfile, text: string, options?: ExecutionOptions): Promise<ExecutionResult> {
    const args = this.buildOneShotArgs(profile, options?.sessionId);
    const env = buildCleanEnv({
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      ...options?.env,
    });

    log.info(`Executing: claude ${args.join(' ')} <<< "${text.slice(0, 60)}"`, undefined, profile.id);

    return new Promise((resolve) => {
      const child = spawn('claude', args, {
        cwd: options?.cwd ?? profile.cwd ?? process.env.HOME ?? '/',
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Pipe voice command text via stdin — avoids shell escaping issues
      child.stdin.write(text);
      child.stdin.end();

      let stdout = '';
      let stderr = '';

      // Abort signal support
      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          child.kill('SIGTERM');
        }, { once: true });
      }

      // Parse streaming JSONL events for progress reporting + terminal output
      let lineBuf = '';

      child.stdout.on('data', (chunk: Buffer) => {
        const chunkStr = chunk.toString();
        stdout += chunkStr;

        if (options?.onProgress || options?.onOutput) {
          lineBuf += chunkStr;
          const lines = lineBuf.split('\n');
          lineBuf = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.trim()) continue;
            if (options.onProgress) this.parseStreamEvent(line, options.onProgress);
            if (options.onOutput) this.emitTerminalLine(line, options.onOutput);
          }
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('close', (code) => {
        // Parse any remaining buffered line
        if (lineBuf.trim()) {
          if (options?.onProgress) this.parseStreamEvent(lineBuf, options.onProgress);
          if (options?.onOutput) this.emitTerminalLine(lineBuf, options.onOutput);
        }

        if (code !== 0) {
          // Log raw output for debugging
          log.debug(`Execute stderr (${stderr.length} chars): ${stderr.slice(0, 300)}`, undefined, profile.id);
          log.debug(`Execute stdout tail (${stdout.length} chars): ${stdout.slice(-500)}`, undefined, profile.id);

          // Try all sources: stdout JSON first (most detailed), then stderr, then fallback
          const stdoutErr = this.extractErrorFromOutput(stdout);
          const stderrErr = stderr.trim();
          const errMsg = (stdoutErr || stderrErr || `Exit code ${code}`).slice(0, 500);
          log.error(`Execute failed (exit ${code}): ${errMsg}`, undefined, profile.id);
          resolve({ success: false, text: '', error: errMsg });
          return;
        }

        const result = this.parseOneShotOutput(stdout);
        log.info(`Execute complete: ${result.text.length} chars`, undefined, profile.id);
        resolve(result);
      });

      child.on('error', (err) => {
        log.error(`Spawn error: ${String(err)}`, undefined, profile.id);
        resolve({ success: false, text: '', error: String(err) });
      });
    });
  }

  /** Parse a single streaming JSONL event and emit progress if interesting */
  private parseStreamEvent(
    line: string,
    onProgress: (event: { type: 'tool-use' | 'thinking' | 'text'; summary: string }) => void,
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

      // Message start — agent has begun processing the request
      if (event.type === 'message_start') {
        onProgress({ type: 'thinking', summary: 'Processing request...' });
        return;
      }

      // Text content block — agent is composing a text response
      if (event.type === 'content_block_start' && event.content_block?.type === 'text') {
        onProgress({ type: 'text', summary: 'Composing response...' });
        return;
      }
    } catch {
      // Not JSON or unrecognized format — ignore
    }
  }

  /** Convert a JSONL event into markdown-friendly text for streamdown rendering */
  private emitTerminalLine(
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

      // Assistant message — contains the full response (show result text)
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

  /** Build CLI args for one-shot `claude -p --output-format stream-json` */
  private buildOneShotArgs(profile: AgentProfile, sessionId?: string): string[] {
    const args: string[] = ['-p', '--verbose', '--output-format', 'stream-json'];

    if (profile.allowFullAccess) {
      args.push('--dangerously-skip-permissions');
    }

    if (profile.model) {
      args.push('--model', profile.model);
    }

    const systemPrompt = this.buildSystemPrompt(profile);
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    if (sessionId) {
      args.push('--resume', sessionId);
    }

    return args;
  }

  /** Compose a system prompt — uses enriched prompt directly if present (from AgentContextBuilder) */
  private buildSystemPrompt(profile: AgentProfile): string {
    if (profile.systemPrompt) return profile.systemPrompt;
    return `Your name is ${profile.name}. When asked who you are, respond as ${profile.name}.`;
  }

  /** Try to extract an error message from stdout (Claude Code outputs errors as JSON) */
  private extractErrorFromOutput(stdout: string): string | undefined {
    const lines = stdout.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        // Direct error field
        if (obj.error) return typeof obj.error === 'string' ? obj.error : JSON.stringify(obj.error);
        // Error event type
        if (obj.type === 'error' && obj.message) return obj.message;
        // Result event with error
        if (obj.type === 'result' && obj.is_error) {
          return obj.result ?? obj.error ?? 'Unknown error in result';
        }
        // System error event
        if (obj.type === 'system' && obj.error) return obj.error;
      } catch { /* skip non-JSON */ }
    }
    // Fallback: last non-empty non-JSON line of raw output (skip trivial lines)
    const stripped = stripAnsiSimple(stdout).trim();
    const rawLines = stripped.split('\n').filter(l => {
      const t = l.trim();
      return t.length > 0 && t !== 'unknown' && !t.startsWith('{');
    });
    return rawLines.pop()?.trim() || undefined;
  }

  /** Parse streaming JSONL output — find the result event */
  private parseOneShotOutput(stdout: string): ExecutionResult {
    const lines = stdout.trim().split('\n');

    // Look for the result event (last one wins)
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        if (obj.type === 'result') {
          return {
            success: true,
            text: obj.result ?? '',
            sessionId: obj.session_id,
          };
        }
      } catch { /* skip non-JSON lines */ }
    }

    // Fallback: try as single JSON
    try {
      const data = JSON.parse(stdout);
      return {
        success: true,
        text: data.result ?? data.text ?? data.content ?? stdout,
        sessionId: data.session_id,
      };
    } catch {
      // Last resort: return raw stdout stripped of ANSI
      return { success: true, text: stripAnsiSimple(stdout).trim() };
    }
  }
}
