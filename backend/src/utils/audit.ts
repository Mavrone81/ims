import type { Request } from 'express';
import { query } from '../db.js';

/** Fire-and-forget audit entry (FR-9.2). Failures are logged, never block the request. */
export function audit(
  req: Request,
  action: string,
  entityType: string,
  entityId: string | null,
  before: any = null,
  after: any = null
) {
  query(
    `INSERT INTO audit_logs (org_id, user_id, action, entity_type, entity_id, before, after, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      req.user!.org_id,
      req.user!.id,
      action,
      entityType,
      entityId,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      req.ip ?? null,
    ]
  ).catch((err) => console.error('audit write failed:', err.message));
}
