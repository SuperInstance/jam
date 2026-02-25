import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentProfile } from '@jam/core';

// --- Mocks ---

vi.mock('@jam/core', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  mkdir: vi.fn(),
  appendFile: vi.fn(),
  writeFile: vi.fn(),
  stat: vi.fn(),
}));

const { AgentContextBuilder } = await import('../agent-context-builder.js');
const { existsSync } = await import('node:fs');
const { readFile, readdir, mkdir, appendFile, writeFile, stat } = await import('node:fs/promises');

// --- Helpers ---

function createProfile(overrides?: Partial<AgentProfile>): AgentProfile {
  return {
    id: 'agent-1',
    name: 'TestAgent',
    runtime: 'claude-code',
    color: '#FF0000',
    voice: { ttsVoiceId: 'voice-1' },
    cwd: '/workspace/agent-1',
    systemPrompt: 'You are a helpful agent.',
    ...overrides,
  };
}

function makeEntry(role: 'user' | 'agent', content: string, timestamp: string, opts?: { hidden?: boolean; source?: 'text' | 'voice' }): object {
  return { timestamp, role, content, ...opts };
}

function jsonlContent(...entries: object[]): string {
  return entries.map(e => JSON.stringify(e)).join('\n') + '\n';
}

// --- Tests ---

