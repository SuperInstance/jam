/**
 * TTS (Text-to-Speech) helper utilities.
 * Extracted from Orchestrator to reduce complexity and improve testability.
 */

import { createLogger } from '@jam/core';

const log = createLogger('TTSHelper');

/** Death phrases for crash notifications (randomly selected) */
const DEATH_PHRASES = [
  '{name} has left the building. Permanently.',
  '{name} just rage-quit. Classic.',
  'Uh oh. {name} is taking an unscheduled nap.',
  '{name} has entered the shadow realm.',
  'Well... {name} is no more. Rest in pixels.',
  '{name} has crashed. Sending thoughts and prayers.',
  'Plot twist: {name} is dead.',
  '{name} just spontaneously combusted. Awkward.',
];

/** Tool-use → TTS phrase mappings (add entries to extend) */
const PROGRESS_PHRASES: Array<{ pattern: RegExp; phrase: string }> = [
  { pattern: /bash|command|shell|run|exec/i, phrase: 'Running a command.' },
  { pattern: /write|edit|create|file/i, phrase: 'Writing some code.' },
  { pattern: /read|cat|view/i, phrase: 'Reading files.' },
  { pattern: /search|find|grep|glob/i, phrase: 'Searching for something.' },
  { pattern: /test|spec|jest|vitest/i, phrase: 'Running tests.' },
  { pattern: /git|commit|push|pull/i, phrase: 'Working with git.' },
  { pattern: /npm|yarn|pnpm|install/i, phrase: 'Installing packages.' },
  { pattern: /build|compile|bundle/i, phrase: 'Building the project.' },
  { pattern: /fetch|request|http|api/i, phrase: 'Making a network request.' },
];

/**
 * Pick a random death phrase for crash notifications.
 */
export function pickDeathPhrase(name: string): string {
  const phrase = DEATH_PHRASES[Math.floor(Math.random() * DEATH_PHRASES.length)];
  return phrase.replace(/{name}/g, name);
}

/**
 * Map tool-use type to a TTS progress phrase.
 * Returns undefined if no matching pattern is found.
 */
export function getProgressPhrase(type: string, summary: string): string | undefined {
  const combined = `${type} ${summary}`;
  for (const { pattern, phrase } of PROGRESS_PHRASES) {
    if (pattern.test(combined)) {
      return phrase;
    }
  }
  return undefined;
}

/**
 * Strip markdown formatting so TTS reads natural text, not syntax.
 */
export function stripMarkdownForTTS(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' (code block omitted) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    .replace(/_{1,3}([^_]+)_{1,3}/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/^[-*_]{3,}\s*$/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Check if text is suitable for TTS (long enough to be worth speaking).
 */
export function isSuitableForTTS(text: string, minLength = 10): boolean {
  return text.length >= minLength;
}

/**
 * Truncate text for TTS (to avoid extremely long syntheses).
 */
export function truncateForTTS(text: string, maxLength = 500): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}
