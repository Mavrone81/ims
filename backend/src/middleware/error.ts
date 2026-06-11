import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { ApiError } from '../errors.js';

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: err.issues[0]?.message ?? 'Invalid request',
        details: err.issues.map((i) => ({ field: i.path.join('.'), issue: i.message })),
      },
    });
  }
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
  }
  // Postgres unique violation -> 409
  if (err?.code === '23505') {
    return res.status(409).json({
      error: { code: 'CONFLICT', message: 'A record with the same unique value already exists' },
    });
  }
  console.error(err);
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
}
