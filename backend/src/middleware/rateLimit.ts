import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

// In-memory fixed-window limiter (per IP). Swap for a Redis-backed limiter
// when running multiple API instances (see docs/03_ENV.md).
const hits = new Map<string, { count: number; windowStart: number }>();

export function rateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip ?? 'unknown';
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.windowStart >= config.rateLimitWindowMs) {
    hits.set(ip, { count: 1, windowStart: now });
    return next();
  }
  entry.count += 1;
  if (entry.count > config.rateLimitMax) {
    return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
  }
  next();
}

setInterval(() => {
  const cutoff = Date.now() - config.rateLimitWindowMs;
  for (const [ip, entry] of hits) if (entry.windowStart < cutoff) hits.delete(ip);
}, 60_000).unref();
