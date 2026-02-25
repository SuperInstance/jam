import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileRelationshipStore } from '../stores/file-relationship-store.js';
import type { AgentRelationship } from '@jam/core';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

import { readFile, writeFile, mkdir } from 'node:fs/promises';

const mockedReadFile = vi.mocked(readFile);
const mockedWriteFile = vi.mocked(writeFile);
const mockedMkdir = vi.mocked(mkdir);

function makeRelationship(
  overrides: Partial<AgentRelationship> = {},
): AgentRelationship {
  return {
    sourceAgentId: 'agent-a',
    targetAgentId: 'agent-b',
    trustScore: 0.5,
    interactionCount: 0,
    lastInteraction: '2026-01-01T00:00:00.000Z',
    delegationCount: 0,
    delegationSuccessRate: 0,
    notes: [],
    ...overrides,
  };
}

describe('FileRelationshipStore', () => {
  let store: FileRelationshipStore;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedReadFile.mockRejectedValue(new Error('ENOENT'));
    mockedWriteFile.mockResolvedValue(undefined);
    mockedMkdir.mockResolvedValue(undefined as any);
    store = new FileRelationshipStore('/tmp/test');
  });

  describe('get()', () => {
    it('should return a specific relationship', async () => {
      const rel = makeRelationship({
        sourceAgentId: 'src',
        targetAgentId: 'tgt',
        trustScore: 0.8,
      });
      mockedReadFile.mockResolvedValueOnce(JSON.stringify([rel]));

      const result = await store.get('src', 'tgt');

      expect(result).toEqual(rel);
      expect(result!.trustScore).toBe(0.8);
    });

    it('should return null when relationship does not exist', async () => {
      mockedReadFile.mockResolvedValueOnce(JSON.stringify([]));

      const result = await store.get('src', 'nonexistent');

      expect(result).toBeNull();
    });

    it('should return null when file does not exist', async () => {
      mockedReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const result = await store.get('missing-agent', 'other');

      expect(result).toBeNull();
    });

    it('should find the correct relationship among multiple', async () => {
      const rels = [
        makeRelationship({ sourceAgentId: 'src', targetAgentId: 'tgt-1', trustScore: 0.3 }),
        makeRelationship({ sourceAgentId: 'src', targetAgentId: 'tgt-2', trustScore: 0.9 }),
        makeRelationship({ sourceAgentId: 'src', targetAgentId: 'tgt-3', trustScore: 0.1 }),
      ];
      mockedReadFile.mockResolvedValueOnce(JSON.stringify(rels));

      const result = await store.get('src', 'tgt-2');

      expect(result!.trustScore).toBe(0.9);
    });
  });

  describe('set()', () => {
    it('should create a new relationship', async () => {
      mockedReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const rel = makeRelationship({
        sourceAgentId: 'new-src',
        targetAgentId: 'new-tgt',
        trustScore: 0.7,
      });

      await store.set(rel);

      expect(mockedWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('new-src.json'),
        expect.any(String),
        'utf-8',
      );

      // Verify the written data contains the relationship
      const written = JSON.parse(mockedWriteFile.mock.calls[0][1] as string);
      expect(written).toHaveLength(1);
      expect(written[0].targetAgentId).toBe('new-tgt');
      expect(written[0].trustScore).toBe(0.7);
    });

    it('should update existing relationship (matches by targetAgentId)', async () => {
      const existing = makeRelationship({
        sourceAgentId: 'src',
        targetAgentId: 'tgt',
        trustScore: 0.5,
        interactionCount: 3,
      });
      mockedReadFile.mockResolvedValueOnce(JSON.stringify([existing]));

      const updated = makeRelationship({
        sourceAgentId: 'src',
        targetAgentId: 'tgt',
        trustScore: 0.9,
        interactionCount: 10,
      });

      await store.set(updated);

      const written = JSON.parse(mockedWriteFile.mock.calls[0][1] as string);
      expect(written).toHaveLength(1); // No duplicate, replaced in-place
      expect(written[0].trustScore).toBe(0.9);
      expect(written[0].interactionCount).toBe(10);
    });

    it('should add to existing relationships list when target is new', async () => {
      const existing = makeRelationship({
        sourceAgentId: 'src',
        targetAgentId: 'tgt-old',
      });
      mockedReadFile.mockResolvedValueOnce(JSON.stringify([existing]));

      const newRel = makeRelationship({
        sourceAgentId: 'src',
        targetAgentId: 'tgt-new',
      });

      await store.set(newRel);

      const written = JSON.parse(mockedWriteFile.mock.calls[0][1] as string);
      expect(written).toHaveLength(2);
    });
  });

  describe('getAll()', () => {
    it('should return all relationships for an agent', async () => {
      const rels = [
        makeRelationship({ sourceAgentId: 'src', targetAgentId: 'a' }),
        makeRelationship({ sourceAgentId: 'src', targetAgentId: 'b' }),
        makeRelationship({ sourceAgentId: 'src', targetAgentId: 'c' }),
      ];
      mockedReadFile.mockResolvedValueOnce(JSON.stringify(rels));

      const result = await store.getAll('src');

      expect(result).toHaveLength(3);
    });

    it('should return empty array when no relationships exist', async () => {
      mockedReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const result = await store.getAll('lonely-agent');

      expect(result).toEqual([]);
    });
  });

  describe('updateTrust()', () => {
    it('should create new relationship if none exists (starts at 0.5)', async () => {
      mockedReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const result = await store.updateTrust('new-src', 'new-tgt', 'success');

      expect(result.sourceAgentId).toBe('new-src');
      expect(result.targetAgentId).toBe('new-tgt');
      // Trust started at 0.5, then EMA applied
      // alpha = 0.15 * 1.0 = 0.15
      // trust = 0.15 * 1.0 + 0.85 * 0.5 = 0.15 + 0.425 = 0.575
      expect(result.trustScore).toBeCloseTo(0.575, 3);
    });

    it('should apply EMA formula: alpha * outcome + (1 - alpha) * current', async () => {
      const existing = makeRelationship({
        sourceAgentId: 'src',
        targetAgentId: 'tgt',
        trustScore: 0.8,
        interactionCount: 5,
        delegationCount: 3,
        delegationSuccessRate: 0.667,
      });
      mockedReadFile.mockResolvedValueOnce(JSON.stringify([existing]));

      const result = await store.updateTrust('src', 'tgt', 'success');

      // alpha = 0.15 * 1.0 = 0.15
      // trust = 0.15 * 1.0 + 0.85 * 0.8 = 0.15 + 0.68 = 0.83
      expect(result.trustScore).toBeCloseTo(0.83, 2);
    });

    it('should apply EMA formula on failure (outcome = 0)', async () => {
      const existing = makeRelationship({
        sourceAgentId: 'src',
        targetAgentId: 'tgt',
        trustScore: 0.8,
        interactionCount: 5,
        delegationCount: 3,
        delegationSuccessRate: 0.667,
      });
      mockedReadFile.mockResolvedValueOnce(JSON.stringify([existing]));

      const result = await store.updateTrust('src', 'tgt', 'failure');

      // alpha = 0.15 * 1.0 = 0.15
      // trust = 0.15 * 0.0 + 0.85 * 0.8 = 0 + 0.68 = 0.68
      expect(result.trustScore).toBeCloseTo(0.68, 2);
    });

    it('should clamp trust between 0 and 1 (never go below 0)', async () => {
      const existing = makeRelationship({
        sourceAgentId: 'src',
        targetAgentId: 'tgt',
        trustScore: 0.01,
        interactionCount: 0,
        delegationCount: 0,
        delegationSuccessRate: 0,
      });
      mockedReadFile.mockResolvedValueOnce(JSON.stringify([existing]));

      const result = await store.updateTrust('src', 'tgt', 'failure');

      expect(result.trustScore).toBeGreaterThanOrEqual(0);
      expect(result.trustScore).toBeLessThanOrEqual(1);
    });

    it('should clamp trust between 0 and 1 (never go above 1)', async () => {
      const existing = makeRelationship({
        sourceAgentId: 'src',
        targetAgentId: 'tgt',
        trustScore: 0.99,
        interactionCount: 0,
        delegationCount: 0,
        delegationSuccessRate: 0,
      });
      mockedReadFile.mockResolvedValueOnce(JSON.stringify([existing]));

      const result = await store.updateTrust('src', 'tgt', 'success');

      expect(result.trustScore).toBeGreaterThanOrEqual(0);
      expect(result.trustScore).toBeLessThanOrEqual(1);
    });

    it('should respect custom weight parameter', async () => {
      mockedReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const result = await store.updateTrust('src', 'tgt', 'success', 2.0);

      // alpha = 0.15 * 2.0 = 0.30
      // trust = 0.30 * 1.0 + 0.70 * 0.5 = 0.30 + 0.35 = 0.65
      expect(result.trustScore).toBeCloseTo(0.65, 3);
    });

    it('should track interactionCount', async () => {
      const existing = makeRelationship({
        sourceAgentId: 'src',
        targetAgentId: 'tgt',
        interactionCount: 5,
        delegationCount: 3,
        delegationSuccessRate: 0.667,
      });
      mockedReadFile.mockResolvedValueOnce(JSON.stringify([existing]));

      const result = await store.updateTrust('src', 'tgt', 'success');

      expect(result.interactionCount).toBe(6);
    });

    it('should track delegationCount', async () => {
      const existing = makeRelationship({
        sourceAgentId: 'src',
        targetAgentId: 'tgt',
        interactionCount: 3,
        delegationCount: 2,
        delegationSuccessRate: 0.5,
      });
      mockedReadFile.mockResolvedValueOnce(JSON.stringify([existing]));

      const result = await store.updateTrust('src', 'tgt', 'success');

      expect(result.delegationCount).toBe(3);
    });

    it('should update delegationSuccessRate on success', async () => {
      const existing = makeRelationship({
        sourceAgentId: 'src',
        targetAgentId: 'tgt',
        interactionCount: 2,
        delegationCount: 2,
        delegationSuccessRate: 0.5, // 1 success out of 2
      });
      mockedReadFile.mockResolvedValueOnce(JSON.stringify([existing]));

      const result = await store.updateTrust('src', 'tgt', 'success');

      // Previous: 0.5 * 2 = 1 success. Now: (1 + 1) / 3 = 0.6667
      expect(result.delegationSuccessRate).toBeCloseTo(0.6667, 3);
    });

    it('should update delegationSuccessRate on failure', async () => {
      const existing = makeRelationship({
        sourceAgentId: 'src',
        targetAgentId: 'tgt',
        interactionCount: 2,
        delegationCount: 2,
        delegationSuccessRate: 1.0, // 2 successes out of 2
      });
      mockedReadFile.mockResolvedValueOnce(JSON.stringify([existing]));

      const result = await store.updateTrust('src', 'tgt', 'failure');

      // Previous: 1.0 * 2 = 2 successes. Now: (2 + 0) / 3 = 0.6667
      expect(result.delegationSuccessRate).toBeCloseTo(0.6667, 3);
    });

    it('should set delegationSuccessRate to 1 on first success', async () => {
      mockedReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const result = await store.updateTrust('src', 'tgt', 'success');

      // delegationCount starts at 0, goes to 1
      // successes = round(0 * 0) = 0, new rate = (0 + 1) / 1 = 1.0
      expect(result.delegationCount).toBe(1);
      expect(result.delegationSuccessRate).toBe(1.0);
    });

    it('should set delegationSuccessRate to 0 on first failure', async () => {
      mockedReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const result = await store.updateTrust('src', 'tgt', 'failure');

      expect(result.delegationCount).toBe(1);
      expect(result.delegationSuccessRate).toBe(0);
    });
  });

  describe('save', () => {
    it('should write compact JSON', async () => {
      mockedReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      await store.set(
        makeRelationship({
          sourceAgentId: 'compact-src',
          targetAgentId: 'compact-tgt',
        }),
      );

      const written = mockedWriteFile.mock.calls[0][1] as string;

      // Compact JSON should NOT have newlines or indentation
      expect(written).not.toContain('\n');
      expect(written).not.toContain('  ');
      // Should be valid JSON
      expect(() => JSON.parse(written)).not.toThrow();
    });

    it('should create directory before writing', async () => {
      mockedReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      await store.set(
        makeRelationship({ sourceAgentId: 'dir-src', targetAgentId: 'dir-tgt' }),
      );

      expect(mockedMkdir).toHaveBeenCalledWith(
        expect.stringContaining('relationships'),
        { recursive: true },
      );
    });
  });
});
