/**
 * @fileoverview SoulManager - Agent soul/persona persistence and evolution.
 *
 * The SoulManager handles agent identity and personality through:
 * - Loading/saving soul data from SOUL.md files
 * - Parsing YAML frontmatter and markdown sections
 * - Evolving souls with new learnings, trait adjustments, and goals
 * - Emitting events when souls evolve
 *
 * Soul Structure:
 * - Persona: A brief description of the agent's identity
 * - Role: Professional role (e.g., "Frontend Developer")
 * - Traits: Named numeric values (0-1) for personality attributes
 * - Goals: Array of objectives the agent is working toward
 * - Strengths/Weaknesses: Capabilities and limitations
 * - Learnings: Accumulated knowledge over time
 *
 * @module team/soul-manager
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { SoulStructure, IEventBus } from '@jam/core';
import { Events } from '@jam/core';

/**
 * Normalizes a trait name to a canonical stem for fuzzy matching.
 *
 * Strips common suffixes (-ness, -ity, -ive, -tion, -ment) and normalizes
 * separators to underscores. This allows "proactiveness" and "proactive" to
 * match as the same trait.
 *
 * @param name - The trait name to normalize
 * @returns The normalized trait stem
 * @private
 */
function traitStem(name: string): string {
  return name
    .toLowerCase()
    .replace(/[-_\s]+/g, '_')
    .replace(/(ness|ity|ive|tion|ment)$/, '')
    .replace(/_$/, '');
}

/**
 * Finds the existing trait key that matches an incoming trait name.
 *
 * Uses fuzzy matching via trait stems to find the canonical trait name.
 * If no match is found, the incoming name is returned as-is (new trait).
 *
 * @param incoming - The incoming trait name to match
 * @param existing - Map of existing trait names to values
 * @returns The canonical trait key from existing, or the incoming name
 * @private
 */
function findCanonicalTrait(incoming: string, existing: Record<string, number>): string {
  // Exact match first
  if (incoming in existing) return incoming;

  // Fuzzy match: compare stems
  const incomingStem = traitStem(incoming);
  for (const key of Object.keys(existing)) {
    if (traitStem(key) === incomingStem) return key;
  }

  // No match — this is a genuinely new trait
  return incoming;
}

/**
 * Creates a default soul structure.
 *
 * @returns A new soul with empty/default values
 * @private
 */
function defaultSoul(): SoulStructure {
  return {
    persona: '',
    role: '',
    traits: {},
    goals: [],
    strengths: [],
    weaknesses: [],
    learnings: [],
    lastReflection: new Date().toISOString(),
    version: 1,
  };
}

/**
 * Parses YAML-like frontmatter from SOUL.md into SoulStructure.
 *
 * Handles both frontmatter format and markdown sections:
 * - Frontmatter: version, lastReflection, persona, role
 * - Sections: ## Traits, ## Goals, ## Strengths, ## Weaknesses, ## Learnings
 *
 * @param content - The SOUL.md file content
 * @returns The parsed soul structure
 * @private
 */
