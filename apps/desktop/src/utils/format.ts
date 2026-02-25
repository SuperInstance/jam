/** Format token count: 1234 → "1.2K", 1234567 → "1.2M" */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Estimate cost in USD from token counts.
 *  Uses blended rates across providers — good enough for an estimate.
 *  Input: $3/M tokens, Output: $15/M tokens (Claude Sonnet ballpark) */
export function estimateCost(tokensIn: number, tokensOut: number): number {
  return (tokensIn * 3 + tokensOut * 15) / 1_000_000;
}

/** Format a timestamp number to HH:MM string */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Format a timestamp (number or ISO string) as relative time: "just now", "5m ago", "3h ago" */
export function formatTimeAgo(ts: number | string): string {
  const time = typeof ts === 'string' ? new Date(ts).getTime() : ts;
  const diff = Date.now() - time;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Format elapsed time from a start ISO timestamp: "45s", "2m 30s", "1h 5m" */
export function formatElapsed(startIso: string): string {
  const diff = Date.now() - new Date(startIso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}
