import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatTokens, estimateCost, formatTime, formatTimeAgo, formatElapsed } from '../utils/format';

describe('formatTokens', () => {
  it('returns "0" for zero', () => {
    expect(formatTokens(0)).toBe('0');
  });

  it('returns plain number for values under 1000', () => {
    expect(formatTokens(999)).toBe('999');
  });

  it('formats 1000 as "1.0K"', () => {
    expect(formatTokens(1000)).toBe('1.0K');
  });

  it('formats 1500 as "1.5K"', () => {
    expect(formatTokens(1500)).toBe('1.5K');
  });

  it('formats 999999 as "1000.0K"', () => {
    expect(formatTokens(999999)).toBe('1000.0K');
  });

  it('formats 1000000 as "1.0M"', () => {
    expect(formatTokens(1000000)).toBe('1.0M');
  });

  it('formats 1500000 as "1.5M"', () => {
    expect(formatTokens(1500000)).toBe('1.5M');
  });
});

describe('estimateCost', () => {
  it('calculates cost for input tokens only', () => {
    expect(estimateCost(1_000_000, 0)).toBe(3.0);
  });

  it('calculates cost for output tokens only', () => {
    expect(estimateCost(0, 1_000_000)).toBe(15.0);
  });

  it('calculates blended cost for both input and output', () => {
    expect(estimateCost(500_000, 500_000)).toBe(9.0);
  });

  it('returns 0 when both counts are zero', () => {
    expect(estimateCost(0, 0)).toBe(0);
  });
});

describe('formatTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('converts a timestamp to HH:MM string', () => {
    // Use a fixed timestamp: 2024-01-15T14:30:00Z
    const ts = new Date('2024-01-15T14:30:00Z').getTime();
    const result = formatTime(ts);
    // The result depends on locale, but should contain hour and minute
    // Verify it matches HH:MM pattern (with optional AM/PM)
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  it('returns different strings for different timestamps', () => {
    const ts1 = new Date('2024-01-15T08:00:00Z').getTime();
    const ts2 = new Date('2024-01-15T20:00:00Z').getTime();
    expect(formatTime(ts1)).not.toBe(formatTime(ts2));
  });
});

describe('formatTimeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Fix "now" to a known point: 2024-06-15T12:00:00Z
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for less than 1 minute ago', () => {
    const ts = Date.now() - 30_000; // 30 seconds ago
    expect(formatTimeAgo(ts)).toBe('just now');
  });

  it('returns "5m ago" for 5 minutes ago', () => {
    const ts = Date.now() - 5 * 60_000;
    expect(formatTimeAgo(ts)).toBe('5m ago');
  });

  it('returns "3h ago" for 3 hours ago', () => {
    const ts = Date.now() - 3 * 60 * 60_000;
    expect(formatTimeAgo(ts)).toBe('3h ago');
  });

  it('returns "2d ago" for 2 days ago', () => {
    const ts = Date.now() - 2 * 24 * 60 * 60_000;
    expect(formatTimeAgo(ts)).toBe('2d ago');
  });

  it('returns a date string for more than 7 days ago', () => {
    const ts = Date.now() - 10 * 24 * 60 * 60_000;
    const result = formatTimeAgo(ts);
    // Should not end with "ago" — it's a formatted date
    expect(result).not.toContain('ago');
    expect(result).not.toBe('just now');
    // Should contain month abbreviation and day number (e.g., "Jun 5")
    expect(result).toMatch(/\w+ \d+/);
  });

  it('accepts an ISO string input', () => {
    const iso = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatTimeAgo(iso)).toBe('5m ago');
  });

  it('accepts a number input', () => {
    const ts = Date.now() - 5 * 60_000;
    expect(formatTimeAgo(ts)).toBe('5m ago');
  });
});

describe('formatElapsed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats 45 seconds as "45s"', () => {
    const start = new Date(Date.now() - 45_000).toISOString();
    expect(formatElapsed(start)).toBe('45s');
  });

  it('formats 2.5 minutes as "2m 30s"', () => {
    const start = new Date(Date.now() - 150_000).toISOString(); // 2m 30s
    expect(formatElapsed(start)).toBe('2m 30s');
  });

  it('formats 65 minutes as "1h 5m"', () => {
    const start = new Date(Date.now() - 65 * 60_000).toISOString();
    expect(formatElapsed(start)).toBe('1h 5m');
  });
});
