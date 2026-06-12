import type { Request, Response, NextFunction } from 'express';

/**
 * Strict throttle for login endpoints (fixes VAPT M1). Sits in front of the
 * global limiter and counts *failed* auth attempts:
 *
 *   - per (IP, username): locks after MAX_FAILS_USER failures. Keying on the
 *     pair means an attacker can only lock out their own IP for a username —
 *     they cannot lock a victim out from elsewhere (avoids targeted-lockout DoS).
 *   - per IP: locks after MAX_FAILS_IP failures, to blunt username spraying
 *     from a single source.
 *
 * A successful login (HTTP 200) clears the caller's counters. State is in
 * memory per API instance — adequate for the single-instance deployment; move
 * to Redis if the API is horizontally scaled.
 */
const WINDOW_MS = 15 * 60 * 1000; // failures age out after 15 min of no activity
const LOCKOUT_MS = 15 * 60 * 1000; // lock duration once tripped
const MAX_FAILS_USER = 5;
const MAX_FAILS_IP = 20;

interface Attempt {
  fails: number;
  firstSeen: number;
  lockedUntil: number;
}

const store = new Map<string, Attempt>();

function bucket(key: string): Attempt {
  const now = Date.now();
  let a = store.get(key);
  // Reset an expired, unlocked bucket so old failures don't accumulate forever.
  if (!a || (now - a.firstSeen > WINDOW_MS && now >= a.lockedUntil)) {
    a = { fails: 0, firstSeen: now, lockedUntil: 0 };
    store.set(key, a);
  }
  return a;
}

export function loginRateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip ?? 'unknown';
  const username = String(req.body?.username ?? '').toLowerCase().slice(0, 100);
  const ipKey = `ip:${ip}`;
  const userKey = `u:${ip}:${username}`;
  const now = Date.now();

  for (const key of [ipKey, userKey]) {
    const a = bucket(key);
    if (a.lockedUntil > now) {
      const retrySec = Math.ceil((a.lockedUntil - now) / 1000);
      res.setHeader('Retry-After', String(retrySec));
      return res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: `Too many failed login attempts. Try again in ${Math.ceil(retrySec / 60)} minute(s).`,
        },
      });
    }
  }

  // Observe the auth result without coupling to the route handler.
  res.on('finish', () => {
    if (res.statusCode === 200) {
      store.delete(ipKey);
      store.delete(userKey);
    } else if (res.statusCode === 401) {
      for (const [key, max] of [[ipKey, MAX_FAILS_IP], [userKey, MAX_FAILS_USER]] as const) {
        const a = bucket(key);
        a.fails += 1;
        if (a.fails >= max) a.lockedUntil = Date.now() + LOCKOUT_MS;
      }
    }
  });

  next();
}

// Periodic eviction of stale buckets.
setInterval(() => {
  const now = Date.now();
  for (const [k, a] of store) {
    if (now - a.firstSeen > WINDOW_MS && now >= a.lockedUntil) store.delete(k);
  }
}, 5 * 60 * 1000).unref();
