import { watch, type FSWatcher } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ITaskStore, IEventBus } from '@jam/core';
import { Events, createLogger } from '@jam/core';
import { DebouncedFileWriter } from './utils/debounced-writer.js';

const log = createLogger('InboxWatcher');

/**
 * Watches agent inbox files for new task requests.
 * Agents can self-create or delegate tasks by appending JSONL to
 * `{agentCwd}/inbox.jsonl`.
 */
export class InboxWatcher {
  private watchers: Map<string, FSWatcher> = new Map();
  private offsets: Map<string, number> = new Map();
  /** Per-path debounce — coalesces rapid fs events into a single processInbox call */
  private debouncers: Map<string, DebouncedFileWriter> = new Map();
  /** Guard flag to ignore watch events caused by our own writes */
  private processing: Set<string> = new Set();

  constructor(
    private readonly taskStore: ITaskStore,
    private readonly eventBus: IEventBus,
  ) {}

  watchAgent(agentId: string, cwd: string): void {
    if (this.watchers.has(agentId)) return;

    const inboxPath = join(cwd, 'inbox.jsonl');
    this.offsets.set(inboxPath, 0);

    try {
      const debouncer = new DebouncedFileWriter(100);
      this.debouncers.set(inboxPath, debouncer);

      const watcher = watch(inboxPath, () => {
        // Skip events triggered by our own writes
        if (this.processing.has(inboxPath)) return;
        debouncer.schedule(() => this.processInbox(agentId, inboxPath));
      });
      this.watchers.set(agentId, watcher);
    } catch {
      // File may not exist yet — that's fine, we'll create on first write
    }
  }

  unwatchAgent(agentId: string): void {
    const watcher = this.watchers.get(agentId);
    if (watcher) {
      watcher.close();
      this.watchers.delete(agentId);
    }
  }

  stopAll(): void {
    for (const [id] of this.watchers) {
      this.unwatchAgent(id);
    }
    for (const debouncer of this.debouncers.values()) {
      debouncer.cancel();
    }
    this.debouncers.clear();
    this.processing.clear();
  }

  private async processInbox(
    agentId: string,
    inboxPath: string,
  ): Promise<void> {
    try {
      const content = await readFile(inboxPath, 'utf-8');
      const offset = this.offsets.get(inboxPath) ?? 0;
      const newContent = content.slice(offset);
      this.offsets.set(inboxPath, content.length);

      const lines = newContent.split('\n').filter((l) => l.trim());

      for (const line of lines) {
        try {
          const request = JSON.parse(line) as {
            title?: string;
            description?: string;
            priority?: string;
            assignedTo?: string;
            from?: string;
            tags?: string[];
          };

          const description = request.description || '';

          // Derive title: use explicit title, or extract first line of description
          let title = request.title;
          if (!title || title === 'undefined') {
            const firstLine = description.split('\n')[0]?.trim() ?? '';
            title = firstLine.length > 0
              ? firstLine.slice(0, 100)
              : 'Untitled task';
            log.warn(`Inbox entry missing title, derived: "${title}"`);
          }

          // `from` is the sender agent ID; falls back to inbox owner
          const sender = request.from || agentId;

          // assignedTo defaults to inbox owner — always 'assigned' so TaskExecutor picks it up
          const assignee = request.assignedTo || agentId;
          const task = await this.taskStore.create({
            title,
            description,
            status: 'assigned',
            priority: (request.priority as 'low' | 'normal' | 'high' | 'critical') ?? 'normal',
            source: 'agent',
            createdBy: sender,
            assignedTo: assignee,
            createdAt: new Date().toISOString(),
            tags: request.tags ?? [],
          });

          this.eventBus.emit(Events.TASK_CREATED, { task });

          // Notify UI about the inbox message
          log.info(`Inbox task from ${sender} → ${agentId}: "${title}"`);
          this.eventBus.emit('task:resultReady', {
            taskId: task.id,
            agentId: sender,
            title,
            text: `Delegated task to ${agentId}: "${title}"`,
            success: true,
          });
        } catch {
          // skip malformed lines
        }
      }

      // Clear processed inbox (guard to prevent re-triggering watcher)
      if (lines.length > 0) {
        this.processing.add(inboxPath);
        await writeFile(inboxPath, '', 'utf-8');
        this.offsets.set(inboxPath, 0);
        // Release guard after fs events settle
        setTimeout(() => this.processing.delete(inboxPath), 200);
      }
    } catch {
      // inbox file may not exist yet
    }
  }
}
