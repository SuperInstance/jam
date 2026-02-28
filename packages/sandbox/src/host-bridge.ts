import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { normalize, resolve, sep } from 'node:path';
import type { IHostBridge } from '@jam/core';
import { createLogger } from '@jam/core';

const log = createLogger('HostBridge');

const MAX_BODY_SIZE = 1_024 * 1_024; // 1MB

/** Characters and patterns that indicate path traversal attempts */
const PATH_TRAVERSAL_PATTERNS = [
  '..',
  '\0',           // Null byte injection
];

/**
 * Validates a file path for security issues.
 * Returns an error message if validation fails, or null if the path is safe.
 */
function validatePathSafety(rawPath: string): string | null {
  // Normalize the path to resolve . and .. sequences
  const normalizedPath = normalize(rawPath);

  // Check for path traversal patterns in the raw input
  for (const pattern of PATH_TRAVERSAL_PATTERNS) {
    if (rawPath.includes(pattern)) {
      return `Invalid path: contains forbidden pattern`;
    }
  }

  // Ensure the normalized path doesn't escape upward
  if (normalizedPath.startsWith('..') || normalizedPath.includes(`..${sep}`)) {
    return 'Invalid path: path traversal detected';
  }

  // On Windows, block drive letter access attempts (e.g., C:\)
  if (process.platform === 'win32') {
    if (/^[a-zA-Z]:\\/.test(normalizedPath) && !normalizedPath.includes(':\\Users\\')) {
      return 'Invalid path: access to system directories not allowed';
    }
  }

  // Block access to sensitive Unix paths
  if (process.platform !== 'win32') {
    const sensitivePaths = ['/etc', '/root', '/var', '/usr', '/bin', '/sbin', '/boot'];
    for (const sensitive of sensitivePaths) {
      if (normalizedPath.startsWith(sensitive + '/') || normalizedPath === sensitive) {
        return `Invalid path: access to ${sensitive} not allowed`;
      }
    }
  }

  return null;
}

/**
 * Timing-safe string comparison to prevent timing attacks.
 * Uses Node's crypto.timingSafeEqual under the hood.
 */
function timingSafeCompare(a: string, b: string): boolean {
  // Strings must be equal length for timingSafeEqual
  if (a.length !== b.length) {
    return false;
  }
  // Convert to buffers for comparison
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return timingSafeEqual(bufA, bufB);
}

/** Injected host capabilities — keeps this package free of Electron imports (DIP) */
export interface HostBridgeDeps {
  openExternal: (url: string) => Promise<void>;
  readClipboard: () => string;
  writeClipboard: (text: string) => void;
  openPath: (path: string) => Promise<string>;
  showNotification: (title: string, body: string) => void;
}

interface BridgeRequest {
  operation: string;
  params: Record<string, unknown>;
}

interface BridgeResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

interface BridgeOperation {
  validate: (params: Record<string, unknown>) => string | null;
  execute: (params: Record<string, unknown>) => Promise<BridgeResponse>;
}

/**
 * Host Bridge — lightweight HTTP server that exposes whitelisted host operations
 * to containerized agents. Agents reach it via `host.docker.internal`.
 *
 * Operations use a registry map (OCP-compliant). Adding a new host operation
 * means adding one entry to the operations map.
 */
export class HostBridge implements IHostBridge {
  private server: Server | null = null;
  private token = '';
  private readonly operations: Map<string, BridgeOperation>;

  constructor(
    private readonly port: number,
    private readonly deps: HostBridgeDeps,
  ) {
    this.operations = this.buildOperations();
  }

  get isListening(): boolean {
    return this.server?.listening ?? false;
  }

