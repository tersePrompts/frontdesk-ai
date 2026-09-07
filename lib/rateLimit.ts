type Entry = { start: number; count: number };

const store = new Map<string, Entry>();

/**
 * Lightweight in-memory fixed-window rate limiter. Keyed by something stable
 * per caller (typically the client IP). Per-instance by design: good enough to
 * blunt casual abuse on serverless single-region deployments.
 *
 * Returns true when the caller has exceeded `limit` requests within `windowMs`.
 */
export function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();

  // Opportunistic cleanup so a busy instance never leaks rate-limit entries.
  if (store.size > 1_000) {
    for (const [k, entry] of store) {
      if (now - entry.start >= windowMs) store.delete(k);
    }
  }

  const entry = store.get(key);
  if (!entry || now - entry.start >= windowMs) {
    store.set(key, { start: now, count: 1 });
    return false;
  }

  entry.count += 1;
  return entry.count > limit;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}