import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Debounced file writer — coalesces rapid writes into a single disk flush.
 * Used by all file-backed stores to avoid I/O thrashing.
 *
 * Uses trailing-edge debounce: each call resets the timer so that the flush
 * only fires once writes have settled for `delayMs`.
 */
export class DebouncedFileWriter {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly delayMs: number = 500) {}

  /** Schedule a flush. Resets the timer on each call (trailing-edge debounce). */
  schedule(flush: () => Promise<void>): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      flush().catch(() => {});
    }, this.delayMs);
  }

  /** Cancel any pending flush (e.g. on shutdown). */
  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Force an immediate flush, cancelling any pending timer. */
  async flushNow(flush: () => Promise<void>): Promise<void> {
    this.cancel();
    await flush();
  }

  get pending(): boolean {
    return this.timer !== null;
  }
}

/** Ensure directory exists, then write compact JSON to file. */
export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data), 'utf-8');
}
