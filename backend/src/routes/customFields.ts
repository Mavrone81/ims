import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { notFound } from '../errors.js';
import { asyncHandler } from '../utils/http.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';

export const customFieldsRouter = Router();

const optionSchema = z.object({ value: z.string().min(1), label: z.string().min(1) });
const fieldBody = z.object({
  category_id: z.string().uuid().nullish(),
  key: z.string().regex(/^[a-z0-9_]+$/, 'key must be lowercase snake_case'),
  label: z.string().min(1),
  type: z.enum(['text', 'number', 'date', 'boolean', 'select', 'multiselect']),
  is_required: z.boolean().optional().default(false),
  default_value: z.string().nullish(),
  help_text: z.string().nullish(),
  sort_order: z.number().int().optional().default(0),
  options: z.array(optionSchema).optional(),
});

const FIELD_SELECT = `
  SELECT d.*, COALESCE(json_agg(json_build_object('value', o.value, 'label', o.label) ORDER BY o.sort_order)
              FILTER (WHERE o.id IS NOT NULL), '[]') AS options
  FROM custom_field_defs d
  LEFT JOIN custom_field_options o ON o.field_id = d.id`;

customFieldsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const params: any[] = [req.user!.org_id];
    let where = `WHERE d.org_id = $1 AND d.deleted_at IS NULL`;
    if (req.query.category_id) {
      params.push(req.query.category_id);
      where += ` AND (d.category_id = $${params.length} OR d.category_id IS NULL)`;
    }
    const { rows } = await query(`${FIELD_SELECT} ${where} GROUP BY d.id ORDER BY d.sort_order, d.label`, params);
    res.json({ data: rows });
  })
);

customFieldsRouter.post(
  '/',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const body = fieldBody.parse(req.body);
    const field = await withTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO custom_field_defs (org_id, category_id, key, label, type, is_required,
                                        default_value, help_text, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [req.user!.org_id, body.category_id ?? null, body.key, body.label, body.type,
         body.is_required, body.default_value ?? null, body.help_text ?? null, body.sort_order]
      );
      const def = inserted.rows[0];
      for (const [idx, opt] of (body.options ?? []).entries()) {
        await client.query(
          `INSERT INTO custom_field_options (field_id, value, label, sort_order) VALUES ($1,$2,$3,$4)`,
          [def.id, opt.value, opt.label, idx]
        );
      }
      return def;
    });
    audit(req, 'custom_field.create', 'custom_field_def', field.id, null, field);
    res.status(201).json(field);
  })
);

customFieldsRouter.patch(
  '/:id',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const body = fieldBody.partial().parse(req.body);
    const updated = await withTransaction(async (client) => {
      const { options, ...fields } = body;
      const cols = Object.keys(fields) as (keyof typeof fields)[];
      if (cols.length) {
        const sets = cols.map((c, idx) => `${c} = $${idx + 3}`).join(', ');
        await client.query(
          `UPDATE custom_field_defs SET ${sets} WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
          [req.params.id, req.user!.org_id, ...cols.map((c) => fields[c] ?? null)]
        );
      }
      if (options) {
        await client.query('DELETE FROM custom_field_options WHERE field_id = $1', [req.params.id]);
        for (const [idx, opt] of options.entries()) {
          await client.query(
            `INSERT INTO custom_field_options (field_id, value, label, sort_order) VALUES ($1,$2,$3,$4)`,
            [req.params.id, opt.value, opt.label, idx]
          );
        }
      }
      const { rows } = await client.query(
        `SELECT * FROM custom_field_defs WHERE id = $1 AND org_id = $2`,
        [req.params.id, req.user!.org_id]
      );
      return rows[0];
    });
    if (!updated) throw notFound('Custom field not found');
    audit(req, 'custom_field.update', 'custom_field_def', req.params.id, null, updated);
    res.json(updated);
  })
);

// FR-4.5: soft-delete, historical values retained
customFieldsRouter.delete(
  '/:id',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `UPDATE custom_field_defs SET deleted_at = now()
       WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL RETURNING id`,
      [req.params.id, req.user!.org_id]
    );
    if (!rows[0]) throw notFound('Custom field not found');
    audit(req, 'custom_field.delete', 'custom_field_def', req.params.id);
    res.status(204).end();
  })
);
