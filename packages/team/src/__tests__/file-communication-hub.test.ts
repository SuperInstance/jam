import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileCommunicationHub } from '../stores/file-communication-hub.js';
import type { IEventBus, Channel, ChannelMessage } from '@jam/core';
import { Events } from '@jam/core';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  appendFile: vi.fn(),
  readdir: vi.fn(),
}));

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid-1234'),
}));

import { readFile, writeFile, mkdir, appendFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const mockedReadFile = vi.mocked(readFile);
const mockedWriteFile = vi.mocked(writeFile);
const mockedMkdir = vi.mocked(mkdir);
const mockedAppendFile = vi.mocked(appendFile);
const mockedReaddir = vi.mocked(readdir);
const mockedRandomUUID = vi.mocked(randomUUID);

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 'channel-1',
    name: 'Test Channel',
    type: 'team',
    participants: ['agent-a', 'agent-b'],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    id: 'msg-1',
    channelId: 'channel-1',
    senderId: 'agent-a',
    content: 'Hello!',
    timestamp: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createMockEventBus(): IEventBus {
  return {
    emit: vi.fn(),
    on: vi.fn(() => () => {}),
    once: vi.fn(),
  };
}

describe('FileCommunicationHub', () => {
  let store: FileCommunicationHub;
  let eventBus: IEventBus;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedReadFile.mockRejectedValue(new Error('ENOENT'));
    mockedWriteFile.mockResolvedValue(undefined);
    mockedMkdir.mockResolvedValue(undefined as any);
    mockedAppendFile.mockResolvedValue(undefined);
    mockedReaddir.mockRejectedValue(new Error('ENOENT'));

    eventBus = createMockEventBus();
    store = new FileCommunicationHub('/tmp/test', eventBus);
  });

  describe('createChannel()', () => {
    it('should generate UUID for the channel', async () => {
      mockedRandomUUID.mockReturnValueOnce('chan-uuid' as any);

      const channel = await store.createChannel('My Channel', 'team', [
        'agent-a',
        'agent-b',
      ]);

      expect(channel.id).toBe('chan-uuid');
    });

    it('should create directory for the channel', async () => {
      mockedRandomUUID.mockReturnValueOnce('chan-dir' as any);

      await store.createChannel('Dir Channel', 'direct', ['a', 'b']);

      expect(mockedMkdir).toHaveBeenCalledWith(
        expect.stringContaining('chan-dir'),
        { recursive: true },
      );
    });

    it('should write meta.json', async () => {
      mockedRandomUUID.mockReturnValueOnce('chan-meta' as any);

      const channel = await store.createChannel('Meta Channel', 'broadcast', [
        'agent-1',
      ]);

      expect(mockedWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('meta.json'),
        expect.any(String),
        'utf-8',
      );

      // Verify meta content
      const written = JSON.parse(mockedWriteFile.mock.calls[0][1] as string);
      expect(written.name).toBe('Meta Channel');
      expect(written.type).toBe('broadcast');
      expect(written.participants).toEqual(['agent-1']);
    });

    it('should return a fully populated channel object', async () => {
      mockedRandomUUID.mockReturnValueOnce('chan-full' as any);

      const channel = await store.createChannel('Full Channel', 'team', [
        'a',
        'b',
        'c',
      ]);

      expect(channel.id).toBe('chan-full');
      expect(channel.name).toBe('Full Channel');
      expect(channel.type).toBe('team');
      expect(channel.participants).toEqual(['a', 'b', 'c']);
      expect(channel.createdAt).toBeDefined();
    });

    it('should make created channel retrievable via getChannel()', async () => {
      // First initialize the channel cache by triggering loadChannels
      mockedReaddir.mockResolvedValueOnce([] as any);
      await store.listChannels();

      // Now create the channel - cache is initialized so it will be added
      mockedRandomUUID.mockReturnValueOnce('chan-retrieve' as any);
      const channel = await store.createChannel('Retrievable', 'team', ['x']);

      const retrieved = await store.getChannel('chan-retrieve');

      expect(retrieved).toEqual(channel);
    });
  });

  describe('getChannel()', () => {
    it('should return channel by ID', async () => {
      const channel = makeChannel({ id: 'existing-chan' });
      mockedReaddir.mockResolvedValueOnce(['existing-chan'] as any);
      mockedReadFile.mockResolvedValueOnce(JSON.stringify(channel));

      const result = await store.getChannel('existing-chan');

      expect(result).toEqual(channel);
    });

    it('should return null for non-existent channel', async () => {
      mockedReaddir.mockResolvedValueOnce([] as any);

      const result = await store.getChannel('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('listChannels()', () => {
    it('should return all channels when no agentId given', async () => {
      const chan1 = makeChannel({ id: 'c1', participants: ['a'] });
      const chan2 = makeChannel({ id: 'c2', participants: ['b'] });

      mockedReaddir.mockResolvedValueOnce(['c1', 'c2'] as any);
      mockedReadFile
        .mockResolvedValueOnce(JSON.stringify(chan1))
        .mockResolvedValueOnce(JSON.stringify(chan2));

      const result = await store.listChannels();

      expect(result).toHaveLength(2);
    });

    it('should filter by participant when agentId provided', async () => {
      const chan1 = makeChannel({ id: 'c1', participants: ['agent-a', 'agent-b'] });
      const chan2 = makeChannel({ id: 'c2', participants: ['agent-c'] });

      mockedReaddir.mockResolvedValueOnce(['c1', 'c2'] as any);
      mockedReadFile
        .mockResolvedValueOnce(JSON.stringify(chan1))
        .mockResolvedValueOnce(JSON.stringify(chan2));

      const result = await store.listChannels('agent-a');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('c1');
    });

    it('should return empty array when no channels exist', async () => {
      mockedReaddir.mockRejectedValueOnce(new Error('ENOENT'));

      const result = await store.listChannels();

      expect(result).toEqual([]);
    });

    it('should skip entries with invalid meta.json', async () => {
      const validChan = makeChannel({ id: 'valid' });

      mockedReaddir.mockResolvedValueOnce(['valid', 'invalid'] as any);
      mockedReadFile
        .mockResolvedValueOnce(JSON.stringify(validChan))
        .mockRejectedValueOnce(new Error('ENOENT'));

      const result = await store.listChannels();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('valid');
    });

    it('should skip dot-prefixed directory entries', async () => {
      const chan = makeChannel({ id: 'visible' });

      mockedReaddir.mockResolvedValueOnce(['.hidden', 'visible'] as any);
      mockedReadFile.mockResolvedValueOnce(JSON.stringify(chan));

      const result = await store.listChannels();

      expect(result).toHaveLength(1);
      // readFile should only be called once (for 'visible', not '.hidden')
      expect(mockedReadFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendMessage()', () => {
    async function setupChannelAndResetMocks(): Promise<void> {
      // Initialize the channel cache first via loadChannels
      mockedReaddir.mockResolvedValueOnce([] as any);
      await store.listChannels();

      // Now create the channel - it will be added to the initialized cache
      mockedRandomUUID.mockReturnValueOnce('msg-chan' as any);
      await store.createChannel('Msg Channel', 'team', ['sender', 'other']);
      vi.clearAllMocks();
      mockedAppendFile.mockResolvedValue(undefined);
    }

    it('should append to messages.jsonl', async () => {
      await setupChannelAndResetMocks();
      mockedRandomUUID.mockReturnValueOnce('msg-id-1' as any);

      await store.sendMessage('msg-chan', 'sender', 'Hello world');

      expect(mockedAppendFile).toHaveBeenCalledWith(
        expect.stringContaining('messages.jsonl'),
        expect.stringContaining('"Hello world"'),
        'utf-8',
      );

      // Verify JSONL format (single line ending with \n)
      const written = mockedAppendFile.mock.calls[0][1] as string;
      expect(written.endsWith('\n')).toBe(true);
      const parsed = JSON.parse(written.trim());
      expect(parsed.content).toBe('Hello world');
      expect(parsed.senderId).toBe('sender');
    });

    it('should emit MESSAGE_RECEIVED event', async () => {
      await setupChannelAndResetMocks();
      mockedRandomUUID.mockReturnValueOnce('msg-event' as any);

      await store.sendMessage('msg-chan', 'sender', 'Event message');

      expect(eventBus.emit).toHaveBeenCalledWith(Events.MESSAGE_RECEIVED, {
        message: expect.objectContaining({
          content: 'Event message',
          senderId: 'sender',
        }),
        channel: expect.objectContaining({
          id: 'msg-chan',
        }),
      });
    });

    it('should throw for non-existent channel', async () => {
      // No channels created; loadChannels returns empty
      mockedReaddir.mockResolvedValueOnce([] as any);

      await expect(
        store.sendMessage('nonexistent', 'sender', 'Hello'),
      ).rejects.toThrow('Channel not found: nonexistent');
    });

    it('should return the created message', async () => {
      await setupChannelAndResetMocks();
      mockedRandomUUID.mockReturnValueOnce('msg-return' as any);

      const msg = await store.sendMessage('msg-chan', 'sender', 'Return me', 'reply-to-id');

      expect(msg.id).toBe('msg-return');
      expect(msg.channelId).toBe('msg-chan');
      expect(msg.senderId).toBe('sender');
      expect(msg.content).toBe('Return me');
      expect(msg.replyTo).toBe('reply-to-id');
      expect(msg.timestamp).toBeDefined();
    });
  });

  describe('getMessages()', () => {
    it('should return messages in reverse chronological order', async () => {
      const messages = [
        makeMessage({ id: 'msg-1', timestamp: '2026-01-01T01:00:00.000Z', content: 'First' }),
        makeMessage({ id: 'msg-2', timestamp: '2026-01-01T02:00:00.000Z', content: 'Second' }),
        makeMessage({ id: 'msg-3', timestamp: '2026-01-01T03:00:00.000Z', content: 'Third' }),
      ];
      const jsonl = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
      mockedReadFile.mockResolvedValueOnce(jsonl);

      const result = await store.getMessages('channel-1');

      expect(result).toHaveLength(3);
      // Reversed order: Third, Second, First
      expect(result[0].content).toBe('Third');
      expect(result[1].content).toBe('Second');
      expect(result[2].content).toBe('First');
    });

    it('should paginate with before cursor', async () => {
      const messages = [
        makeMessage({ id: 'msg-1', content: 'First' }),
        makeMessage({ id: 'msg-2', content: 'Second' }),
        makeMessage({ id: 'msg-3', content: 'Third' }),
        makeMessage({ id: 'msg-4', content: 'Fourth' }),
      ];
      const jsonl = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
      mockedReadFile.mockResolvedValueOnce(jsonl);

      // In reverse order: msg-4, msg-3, msg-2, msg-1
      // 'before' msg-3 means: skip until msg-3, then return from msg-2 onward
      const result = await store.getMessages('channel-1', 50, 'msg-3');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('msg-2');
      expect(result[1].id).toBe('msg-1');
    });

    it('should respect limit', async () => {
      const messages = [
        makeMessage({ id: 'msg-1' }),
        makeMessage({ id: 'msg-2' }),
        makeMessage({ id: 'msg-3' }),
        makeMessage({ id: 'msg-4' }),
        makeMessage({ id: 'msg-5' }),
      ];
      const jsonl = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
      mockedReadFile.mockResolvedValueOnce(jsonl);

      const result = await store.getMessages('channel-1', 2);

      expect(result).toHaveLength(2);
    });

    it('should return empty array when no messages file exists', async () => {
      mockedReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const result = await store.getMessages('empty-channel');

      expect(result).toEqual([]);
    });

    it('should skip malformed lines', async () => {
      const jsonl = [
        JSON.stringify(makeMessage({ id: 'valid-1', content: 'Valid' })),
        'not valid json {{{',
        JSON.stringify(makeMessage({ id: 'valid-2', content: 'Also valid' })),
      ].join('\n') + '\n';
      mockedReadFile.mockResolvedValueOnce(jsonl);

      const result = await store.getMessages('channel-1');

      expect(result).toHaveLength(2);
    });

    it('should handle empty lines gracefully', async () => {
      const jsonl =
        JSON.stringify(makeMessage({ id: 'msg-1' })) +
        '\n\n\n' +
        JSON.stringify(makeMessage({ id: 'msg-2' })) +
        '\n';
      mockedReadFile.mockResolvedValueOnce(jsonl);

      const result = await store.getMessages('channel-1');

      expect(result).toHaveLength(2);
    });

    it('should combine before cursor and limit', async () => {
      const messages = Array.from({ length: 10 }, (_, i) =>
        makeMessage({ id: `msg-${i}`, content: `Message ${i}` }),
      );
      const jsonl = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
      mockedReadFile.mockResolvedValueOnce(jsonl);

      // Reversed: msg-9, msg-8, ..., msg-0
      // before msg-5 means skip msg-9..msg-5, then slice from msg-4 onward
      // With limit 2, get msg-4, msg-3
      const result = await store.getMessages('channel-1', 2, 'msg-5');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('msg-4');
      expect(result[1].id).toBe('msg-3');
    });

    it('should return all messages if before cursor not found', async () => {
      const messages = [
        makeMessage({ id: 'msg-1' }),
        makeMessage({ id: 'msg-2' }),
      ];
      const jsonl = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
      mockedReadFile.mockResolvedValueOnce(jsonl);

      const result = await store.getMessages('channel-1', 50, 'nonexistent-cursor');

      // If cursor not found, idx < 0 so no slicing by before; still returns reversed list with limit
      expect(result).toHaveLength(2);
    });
  });
});
