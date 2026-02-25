import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import type { IImageManager, IDockerClient } from '@jam/core';
import { createLogger } from '@jam/core';

const log = createLogger('ImageManager');

/**
 * Manages the Docker image used for agent sandbox containers.
 *
 * The Dockerfile content is provided at construction time — no runtime
 * file-path resolution needed. This makes it work reliably in bundled
 * environments (vite-plugin-electron, electron-builder, etc.).
 */
export class ImageManager implements IImageManager {
  private readonly contentHash: string;

  constructor(
    private readonly docker: IDockerClient,
    private readonly dockerfileContent: string,
  ) {
    // Short hash of Dockerfile content — used to detect when image needs rebuilding
    this.contentHash = createHash('sha256').update(dockerfileContent).digest('hex').slice(0, 8);
  }

  /**
   * Compute the versioned image tag (e.g. `jam-agent:abc12345`).
   * When the Dockerfile content changes, the hash changes, triggering a rebuild.
   */
  resolveTag(baseTag: string): string {
    const [name] = baseTag.split(':');
    return `${name}:${this.contentHash}`;
  }

  /**
   * Ensure the agent sandbox image exists.
   * Uses a content-hash tag so Dockerfile changes trigger automatic rebuild.
   *
   * @param onOutput - optional callback for streaming build progress lines
   */
  async ensureImage(tag: string, onOutput?: (line: string) => void): Promise<void> {
    const versionedTag = this.resolveTag(tag);

    if (this.docker.imageExists(versionedTag)) {
      log.info(`Image ${versionedTag} already exists`);
      return;
    }

    // Write Dockerfile to a temp build context directory
    const buildCtx = join(tmpdir(), `jam-docker-build-${Date.now()}`);
    mkdirSync(buildCtx, { recursive: true });
    writeFileSync(join(buildCtx, 'Dockerfile'), this.dockerfileContent, 'utf-8');

    log.info(`Image ${versionedTag} not found — building...`);
    try {
      await this.docker.buildImage(buildCtx, versionedTag, onOutput);
    } finally {
      try { rmSync(buildCtx, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
}
