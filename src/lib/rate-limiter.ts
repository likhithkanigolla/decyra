/**
 * In-memory sliding-window rate limiter for sensitive endpoints.
 * Automatically cleans up expired timestamps to avoid memory growth.
 */

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();
const CLEANUP_INTERVAL_MS = 60_000; // 1 minute
let lastCleanup = Date.now();

function cleanupExpired(now: number, maxWindowMs: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  for (const [key, entry] of store.entries()) {
    entry.timestamps = entry.timestamps.filter((ts) => now - ts < maxWindowMs);
    if (entry.timestamps.length === 0) {
      store.delete(key);
    }
  }
}

export function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number
): { allowed: boolean; retryAfterMs: number; remaining: number } {
  const now = Date.now();
  cleanupExpired(now, windowMs);

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Filter timestamps within current window
  entry.timestamps = entry.timestamps.filter((ts) => now - ts < windowMs);

  if (entry.timestamps.length >= maxAttempts) {
    const oldest = entry.timestamps[0];
    const retryAfterMs = Math.max(0, windowMs - (now - oldest));
    return { allowed: false, retryAfterMs, remaining: 0 };
  }

  entry.timestamps.push(now);
  return {
    allowed: true,
    retryAfterMs: 0,
    remaining: maxAttempts - entry.timestamps.length,
  };
}

export function assertRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number,
  actionName = "action"
): void {
  const result = checkRateLimit(key, maxAttempts, windowMs);
  if (!result.allowed) {
    const retrySeconds = Math.ceil(result.retryAfterMs / 1000);
    throw new Error(
      `Too many ${actionName} attempts. Please try again in ${retrySeconds} second${retrySeconds === 1 ? "" : "s"}.`
    );
  }
}

/**
 * Reset rate limit key (e.g. on successful login or recovery)
 */
export function resetRateLimit(key: string): void {
  store.delete(key);
}