describe('AgentContextBuilder', () => {
  let builder: InstanceType<typeof AgentContextBuilder>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-25T10:30:00Z'));
    builder = new AgentContextBuilder();

    // Default: stat returns a valid directory with mtime
    vi.mocked(stat).mockResolvedValue({ mtimeMs: 1000 } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ===================================================================
  // buildContext()
  // ===================================================================
  describe('buildContext()', () => {
    it('returns unmodified profile when cwd is missing', async () => {
      const profile = createProfile({ cwd: undefined });
      const result = await builder.buildContext(profile, 'hello');
      expect(result).toBe(profile);
    });

    it('returns unmodified profile when cwd is empty string', async () => {
      const profile = createProfile({ cwd: '' });
      const result = await builder.buildContext(profile, 'hello');
      expect(result).toBe(profile);
    });

    it('builds enriched profile with identity section', async () => {
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(readdir).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(stat).mockResolvedValue(null as any);

      const profile = createProfile();
      const result = await builder.buildContext(profile, 'hello');

      expect(result).not.toBe(profile);
      expect(result.systemPrompt).toContain('Your name is TestAgent');
      expect(result.systemPrompt).toContain('respond as TestAgent');
    });

    it('includes workspace directory in system prompt', async () => {
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(readdir).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(stat).mockResolvedValue(null as any);

      const profile = createProfile({ cwd: '/my/workspace' });
      const result = await builder.buildContext(profile, 'hello');

      expect(result.systemPrompt).toContain('/my/workspace');
      expect(result.systemPrompt).toContain('All files you create should be placed in this directory');
    });

    it('includes SOUL.md content in system prompt', async () => {
      vi.mocked(readFile).mockImplementation(async (path: any) => {
        if (String(path).endsWith('SOUL.md')) return '# TestAgent Soul\nI am a creative agent.';
        throw new Error('ENOENT');
      });
      vi.mocked(readdir).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(stat).mockResolvedValue(null as any);

      const profile = createProfile();
      const result = await builder.buildContext(profile, 'hello');

      expect(result.systemPrompt).toContain('--- YOUR SOUL ---');
      expect(result.systemPrompt).toContain('I am a creative agent.');
      expect(result.systemPrompt).toContain('--- END SOUL ---');
    });

    it('includes conversation history in system prompt', async () => {
      const entries = [
        makeEntry('user', 'Hi there', '2026-02-25T09:00:00Z'),
        makeEntry('agent', 'Hello! How can I help?', '2026-02-25T09:01:00Z'),
      ];

      vi.mocked(readFile).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p.endsWith('SOUL.md')) throw new Error('ENOENT');
        if (p.endsWith('.jsonl')) return jsonlContent(...entries);
        throw new Error('ENOENT');
      });
      vi.mocked(readdir).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p.includes('conversations')) return ['2026-02-25.jsonl'] as any;
        if (p.includes('skills')) return [] as any;
        throw new Error('ENOENT');
      });
      vi.mocked(stat).mockResolvedValue(null as any);

      const profile = createProfile();
      const result = await builder.buildContext(profile, 'hello');

      expect(result.systemPrompt).toContain('--- RECENT CONVERSATION HISTORY ---');
      expect(result.systemPrompt).toContain('User: Hi there');
      expect(result.systemPrompt).toContain('You: Hello! How can I help?');
      expect(result.systemPrompt).toContain('--- END HISTORY ---');
    });

    it('includes matched skills in system prompt', async () => {
      const skillContent = [
        '---',
        'name: deploy-skill',
        'description: How to deploy',
        'triggers: deploy, release',
        '---',
        'Run deploy.sh in the root directory.',
      ].join('\n');

      vi.mocked(readFile).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p.endsWith('SOUL.md')) throw new Error('ENOENT');
        if (p.endsWith('.md')) return skillContent;
        throw new Error('ENOENT');
      });
      vi.mocked(readdir).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p.includes('conversations')) throw new Error('ENOENT');
        if (p.includes('skills')) return ['deploy.md'] as any;
        return [] as any;
      });
      vi.mocked(stat).mockResolvedValue({ mtimeMs: 1000 } as any);

      const profile = createProfile();
      const result = await builder.buildContext(profile, 'please deploy the app');

      expect(result.systemPrompt).toContain('--- RELEVANT SKILLS ---');
      expect(result.systemPrompt).toContain('### Skill: deploy-skill');
      expect(result.systemPrompt).toContain('How to deploy');
      expect(result.systemPrompt).toContain('Run deploy.sh in the root directory.');
      expect(result.systemPrompt).toContain('--- END SKILLS ---');
    });

    it('always includes skill & memory system instructions', async () => {
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(readdir).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(stat).mockResolvedValue(null as any);

      const profile = createProfile();
      const result = await builder.buildContext(profile, 'hello');

      expect(result.systemPrompt).toContain('--- SKILL & MEMORY SYSTEM ---');
      expect(result.systemPrompt).toContain('Skills are automatically loaded when');
      expect(result.systemPrompt).toContain('--- END SKILL & MEMORY SYSTEM ---');
    });

    it('truncates system prompt when exceeding MAX_SYSTEM_PROMPT_LENGTH', async () => {
      const hugeSoul = 'X'.repeat(15_000);
      vi.mocked(readFile).mockImplementation(async (path: any) => {
        if (String(path).endsWith('SOUL.md')) return hugeSoul;
        throw new Error('ENOENT');
      });
      vi.mocked(readdir).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(stat).mockResolvedValue(null as any);

      const profile = createProfile();
      const result = await builder.buildContext(profile, 'hello');

      expect(result.systemPrompt!.length).toBeLessThanOrEqual(12_000);
      expect(result.systemPrompt).toContain('... (context truncated) ...');
    });

    it('preserves head (identity) and tail (instructions) when truncating', async () => {
      const hugeSoul = 'S'.repeat(15_000);
      vi.mocked(readFile).mockImplementation(async (path: any) => {
        if (String(path).endsWith('SOUL.md')) return hugeSoul;
        throw new Error('ENOENT');
      });
      vi.mocked(readdir).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(stat).mockResolvedValue(null as any);

      const profile = createProfile();
      const result = await builder.buildContext(profile, 'hello');

      // Head should contain identity
      expect(result.systemPrompt).toContain('Your name is TestAgent');
      // Tail should contain skill system instructions
      expect(result.systemPrompt).toContain('--- END SKILL & MEMORY SYSTEM ---');
    });

    it('content truncation is exactly 300 chars per history entry', async () => {
      const longContent = 'A'.repeat(500);
      const entries = [makeEntry('user', longContent, '2026-02-25T09:00:00Z')];

      vi.mocked(readFile).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p.endsWith('SOUL.md')) throw new Error('ENOENT');
        if (p.endsWith('.jsonl')) return jsonlContent(...entries);
        throw new Error('ENOENT');
      });
      vi.mocked(readdir).mockImplementation(async (path: any) => {
        if (String(path).includes('conversations')) return ['2026-02-25.jsonl'] as any;
        throw new Error('ENOENT');
      });
      vi.mocked(stat).mockResolvedValue(null as any);

      const profile = createProfile();
      const result = await builder.buildContext(profile, 'hello');

      expect(result.systemPrompt).toContain('A'.repeat(300));
      expect(result.systemPrompt).not.toContain('A'.repeat(301));
    });
  });

  // ===================================================================
  // recordConversation()
  // ===================================================================
  describe('recordConversation()', () => {
    it('creates conversation directory if missing', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(appendFile).mockResolvedValue(undefined);

      await builder.recordConversation('/workspace/agent-1', {
        timestamp: '2026-02-25T10:30:00Z',
        role: 'user',
        content: 'Hello',
      });

      expect(mkdir).toHaveBeenCalledWith('/workspace/agent-1/conversations', { recursive: true });
    });

    it('appends JSONL entry to today\'s file', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(appendFile).mockResolvedValue(undefined);

      const entry = {
        timestamp: '2026-02-25T10:30:00Z',
        role: 'user' as const,
        content: 'Hello world',
      };

      await builder.recordConversation('/workspace/agent-1', entry);

      expect(appendFile).toHaveBeenCalledWith(
        '/workspace/agent-1/conversations/2026-02-25.jsonl',
        JSON.stringify(entry) + '\n',
        'utf-8',
      );
    });

    it('uses correct date format for filename (YYYY-MM-DD)', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(appendFile).mockResolvedValue(undefined);

      vi.setSystemTime(new Date('2026-12-31T23:59:59Z'));

      await builder.recordConversation('/workspace', {
        timestamp: '2026-12-31T23:59:59Z',
        role: 'agent',
        content: 'Goodbye',
      });

      expect(appendFile).toHaveBeenCalledWith(
        expect.stringContaining('2026-12-31.jsonl'),
        expect.any(String),
        'utf-8',
      );
    });

    it('persists hidden entries', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(appendFile).mockResolvedValue(undefined);

      const entry = {
        timestamp: '2026-02-25T10:30:00Z',
        role: 'agent' as const,
        content: 'task trigger',
        hidden: true,
      };

      await builder.recordConversation('/workspace', entry);

      const writtenLine = vi.mocked(appendFile).mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenLine.trim());
      expect(parsed.hidden).toBe(true);
    });
  });

  // ===================================================================
  // loadPaginatedConversations()
  // ===================================================================
  describe('loadPaginatedConversations()', () => {
    it('returns entries in chronological order', async () => {
      const entries = [
        makeEntry('user', 'First', '2026-02-25T09:00:00Z'),
        makeEntry('agent', 'Second', '2026-02-25T09:01:00Z'),
        makeEntry('user', 'Third', '2026-02-25T09:02:00Z'),
      ];

      vi.mocked(readdir).mockResolvedValue(['2026-02-25.jsonl'] as any);
      vi.mocked(readFile).mockResolvedValue(jsonlContent(...entries));

      const result = await builder.loadPaginatedConversations('/workspace', { limit: 10 });

      expect(result.entries).toHaveLength(3);
      expect(result.entries[0].content).toBe('First');
      expect(result.entries[1].content).toBe('Second');
      expect(result.entries[2].content).toBe('Third');
    });

    it('respects limit parameter', async () => {
      const entries = [
        makeEntry('user', 'One', '2026-02-25T09:00:00Z'),
        makeEntry('agent', 'Two', '2026-02-25T09:01:00Z'),
        makeEntry('user', 'Three', '2026-02-25T09:02:00Z'),
        makeEntry('agent', 'Four', '2026-02-25T09:03:00Z'),
        makeEntry('user', 'Five', '2026-02-25T09:04:00Z'),
      ];

      vi.mocked(readdir).mockResolvedValue(['2026-02-25.jsonl'] as any);
      vi.mocked(readFile).mockResolvedValue(jsonlContent(...entries));

      const result = await builder.loadPaginatedConversations('/workspace', { limit: 2 });

      expect(result.entries).toHaveLength(2);
      // Should be the most recent 2 entries
      expect(result.entries[0].content).toBe('Four');
      expect(result.entries[1].content).toBe('Five');
    });

    it('sets hasMore flag when more entries exist beyond limit', async () => {
      const entries = [
        makeEntry('user', 'One', '2026-02-25T09:00:00Z'),
        makeEntry('agent', 'Two', '2026-02-25T09:01:00Z'),
        makeEntry('user', 'Three', '2026-02-25T09:02:00Z'),
      ];

      vi.mocked(readdir).mockResolvedValue(['2026-02-25.jsonl'] as any);
      vi.mocked(readFile).mockResolvedValue(jsonlContent(...entries));

      const result = await builder.loadPaginatedConversations('/workspace', { limit: 2 });
      expect(result.hasMore).toBe(true);
    });

    it('sets hasMore to false when all entries fit within limit', async () => {
      const entries = [
        makeEntry('user', 'One', '2026-02-25T09:00:00Z'),
        makeEntry('agent', 'Two', '2026-02-25T09:01:00Z'),
      ];

      vi.mocked(readdir).mockResolvedValue(['2026-02-25.jsonl'] as any);
      vi.mocked(readFile).mockResolvedValue(jsonlContent(...entries));

      const result = await builder.loadPaginatedConversations('/workspace', { limit: 5 });
      expect(result.hasMore).toBe(false);
    });

    it('stops reading files once 3x limit entries are collected (lazy loading)', async () => {
      const day1Entries = Array.from({ length: 7 }, (_, i) =>
        makeEntry('user', `Day1-${i}`, `2026-02-23T0${i}:00:00Z`),
      );
      const day2Entries = Array.from({ length: 7 }, (_, i) =>
        makeEntry('user', `Day2-${i}`, `2026-02-24T0${i}:00:00Z`),
      );
      const day3Entries = Array.from({ length: 7 }, (_, i) =>
        makeEntry('user', `Day3-${i}`, `2026-02-25T0${i}:00:00Z`),
      );

      vi.mocked(readdir).mockResolvedValue([
        '2026-02-23.jsonl',
        '2026-02-24.jsonl',
        '2026-02-25.jsonl',
      ] as any);

      vi.mocked(readFile).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p.includes('2026-02-25')) return jsonlContent(...day3Entries);
        if (p.includes('2026-02-24')) return jsonlContent(...day2Entries);
        if (p.includes('2026-02-23')) return jsonlContent(...day1Entries);
        throw new Error('ENOENT');
      });

      // limit=3 -> readTarget = 9, day3 has 7, day2 has 7 => after day3+day2 = 14 >= 9, stop
      const result = await builder.loadPaginatedConversations('/workspace', { limit: 3 });

      // readFile should be called for day3 first (newest, sorted reverse), then day2
      // but NOT day1, because 14 >= 9 (3*3)
      expect(readFile).toHaveBeenCalledTimes(2);
      expect(readFile).toHaveBeenCalledWith(expect.stringContaining('2026-02-25'), 'utf-8');
      expect(readFile).toHaveBeenCalledWith(expect.stringContaining('2026-02-24'), 'utf-8');
      expect(readFile).not.toHaveBeenCalledWith(expect.stringContaining('2026-02-23'), 'utf-8');
    });

    it('filters entries by before cursor', async () => {
      const entries = [
        makeEntry('user', 'Early', '2026-02-25T08:00:00Z'),
        makeEntry('agent', 'Mid', '2026-02-25T09:00:00Z'),
        makeEntry('user', 'Late', '2026-02-25T10:00:00Z'),
      ];

      vi.mocked(readdir).mockResolvedValue(['2026-02-25.jsonl'] as any);
      vi.mocked(readFile).mockResolvedValue(jsonlContent(...entries));

      const result = await builder.loadPaginatedConversations('/workspace', {
        limit: 10,
        before: '2026-02-25T09:30:00Z',
      });

      // Only entries with timestamp < before
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].content).toBe('Early');
      expect(result.entries[1].content).toBe('Mid');
    });

    it('handles missing directory gracefully', async () => {
      vi.mocked(readdir).mockRejectedValue(new Error('ENOENT'));

      const result = await builder.loadPaginatedConversations('/nonexistent', { limit: 10 });

      expect(result.entries).toHaveLength(0);
      expect(result.hasMore).toBe(false);
    });

    it('excludes hidden entries from results', async () => {
      const entries = [
        makeEntry('user', 'Visible', '2026-02-25T09:00:00Z'),
        makeEntry('agent', 'Hidden task', '2026-02-25T09:01:00Z', { hidden: true }),
        makeEntry('agent', 'Also visible', '2026-02-25T09:02:00Z'),
      ];

      vi.mocked(readdir).mockResolvedValue(['2026-02-25.jsonl'] as any);
      vi.mocked(readFile).mockResolvedValue(jsonlContent(...entries));

      const result = await builder.loadPaginatedConversations('/workspace', { limit: 10 });

      expect(result.entries).toHaveLength(2);
      expect(result.entries.every(e => !e.hidden)).toBe(true);
    });

    it('sorts user before agent for identical timestamps (tiebreaker)', async () => {
      const entries = [
        makeEntry('agent', 'Response', '2026-02-25T09:00:00Z'),
        makeEntry('user', 'Question', '2026-02-25T09:00:00Z'),
      ];

      vi.mocked(readdir).mockResolvedValue(['2026-02-25.jsonl'] as any);
      vi.mocked(readFile).mockResolvedValue(jsonlContent(...entries));

      const result = await builder.loadPaginatedConversations('/workspace', { limit: 10 });

      expect(result.entries[0].role).toBe('user');
      expect(result.entries[1].role).toBe('agent');
    });

    it('handles multiple jsonl files across days', async () => {
      const day1 = [makeEntry('user', 'Day1', '2026-02-24T12:00:00Z')];
      const day2 = [makeEntry('user', 'Day2', '2026-02-25T12:00:00Z')];

      vi.mocked(readdir).mockResolvedValue(['2026-02-24.jsonl', '2026-02-25.jsonl'] as any);
      vi.mocked(readFile).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p.includes('2026-02-24')) return jsonlContent(...day1);
        if (p.includes('2026-02-25')) return jsonlContent(...day2);
        throw new Error('ENOENT');
      });

      const result = await builder.loadPaginatedConversations('/workspace', { limit: 10 });

      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].content).toBe('Day1');
      expect(result.entries[1].content).toBe('Day2');
    });

    it('skips malformed JSON lines', async () => {
      const validEntry = makeEntry('user', 'Valid', '2026-02-25T09:00:00Z');
      const rawContent = JSON.stringify(validEntry) + '\n' + 'not-json\n' + JSON.stringify(makeEntry('agent', 'Also valid', '2026-02-25T09:01:00Z')) + '\n';

      vi.mocked(readdir).mockResolvedValue(['2026-02-25.jsonl'] as any);
      vi.mocked(readFile).mockResolvedValue(rawContent);

      const result = await builder.loadPaginatedConversations('/workspace', { limit: 10 });

      expect(result.entries).toHaveLength(2);
    });

    it('ignores non-jsonl files in directory', async () => {
      vi.mocked(readdir).mockResolvedValue(['notes.txt', '2026-02-25.jsonl', 'readme.md'] as any);
      vi.mocked(readFile).mockResolvedValue(jsonlContent(makeEntry('user', 'Hello', '2026-02-25T09:00:00Z')));

      const result = await builder.loadPaginatedConversations('/workspace', { limit: 10 });

      // readFile should only be called for the .jsonl file
      expect(readFile).toHaveBeenCalledTimes(1);
      expect(result.entries).toHaveLength(1);
    });
  });

  // ===================================================================
  // loadRecentConversations() (tested via buildContext)
  // ===================================================================
  describe('loadRecentConversations (via buildContext)', () => {
    it('reads files newest-first and stops when limit reached', async () => {
      const day1Entries = Array.from({ length: 15 }, (_, i) =>
        makeEntry('user', `Day1-${i}`, `2026-02-23T${String(i).padStart(2, '0')}:00:00Z`),
      );
      const day2Entries = Array.from({ length: 15 }, (_, i) =>
        makeEntry('user', `Day2-${i}`, `2026-02-24T${String(i).padStart(2, '0')}:00:00Z`),
      );
      const day3Entries = Array.from({ length: 15 }, (_, i) =>
        makeEntry('user', `Day3-${i}`, `2026-02-25T${String(i).padStart(2, '0')}:00:00Z`),
      );

      vi.mocked(readFile).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p.endsWith('SOUL.md')) throw new Error('ENOENT');
        if (p.includes('2026-02-25')) return jsonlContent(...day3Entries);
        if (p.includes('2026-02-24')) return jsonlContent(...day2Entries);
        if (p.includes('2026-02-23')) return jsonlContent(...day1Entries);
        throw new Error('ENOENT');
      });
      vi.mocked(readdir).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p.includes('conversations')) {
          return ['2026-02-23.jsonl', '2026-02-24.jsonl', '2026-02-25.jsonl'] as any;
        }
        throw new Error('ENOENT');
      });
      vi.mocked(stat).mockResolvedValue(null as any);

      const profile = createProfile();
      const result = await builder.buildContext(profile, 'hello');

      expect(result.systemPrompt).toContain('--- RECENT CONVERSATION HISTORY ---');
      expect(result.systemPrompt).toContain('Day3-0');
    });

    it('returns entries in chronological order in the system prompt', async () => {
      const entries = [
        makeEntry('user', 'First message', '2026-02-25T08:00:00Z'),
        makeEntry('agent', 'Second message', '2026-02-25T09:00:00Z'),
        makeEntry('user', 'Third message', '2026-02-25T10:00:00Z'),
      ];

      vi.mocked(readFile).mockImplementation(async (path: any) => {
        if (String(path).endsWith('SOUL.md')) throw new Error('ENOENT');
        if (String(path).endsWith('.jsonl')) return jsonlContent(...entries);
        throw new Error('ENOENT');
      });
      vi.mocked(readdir).mockImplementation(async (path: any) => {
        if (String(path).includes('conversations')) return ['2026-02-25.jsonl'] as any;
        throw new Error('ENOENT');
      });
      vi.mocked(stat).mockResolvedValue(null as any);

      const profile = createProfile();
      const result = await builder.buildContext(profile, 'hello');

      const prompt = result.systemPrompt!;
      const firstIdx = prompt.indexOf('First message');
      const secondIdx = prompt.indexOf('Second message');
      const thirdIdx = prompt.indexOf('Third message');

      expect(firstIdx).toBeLessThan(secondIdx);
      expect(secondIdx).toBeLessThan(thirdIdx);
    });
  });

  // ===================================================================
  // Skills matching
  // ===================================================================
  describe('skills matching', () => {
    const deploySkill = [
      '---',
      'name: deploy',
      'description: Deploy the app',
      'triggers: deploy, release, ship',
      '---',
      'Run the deploy script.',
    ].join('\n');

    const testSkill = [
      '---',
      'name: test-runner',
      'description: Run tests',
      'triggers: test, spec',
      '---',
      'Execute vitest.',
    ].join('\n');

    it('matches skills by trigger keywords (case-insensitive)', async () => {
      vi.mocked(readFile).mockImplementation(async (path: any) => {
        if (String(path).endsWith('SOUL.md')) throw new Error('ENOENT');
        if (String(path).endsWith('deploy.md')) return deploySkill;
        throw new Error('ENOENT');
      });
      vi.mocked(readdir).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p.includes('conversations')) throw new Error('ENOENT');
        if (p.includes('skills')) return ['deploy.md'] as any;
        return [] as any;
      });
      vi.mocked(stat).mockResolvedValue({ mtimeMs: 1000 } as any);

      const profile = createProfile();
      const result = await builder.buildContext(profile, 'Please DEPLOY the application');
      expect(result.systemPrompt).toContain('### Skill: deploy');
    });

    it('does not match skills when no triggers match', async () => {
      vi.mocked(readFile).mockImplementation(async (path: any) => {
        if (String(path).endsWith('SOUL.md')) throw new Error('ENOENT');
        if (String(path).endsWith('deploy.md')) return deploySkill;
        throw new Error('ENOENT');
      });
      vi.mocked(readdir).mockImplementation(async (path: any) => {
        if (String(path).includes('conversations')) throw new Error('ENOENT');
        if (String(path).includes('skills')) return ['deploy.md'] as any;
        return [] as any;
      });
      vi.mocked(stat).mockResolvedValue({ mtimeMs: 1000 } as any);

      const profile = createProfile();
      const result = await builder.buildContext(profile, 'write a poem about cats');
      expect(result.systemPrompt).not.toContain('### Skill: deploy');
      expect(result.systemPrompt).not.toContain('--- RELEVANT SKILLS ---');
    });

    it('agent-specific skills override shared skills with same name', async () => {
      // Test the override logic: when agent and shared both have a skill with
      // the same name, the agent-specific one should win.
      // NOTE: loadSkillsFromDir calls are sequential to avoid a vitest quirk
      // where concurrent dynamic import() of a mocked node: module can return
      // the real module for the second caller in Promise.all.
      const agentDeploy = [
        '---',
        'name: deploy',
        'description: Agent-specific deploy',
        'triggers: deploy',
        '---',
        'Agent deploy instructions.',
      ].join('\n');

      const sharedDeploy = [
        '---',
        'name: deploy',
        'description: Shared deploy',
        'triggers: deploy',
        '---',
        'Shared deploy instructions.',
      ].join('\n');

      builder.setSharedSkillsDir('/shared/skills');

      vi.mocked(readFile).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p.includes('/shared/skills/') && p.endsWith('deploy.md')) return sharedDeploy;
        if (p.endsWith('deploy.md')) return agentDeploy;
        throw new Error('ENOENT');
      });
      vi.mocked(readdir).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p === '/shared/skills') return ['deploy.md'] as any;
        if (p.includes('skills')) return ['deploy.md'] as any;
        return [] as any;
      });
      vi.mocked(stat).mockResolvedValue({ mtimeMs: 1000 } as any);

      // Load both sequentially, then verify the merge logic
      const agentSkills = await (builder as any).loadSkillsFromDir('/workspace/agent-1/skills');
      const sharedSkills = await (builder as any).loadSkillsFromDir('/shared/skills');

      // Replicate the merge logic from matchSkills
      const agentNames = new Set(agentSkills.map((s: any) => s.name));
      const merged = [...agentSkills, ...sharedSkills.filter((s: any) => !agentNames.has(s.name))];

      // Both dirs have 'deploy', but agent should override shared
      expect(merged).toHaveLength(1);
      expect(merged[0].description).toBe('Agent-specific deploy');
    });

    it('loads from both agent skills dir and shared skills dir', async () => {
      // Test that skills from both agent dir and shared dir are loaded and merged.
      // Sequential calls to avoid vitest concurrent dynamic import limitation.
      const sharedLint = [
        '---',
        'name: lint',
        'description: Run linter',
        'triggers: lint',
        '---',
        'Run eslint.',
      ].join('\n');

      builder.setSharedSkillsDir('/shared/skills');

      vi.mocked(readFile).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p.includes('/shared/skills/') && p.endsWith('lint.md')) return sharedLint;
        if (p.endsWith('deploy.md')) return deploySkill;
        throw new Error('ENOENT');
      });
      vi.mocked(readdir).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p === '/shared/skills') return ['lint.md'] as any;
        if (p.includes('skills')) return ['deploy.md'] as any;
        return [] as any;
      });
      vi.mocked(stat).mockResolvedValue({ mtimeMs: 1000 } as any);

      // Load both dirs sequentially
      const agentSkills = await (builder as any).loadSkillsFromDir('/workspace/agent-1/skills');
      const sharedSkills = await (builder as any).loadSkillsFromDir('/shared/skills');

      expect(agentSkills).toHaveLength(1);
      expect(agentSkills[0].name).toBe('deploy');
      expect(sharedSkills).toHaveLength(1);
      expect(sharedSkills[0].name).toBe('lint');

      // Verify the merge: unique names, no overlap
      const agentNames = new Set(agentSkills.map((s: any) => s.name));
      const merged = [...agentSkills, ...sharedSkills.filter((s: any) => !agentNames.has(s.name))];
      expect(merged).toHaveLength(2);
      expect(merged.map((s: any) => s.name)).toEqual(['deploy', 'lint']);

      // Verify trigger matching against a command
      const lowerCommand = 'deploy and lint the code'.toLowerCase();
      const matched = merged.filter((skill: any) =>
        skill.triggers.some((trigger: string) => lowerCommand.includes(trigger.toLowerCase()))
      );
      expect(matched).toHaveLength(2);
    });

    it('skills file caching: returns cached skills if directory mtime has not changed', async () => {
      vi.mocked(readFile).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p.endsWith('SOUL.md')) throw new Error('ENOENT');
        if (p.endsWith('deploy.md')) return deploySkill;
        throw new Error('ENOENT');
      });
      vi.mocked(readdir).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p.includes('conversations')) throw new Error('ENOENT');
        if (p.includes('skills')) return ['deploy.md'] as any;
        return [] as any;
      });
      vi.mocked(stat).mockResolvedValue({ mtimeMs: 5000 } as any);

      const profile = createProfile();

      // First call: populates cache
      await builder.buildContext(profile, 'deploy');

      // Reset call counts
      vi.mocked(readFile).mockClear();
      vi.mocked(readdir).mockClear();

      // Re-setup non-skills mocks after clear
      vi.mocked(readFile).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p.endsWith('SOUL.md')) throw new Error('ENOENT');
        if (p.endsWith('deploy.md')) return deploySkill;
        throw new Error('ENOENT');
      });
      vi.mocked(readdir).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p.includes('conversations')) throw new Error('ENOENT');
        if (p.includes('skills')) return ['deploy.md'] as any;
        return [] as any;
      });

      // Second call: same mtime, should use cache
      await builder.buildContext(profile, 'deploy');

      // The .md skill files should not be re-read (served from cache)
      const readFileCalls = vi.mocked(readFile).mock.calls.map(c => String(c[0]));
      const skillFileReads = readFileCalls.filter(p => p.endsWith('deploy.md'));
      expect(skillFileReads).toHaveLength(0);
    });

    it('skills file caching: re-reads when mtime changes', async () => {
      vi.mocked(readFile).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p.endsWith('SOUL.md')) throw new Error('ENOENT');
        if (p.endsWith('deploy.md')) return deploySkill;
        throw new Error('ENOENT');
      });
      vi.mocked(readdir).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p.includes('conversations')) throw new Error('ENOENT');
        if (p.includes('skills')) return ['deploy.md'] as any;
        return [] as any;
      });
      vi.mocked(stat).mockResolvedValue({ mtimeMs: 5000 } as any);

      const profile = createProfile();

      // First call: populates cache
      await builder.buildContext(profile, 'deploy');

      // Change mtime
      vi.mocked(stat).mockResolvedValue({ mtimeMs: 6000 } as any);

      const readFileCalls: string[] = [];
      vi.mocked(readFile).mockImplementation(async (path: any) => {
        const p = String(path);
        readFileCalls.push(p);
        if (p.endsWith('SOUL.md')) throw new Error('ENOENT');
        if (p.endsWith('deploy.md')) return deploySkill;
        throw new Error('ENOENT');
      });
      vi.mocked(readdir).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p.includes('conversations')) throw new Error('ENOENT');
        if (p.includes('skills')) return ['deploy.md'] as any;
        return [] as any;
      });

      // Second call: different mtime, should re-read
      await builder.buildContext(profile, 'deploy');

      const skillFileReads = readFileCalls.filter(p => p.endsWith('deploy.md'));
      expect(skillFileReads).toHaveLength(1);
    });
  });

  // ===================================================================
  // parseSkillFile() (tested via loadSkillsFromDir)
  // ===================================================================
  describe('parseSkillFile (via skills loading)', () => {
    it('parses frontmatter with name, description, and triggers plus body', async () => {
      const skill = [
        '---',
        'name: my-skill',
        'description: A great skill',
        'triggers: foo, bar, baz',
        '---',
        'Do the thing.\nWith multiple lines.',
      ].join('\n');

      vi.mocked(readFile).mockImplementation(async (path: any) => {
        if (String(path).endsWith('.md')) return skill;
        throw new Error('ENOENT');
      });
      vi.mocked(readdir).mockResolvedValue(['skill.md'] as any);
      vi.mocked(stat).mockResolvedValue({ mtimeMs: 1000 } as any);

      const skills = await (builder as any).loadSkillsFromDir('/test/skills');

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('my-skill');
      expect(skills[0].description).toBe('A great skill');
      expect(skills[0].triggers).toEqual(['foo', 'bar', 'baz']);
      expect(skills[0].body).toBe('Do the thing.\nWith multiple lines.');
    });

    it('returns null for invalid format (no frontmatter) - skill is ignored', async () => {
      const invalidSkill = 'Just some text without frontmatter.';

      vi.mocked(readFile).mockImplementation(async (path: any) => {
        if (String(path).endsWith('.md')) return invalidSkill;
        throw new Error('ENOENT');
      });
      vi.mocked(readdir).mockResolvedValue(['bad-skill.md'] as any);
      vi.mocked(stat).mockResolvedValue({ mtimeMs: 1000 } as any);

      const skills = await (builder as any).loadSkillsFromDir('/test/skills');
      expect(skills).toHaveLength(0);
    });

    it('returns null when frontmatter is missing required name field', async () => {
      const noName = [
        '---',
        'description: Missing name',
        'triggers: test',
        '---',
        'Body text.',
      ].join('\n');

      vi.mocked(readFile).mockImplementation(async (path: any) => {
        if (String(path).endsWith('.md')) return noName;
        throw new Error('ENOENT');
      });
      vi.mocked(readdir).mockResolvedValue(['no-name.md'] as any);
      vi.mocked(stat).mockResolvedValue({ mtimeMs: 1000 } as any);

      const skills = await (builder as any).loadSkillsFromDir('/test/skills');
      expect(skills).toHaveLength(0);
    });

    it('returns null when frontmatter is missing required triggers field', async () => {
      const noTriggers = [
        '---',
        'name: incomplete-skill',
        'description: No triggers',
        '---',
        'Body text.',
      ].join('\n');

      vi.mocked(readFile).mockImplementation(async (path: any) => {
        if (String(path).endsWith('.md')) return noTriggers;
        throw new Error('ENOENT');
      });
      vi.mocked(readdir).mockResolvedValue(['no-triggers.md'] as any);
      vi.mocked(stat).mockResolvedValue({ mtimeMs: 1000 } as any);

      const skills = await (builder as any).loadSkillsFromDir('/test/skills');
      expect(skills).toHaveLength(0);
    });

    it('handles multiple triggers separated by commas', async () => {
      const skill = [
        '---',
        'name: multi-trigger',
        'description: Has many triggers',
        'triggers: alpha, beta, gamma, delta',
        '---',
        'Multi trigger body.',
      ].join('\n');

      vi.mocked(readFile).mockImplementation(async (path: any) => {
        if (String(path).endsWith('.md')) return skill;
        throw new Error('ENOENT');
      });
      vi.mocked(readdir).mockResolvedValue(['multi.md'] as any);
      vi.mocked(stat).mockResolvedValue({ mtimeMs: 1000 } as any);

      const skills = await (builder as any).loadSkillsFromDir('/test/skills');

      expect(skills).toHaveLength(1);
      expect(skills[0].triggers).toEqual(['alpha', 'beta', 'gamma', 'delta']);
    });

    it('skill description is optional', async () => {
      const skill = [
        '---',
        'name: no-desc',
        'triggers: nodesc',
        '---',
        'Body only.',
      ].join('\n');

      vi.mocked(readFile).mockImplementation(async (path: any) => {
        if (String(path).endsWith('.md')) return skill;
        throw new Error('ENOENT');
      });
      vi.mocked(readdir).mockResolvedValue(['nodesc.md'] as any);
      vi.mocked(stat).mockResolvedValue({ mtimeMs: 1000 } as any);

      const skills = await (builder as any).loadSkillsFromDir('/test/skills');

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('no-desc');
      expect(skills[0].description).toBe('');
      expect(skills[0].body).toBe('Body only.');
    });
  });

  // ===================================================================
  // initializeSoul()
  // ===================================================================
  describe('initializeSoul()', () => {
    it('creates SOUL.md from profile when it does not exist', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const profile = createProfile({ name: 'Claude', systemPrompt: 'Be helpful.' });
      await builder.initializeSoul('/workspace/claude', profile);

      expect(mkdir).toHaveBeenCalledWith('/workspace/claude', { recursive: true });
      expect(writeFile).toHaveBeenCalledWith(
        '/workspace/claude/SOUL.md',
        expect.any(String),
        'utf-8',
      );

      const content = vi.mocked(writeFile).mock.calls[0][1] as string;
      expect(content).toContain('# Claude');
      expect(content).toContain('You are Claude.');
      expect(content).toContain('## Core Directives');
      expect(content).toContain('Be helpful.');
      expect(content).toContain('## Personality');
      expect(content).toContain('## Notes');
    });

    it('skips creation if SOUL.md already exists', async () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const profile = createProfile();
      await builder.initializeSoul('/workspace', profile);

      expect(mkdir).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
    });

    it('omits Core Directives section when profile has no systemPrompt', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const profile = createProfile({ systemPrompt: undefined });
      await builder.initializeSoul('/workspace', profile);

      const content = vi.mocked(writeFile).mock.calls[0][1] as string;
      expect(content).toContain('# TestAgent');
      expect(content).toContain('You are TestAgent.');
      expect(content).not.toContain('## Core Directives');
    });
  });

  // ===================================================================
  // initializeSkillsDir()
  // ===================================================================
  describe('initializeSkillsDir()', () => {
    it('creates skills directory with recursive flag', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);

      await builder.initializeSkillsDir('/workspace/agent-1');

      expect(mkdir).toHaveBeenCalledWith('/workspace/agent-1/skills', { recursive: true });
    });
  });

  // ===================================================================
  // setSharedSkillsDir()
  // ===================================================================
  describe('setSharedSkillsDir()', () => {
    it('sets the shared skills directory used for skill loading', async () => {
      const sharedSkill = [
        '---',
        'name: shared-only',
        'description: Only in shared',
        'triggers: shared',
        '---',
        'Shared body.',
      ].join('\n');

      builder.setSharedSkillsDir('/common/skills');

      vi.mocked(readFile).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p.includes('/common/skills/') && p.endsWith('.md')) return sharedSkill;
        throw new Error('ENOENT');
      });
      vi.mocked(readdir).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p === '/common/skills') return ['shared.md'] as any;
        return [] as any;
      });
      vi.mocked(stat).mockResolvedValue({ mtimeMs: 1000 } as any);

      // Verify the shared skills dir is loaded via loadSkillsFromDir
      const skills = await (builder as any).loadSkillsFromDir('/common/skills');
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('shared-only');
      expect(skills[0].triggers).toEqual(['shared']);
      expect(skills[0].body).toBe('Shared body.');
    });

    it('shared skills directory is null by default', async () => {
      // Without calling setSharedSkillsDir, no shared skills should load
      vi.mocked(readFile).mockImplementation(async (path: any) => {
        if (String(path).endsWith('SOUL.md')) throw new Error('ENOENT');
        throw new Error('ENOENT');
      });
      vi.mocked(readdir).mockImplementation(async (path: any) => {
        if (String(path).includes('conversations')) throw new Error('ENOENT');
        if (String(path).includes('skills')) return [] as any;
        return [] as any;
      });
      vi.mocked(stat).mockResolvedValue({ mtimeMs: 1000 } as any);

      const profile = createProfile();
      const result = await builder.buildContext(profile, 'anything');

      // Should not throw and should not include any shared skills
      expect(result.systemPrompt).toBeDefined();
      expect(result.systemPrompt).not.toContain('--- RELEVANT SKILLS ---');
    });
  });

  // ===================================================================
  // Edge cases
  // ===================================================================
  describe('edge cases', () => {
    it('handles empty SOUL.md gracefully (no soul section)', async () => {
      vi.mocked(readFile).mockImplementation(async (path: any) => {
        if (String(path).endsWith('SOUL.md')) return '';
        throw new Error('ENOENT');
      });
      vi.mocked(readdir).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(stat).mockResolvedValue(null as any);

      const profile = createProfile();
      const result = await builder.buildContext(profile, 'hello');

      expect(result.systemPrompt).not.toContain('--- YOUR SOUL ---');
    });

    it('handles empty conversation directory', async () => {
      vi.mocked(readFile).mockImplementation(async (path: any) => {
        if (String(path).endsWith('SOUL.md')) throw new Error('ENOENT');
        throw new Error('ENOENT');
      });
      vi.mocked(readdir).mockImplementation(async (path: any) => {
        if (String(path).includes('conversations')) return [] as any;
        throw new Error('ENOENT');
      });
      vi.mocked(stat).mockResolvedValue(null as any);

      const profile = createProfile();
      const result = await builder.buildContext(profile, 'hello');

      expect(result.systemPrompt).not.toContain('--- RECENT CONVERSATION HISTORY ---');
    });

    it('handles unreadable skill files gracefully', async () => {
      vi.mocked(readFile).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p.endsWith('SOUL.md')) throw new Error('ENOENT');
        if (p.endsWith('.md')) throw new Error('EACCES');
        throw new Error('ENOENT');
      });
      vi.mocked(readdir).mockImplementation(async (path: any) => {
        if (String(path).includes('conversations')) throw new Error('ENOENT');
        if (String(path).includes('skills')) return ['broken.md'] as any;
        return [] as any;
      });
      vi.mocked(stat).mockResolvedValue({ mtimeMs: 1000 } as any);

      const profile = createProfile();
      const result = await builder.buildContext(profile, 'anything');
      expect(result.systemPrompt).toBeDefined();
      expect(result.systemPrompt).not.toContain('--- RELEVANT SKILLS ---');
    });

    it('does not include non-matching skills even if files exist', async () => {
      const skill = [
        '---',
        'name: deploy-skill',
        'description: Deployment',
        'triggers: deploy, release',
        '---',
        'Deploy body.',
      ].join('\n');

      vi.mocked(readFile).mockImplementation(async (path: any) => {
        if (String(path).endsWith('SOUL.md')) throw new Error('ENOENT');
        if (String(path).endsWith('.md')) return skill;
        throw new Error('ENOENT');
      });
      vi.mocked(readdir).mockImplementation(async (path: any) => {
        if (String(path).includes('conversations')) throw new Error('ENOENT');
        if (String(path).includes('skills')) return ['deploy.md'] as any;
        return [] as any;
      });
      vi.mocked(stat).mockResolvedValue({ mtimeMs: 1000 } as any);

      const profile = createProfile();
      const result = await builder.buildContext(profile, 'write a haiku');

      expect(result.systemPrompt).not.toContain('--- RELEVANT SKILLS ---');
      expect(result.systemPrompt).not.toContain('deploy-skill');
    });

    it('preserves all other profile fields when enriching', async () => {
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(readdir).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(stat).mockResolvedValue(null as any);

      const profile = createProfile({
        model: 'claude-opus-4-6',
        color: '#00FF00',
        autoStart: true,
        env: { FOO: 'bar' },
      });
      const result = await builder.buildContext(profile, 'hello');

      expect(result.id).toBe(profile.id);
      expect(result.name).toBe(profile.name);
      expect(result.runtime).toBe(profile.runtime);
      expect(result.model).toBe('claude-opus-4-6');
      expect(result.color).toBe('#00FF00');
      expect(result.autoStart).toBe(true);
      expect(result.env).toEqual({ FOO: 'bar' });
      expect(result.cwd).toBe(profile.cwd);
    });

    it('composes all sections together in correct order', async () => {
      const soulContent = '# My Soul\nI have purpose.';
      const entries = [
        makeEntry('user', 'Hey', '2026-02-25T09:00:00Z'),
      ];
      const skill = [
        '---',
        'name: greet',
        'description: Greeting skill',
        'triggers: hey, hello',
        '---',
        'Greet warmly.',
      ].join('\n');

      vi.mocked(readFile).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p.endsWith('SOUL.md')) return soulContent;
        if (p.endsWith('.jsonl')) return jsonlContent(...entries);
        if (p.endsWith('.md')) return skill;
        throw new Error('ENOENT');
      });
      vi.mocked(readdir).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p.includes('conversations')) return ['2026-02-25.jsonl'] as any;
        if (p.includes('skills')) return ['greet.md'] as any;
        return [] as any;
      });
      vi.mocked(stat).mockResolvedValue({ mtimeMs: 1000 } as any);

      const profile = createProfile();
      const result = await builder.buildContext(profile, 'hey there');
      const prompt = result.systemPrompt!;

      // Verify section order: identity, workspace, soul, history, skills, skill system
      const identityIdx = prompt.indexOf('Your name is TestAgent');
      const workspaceIdx = prompt.indexOf('Your workspace directory is');
      const soulIdx = prompt.indexOf('--- YOUR SOUL ---');
      const historyIdx = prompt.indexOf('--- RECENT CONVERSATION HISTORY ---');
      const skillsIdx = prompt.indexOf('--- RELEVANT SKILLS ---');
      const systemIdx = prompt.indexOf('--- SKILL & MEMORY SYSTEM ---');

      expect(identityIdx).toBeGreaterThanOrEqual(0);
      expect(workspaceIdx).toBeGreaterThan(identityIdx);
      expect(soulIdx).toBeGreaterThan(workspaceIdx);
      expect(historyIdx).toBeGreaterThan(soulIdx);
      expect(skillsIdx).toBeGreaterThan(historyIdx);
      expect(systemIdx).toBeGreaterThan(skillsIdx);
    });

    it('loadSkillsFromDir returns empty array when directory does not exist', async () => {
      vi.mocked(stat).mockResolvedValue(null as any);

      const skills = await (builder as any).loadSkillsFromDir('/nonexistent/dir');
      expect(skills).toEqual([]);
    });
  });
});