function parseSoulMd(content: string): SoulStructure {
  const soul = defaultSoul();

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const frontmatter = fmMatch[1];
    for (const line of frontmatter.split('\n')) {
      const [key, ...rest] = line.split(':');
      const value = rest.join(':').trim();
      if (!key || !value) continue;

      const k = key.trim();
      if (k === 'version') soul.version = parseInt(value, 10) || 1;
      else if (k === 'lastReflection') soul.lastReflection = value;
      else if (k === 'persona') soul.persona = value;
      else if (k === 'role') soul.role = value;
    }
  }

  // Parse markdown sections
  const body = fmMatch ? content.slice(fmMatch[0].length).trim() : content;
  let currentSection = '';

  for (const line of body.split('\n')) {
    const heading = line.match(/^##\s+(.+)/);
    if (heading) {
      currentSection = heading[1].toLowerCase();
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)/);
    if (!bullet) continue;
    const item = bullet[1].trim();

    switch (currentSection) {
      case 'goals':
        soul.goals.push(item);
        break;
      case 'strengths':
        soul.strengths.push(item);
        break;
      case 'weaknesses':
        soul.weaknesses.push(item);
        break;
      case 'learnings':
        soul.learnings.push(item);
        break;
      case 'traits': {
        const traitMatch = item.match(/^(.+?):\s*([\d.]+)/);
        if (traitMatch) {
          soul.traits[traitMatch[1].trim()] = parseFloat(traitMatch[2]);
        }
        break;
      }
    }
  }

  // If no persona in frontmatter, try to extract from body
  if (!soul.persona) {
    const personaSection = body.match(/##\s+Persona\n([\s\S]*?)(?=\n##|$)/);
    if (personaSection) {
      soul.persona = personaSection[1].trim();
    }
  }

  // If no role in frontmatter, try to extract from body
  if (!soul.role) {
    const roleSection = body.match(/##\s+Role\n([\s\S]*?)(?=\n##|$)/);
    if (roleSection) {
      soul.role = roleSection[1].trim();
    }
  }

  return soul;
}

/**
 * Serializes SoulStructure to SOUL.md format.
 *
 * Generates both YAML frontmatter and markdown sections.
 *
 * @param soul - The soul structure to serialize
 * @returns The SOUL.md file content
 * @private
 */
function serializeSoulMd(soul: SoulStructure): string {
  const lines: string[] = [];

  // Frontmatter
  lines.push('---');
  lines.push(`version: ${soul.version}`);
  lines.push(`lastReflection: ${soul.lastReflection}`);
  if (soul.persona) lines.push(`persona: ${soul.persona}`);
  if (soul.role) lines.push(`role: ${soul.role}`);
  lines.push('---');
  lines.push('');

  if (soul.role) {
    lines.push('## Role');
    lines.push(soul.role);
    lines.push('');
  }

  if (soul.persona) {
    lines.push('## Persona');
    lines.push(soul.persona);
    lines.push('');
  }

  if (Object.keys(soul.traits).length > 0) {
    lines.push('## Traits');
    for (const [name, value] of Object.entries(soul.traits)) {
      lines.push(`- ${name}: ${value}`);
    }
    lines.push('');
  }

  if (soul.goals.length > 0) {
    lines.push('## Goals');
    for (const g of soul.goals) lines.push(`- ${g}`);
    lines.push('');
  }

  if (soul.strengths.length > 0) {
    lines.push('## Strengths');
    for (const s of soul.strengths) lines.push(`- ${s}`);
    lines.push('');
  }

  if (soul.weaknesses.length > 0) {
    lines.push('## Weaknesses');
    for (const w of soul.weaknesses) lines.push(`- ${w}`);
    lines.push('');
  }

  if (soul.learnings.length > 0) {
    lines.push('## Learnings');
    for (const l of soul.learnings) lines.push(`- ${l}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Manages agent soul/persona persistence and evolution.
 *
 * The SoulManager is responsible for:
 * - Loading soul data from SOUL.md files
 * - Saving soul data to disk
 * - Evolving souls with new learnings, trait adjustments, and goals
 * - Emitting events when souls change
 *
 * Souls are stored as SOUL.md files in each agent's directory.
 *
 * @class
 *
 * @example
 * ```typescript
 * const soulManager = new SoulManager('/path/to/agents', eventBus);
 *
 * // Load an agent's soul
 * const soul = await soulManager.load('agent-1');
 *
 * // Evolve the soul with new learnings
 * await soulManager.evolve('agent-1', {
 *   newLearnings: ['Users prefer shorter responses'],
 *   traitAdjustments: { 'concise': 0.1 }
 * });
 * ```
 */
export class SoulManager {
  /**
   * Creates a new SoulManager.
   *
   * @param baseDir - Base directory containing agent directories
   * @param eventBus - Event bus for emitting soul evolution events
   */
  constructor(
    private readonly baseDir: string,
    private readonly eventBus: IEventBus,
  ) {}

  /**
   * Loads an agent's soul from disk.
   *
   * If the SOUL.md file doesn't exist or is invalid, returns a default soul.
   *
   * @async
   * @param agentId - The agent ID to load the soul for
   * @returns The loaded soul structure
   */
  async load(agentId: string): Promise<SoulStructure> {
    const filePath = join(this.baseDir, agentId, 'SOUL.md');
    try {
      const content = await readFile(filePath, 'utf-8');
      return parseSoulMd(content);
    } catch {
      return defaultSoul();
    }
  }

  /**
   * Saves an agent's soul to disk.
   *
   * Creates the agent directory if it doesn't exist.
   *
   * @async
   * @param agentId - The agent ID to save the soul for
   * @param soul - The soul structure to save
   */
  async save(agentId: string, soul: SoulStructure): Promise<void> {
    const filePath = join(this.baseDir, agentId, 'SOUL.md');
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, serializeSoulMd(soul), 'utf-8');
  }

  /**
   * Evolves an agent's soul with new reflections.
   *
   * This method:
   * 1. Loads the existing soul
   * 2. Applies trait adjustments (with fuzzy matching to existing traits)
   * 3. Adds new learnings, goals, strengths, and weaknesses
   * 4. Updates the role if provided
   * 5. Increments the version and updates the timestamp
   * 6. Saves the evolved soul
   * 7. Emits a SOUL_EVOLVED event
   *
   * Trait adjustments are clamped to the range [0, 1] and use fuzzy matching
   * to avoid creating duplicate traits (e.g., "proactive" and "proactiveness").
   *
   * @async
   * @param agentId - The agent ID to evolve the soul for
   * @param reflections - The reflection data to apply
   * @returns The evolved soul structure
   */
  async evolve(
    agentId: string,
    reflections: {
      newLearnings?: string[];
      traitAdjustments?: Record<string, number>;
      newGoals?: string[];
      newStrengths?: string[];
      newWeaknesses?: string[];
      role?: string;
    },
  ): Promise<SoulStructure> {
    const soul = await this.load(agentId);

    if (reflections.role) {
      soul.role = reflections.role;
    }
    if (reflections.newLearnings) {
      soul.learnings.push(...reflections.newLearnings);
    }
    if (reflections.traitAdjustments) {
      for (const [trait, delta] of Object.entries(reflections.traitAdjustments)) {
        // Find existing trait that matches (case-insensitive, ignoring suffixes like -ness/-ity)
        const canonical = findCanonicalTrait(trait, soul.traits);
        const current = soul.traits[canonical] ?? 0.5;
        soul.traits[canonical] = Math.max(0, Math.min(1, current + delta));
      }
    }
    if (reflections.newGoals) {
      soul.goals.push(...reflections.newGoals);
    }
    if (reflections.newStrengths) {
      soul.strengths.push(...reflections.newStrengths);
    }
    if (reflections.newWeaknesses) {
      soul.weaknesses.push(...reflections.newWeaknesses);
    }

    soul.version++;
    soul.lastReflection = new Date().toISOString();

    await this.save(agentId, soul);

    this.eventBus.emit(Events.SOUL_EVOLVED, {
      agentId,
      soul,
      version: soul.version,
    });

    return soul;
  }
}