  async start(token: string): Promise<{ url: string; port: number }> {
    if (this.server) {
      throw new Error('Host bridge already running');
    }

    this.token = token;

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));

      this.server.on('error', (err) => {
        log.error(`Host bridge server error: ${String(err)}`);
        reject(err);
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        const url = `http://127.0.0.1:${this.port}/bridge`;
        log.info(`Host bridge listening on port ${this.port}`);
        resolve({ url, port: this.port });
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = null;
        log.info('Host bridge stopped');
        resolve();
      });
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // CORS headers for container requests
    res.setHeader('Content-Type', 'application/json');

    // Only accept POST to /bridge
    if (req.method !== 'POST' || req.url !== '/bridge') {
      res.writeHead(404);
      res.end(JSON.stringify({ success: false, error: 'Not found' }));
      return;
    }

    // Validate auth token (timing-safe to prevent timing attacks)
    const authHeader = req.headers.authorization;
    const expectedAuth = `Bearer ${this.token}`;
    if (!authHeader || !timingSafeCompare(authHeader, expectedAuth)) {
      res.writeHead(401);
      res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
      return;
    }

    // Parse body with size limit
    let body = '';
    let tooLarge = false;

    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > MAX_BODY_SIZE) {
        tooLarge = true;
        res.writeHead(413);
        res.end(JSON.stringify({ success: false, error: 'Request body too large' }));
        req.destroy();
      }
    });

    req.on('end', async () => {
      if (tooLarge) return;

      try {
        const request: BridgeRequest = JSON.parse(body);
        const operation = this.operations.get(request.operation);

        if (!operation) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: `Unknown operation: ${request.operation}` }));
          return;
        }

        const params = request.params ?? {};
        const validationError = operation.validate(params);
        if (validationError) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: validationError }));
          return;
        }

        log.info(`Executing operation: ${request.operation}`);
        const result = await operation.execute(params);
        res.writeHead(200);
        res.end(JSON.stringify(result));
      } catch (err) {
        log.error(`Bridge request error: ${String(err)}`);
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: 'Internal error' }));
      }
    });
  }

  /** Build the whitelisted operations registry */
  private buildOperations(): Map<string, BridgeOperation> {
    return new Map<string, BridgeOperation>([
      ['open-url', {
        validate: (params) => {
          const url = params.url;
          if (!url || typeof url !== 'string') return 'Missing "url" parameter';
          if (!/^https?:\/\//i.test(url)) return 'URL must start with http:// or https://';
          return null;
        },
        execute: async (params) => {
          await this.deps.openExternal(params.url as string);
          return { success: true };
        },
      }],

      ['clipboard-read', {
        validate: () => null,
        execute: async () => {
          const text = this.deps.readClipboard();
          return { success: true, data: { text } };
        },
      }],

      ['clipboard-write', {
        validate: (params) => {
          if (typeof params.text !== 'string') return 'Missing "text" parameter';
          return null;
        },
        execute: async (params) => {
          this.deps.writeClipboard(params.text as string);
          return { success: true };
        },
      }],

      ['applescript', {
        validate: (params) => {
          const script = params.script;
          if (!script || typeof script !== 'string') return 'Missing "script" parameter';
          // Block dangerous operations — no arbitrary shell execution or keystroke simulation
          if (/do shell script/i.test(script)) {
            return 'Blocked: "do shell script" is not allowed for security reasons';
          }
          if (/system events.*keystroke/i.test(script)) {
            return 'Blocked: keystroke simulation is not allowed for security reasons';
          }
          return null;
        },
        execute: async (params) => {
          if (process.platform !== 'darwin') {
            return { success: false, error: 'AppleScript is only available on macOS' };
          }
          try {
            const output = execFileSync('osascript', ['-e', params.script as string], {
              encoding: 'utf-8',
              timeout: 10_000,
            }).trim();
            return { success: true, data: { output } };
          } catch (err) {
            return { success: false, error: String(err) };
          }
        },
      }],

      ['notification', {
        validate: (params) => {
          if (typeof params.title !== 'string') return 'Missing "title" parameter';
          return null;
        },
        execute: async (params) => {
          this.deps.showNotification(
            params.title as string,
            (params.body as string) ?? '',
          );
          return { success: true };
        },
      }],

      ['file-open', {
        validate: (params) => {
          if (typeof params.path !== 'string') return 'Missing "path" parameter';
          const pathError = validatePathSafety(params.path);
          if (pathError) return pathError;
          return null;
        },
        execute: async (params) => {
          const result = await this.deps.openPath(params.path as string);
          return result ? { success: false, error: result } : { success: true };
        },
      }],
    ]);
  }
}
