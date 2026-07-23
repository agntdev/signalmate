/**
 * Injectable clock seam — every schedule, "today", expiry, and late/on-time
 * decision routes through `now()` so tests can freeze/advance time.
 */

let overrideMs: number | null = null;

/** Current wall-clock time (ms since epoch). Overridable via setNow(). */
export function now(): number {
  return overrideMs ?? Date.now();
}

/** Override the clock for tests. Pass null to restore the real clock. */
export function setNow(ms: number | null): void {
  overrideMs = ms;
}

/** Advance the injected clock by `deltaMs` (no-op if not overridden). */
export function advance(deltaMs: number): void {
  if (overrideMs !== null) overrideMs += deltaMs;
}
