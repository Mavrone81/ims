import { Router } from 'express';
import { z } from 'zod';
import type pg from 'pg';
import { query } from '../db.js';
import { notFound, badRequest } from '../errors.js';
import { asyncHandler } from '../utils/http.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';

export const txnLabelsRouter = Router();

const BASE_TYPES = ['receipt', 'issue', 'transfer', 'adjustment', 'write_off'] as const;

/** Seed the built-in movement labels for a freshly created organization. */
export async function seedTxnLabels(client: pg.PoolClient, orgId: string) {
  const defaults: [string, string][] = [
    ['receipt', 'Receipt'],
    ['issue', 'Issue'],
    ['transfer', 'Transfer'],
    ['adjustment', 'Adjustment'],
    ['write_off', 'Write-off'],
  ];
  for (const [i, [base, label]] of defaults.entries()) {
    await client.query(
      `INSERT INTO txn_labels (org_id, base_type, label, sort_order) VALUES ($1, $2, $3, $4)`,
      [orgId, base, label, i + 1]
    );
  }
}

// Any project member can read the labels (the movement form needs them).
txnLabelsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT id, base_type, label, sort_order, is_active
       FROM txn_labels WHERE org_id = $1 AND is_active ORDER BY sort_order, label`,
      [req.user!.org_id]
    );
    res.json({ data: rows });
  })
);

const labelBody = z.object({
  base_type: z.enum(BASE_TYPES),
  label: z.string().min(1).max(40),
  sort_order: z.number().int().optional(),
});

// Add a label (manager+ — covers managers and org admins).
txnLabelsRouter.post(
  '/',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const body = labelBody.parse(req.body);
    const { rows } = await query(
      `INSERT INTO txn_labels (org_id, base_type, label, sort_order)
       VALUES ($1, $2, $3, COALESCE($4, 99)) RETURNING *`,
      [req.user!.org_id, body.base_type, body.label, body.sort_order ?? null]
    ).catch((err: any) => {
      if (err?.code === '23505') throw badRequest(`A label named "${body.label}" already exists`);
      throw err;
    });
    audit(req, 'txn_label.create', 'txn_label', rows[0].id, null, rows[0]);
    res.status(201).json(rows[0]);
  })
);

// Rename / re-map / reorder a label (manager+).
txnLabelsRouter.patch(
  '/:id',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const body = labelBody.partial().parse(req.body);
    const cols = Object.keys(body) as (keyof typeof body)[];
    if (!cols.length) throw badRequest('Nothing to update');
    const sets = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
    const { rows } = await query(
      `UPDATE txn_labels SET ${sets} WHERE id = $1 AND org_id = $2 RETURNING *`,
      [req.params.id, req.user!.org_id, ...cols.map((c) => body[c])]
    ).catch((err: any) => {
      if (err?.code === '23505') throw badRequest(`A label named "${body.label}" already exists`);
      throw err;
    });
    if (!rows[0]) throw notFound('Label not found');
    audit(req, 'txn_label.update', 'txn_label', req.params.id, null, rows[0]);
    res.json(rows[0]);
  })
);

// Deactivate a label (manager+). Historical transactions keep their captured text.
txnLabelsRouter.delete(
  '/:id',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const remaining = await query(
      `SELECT count(*) AS n FROM txn_labels t
       WHERE t.org_id = $1 AND t.is_active
         AND t.base_type = (SELECT base_type FROM txn_labels WHERE id = $2 AND org_id = $1)`,
      [req.user!.org_id, req.params.id]
    );
    if (Number(remaining.rows[0]?.n ?? 0) <= 1) {
      throw badRequest('Cannot remove the last label for a movement behaviour — rename it instead');
    }
    const { rows } = await query(
      `UPDATE txn_labels SET is_active = FALSE WHERE id = $1 AND org_id = $2 RETURNING id`,
      [req.params.id, req.user!.org_id]
    );
    if (!rows[0]) throw notFound('Label not found');
    audit(req, 'txn_label.delete', 'txn_label', req.params.id);
    res.status(204).end();
  })
);
