import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { notFound } from '../errors.js';
import { asyncHandler } from '../utils/http.js';
import { requireRole, requireOrgAdmin } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';

// Categories, suppliers, currencies, exchange rates (docs/04_API.md §7)
export const categoriesRouter = Router();
export const suppliersRouter = Router();
export const currenciesRouter = Router();
export const exchangeRatesRouter = Router();

// ── Categories ────────────────────────────────────────────────────────
const categoryBody = z.object({ name: z.string().min(1), parent_id: z.string().uuid().nullish() });

categoriesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT id, name, parent_id FROM categories WHERE org_id = $1 AND deleted_at IS NULL ORDER BY name`,
      [req.user!.org_id]
    );
    res.json({ data: rows });
  })
);

categoriesRouter.post(
  '/',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const body = categoryBody.parse(req.body);
    const { rows } = await query(
      `INSERT INTO categories (org_id, name, parent_id) VALUES ($1, $2, $3) RETURNING *`,
      [req.user!.org_id, body.name, body.parent_id ?? null]
    );
    audit(req, 'category.create', 'category', rows[0].id, null, rows[0]);
    res.status(201).json(rows[0]);
  })
);

categoriesRouter.patch(
  '/:id',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const body = categoryBody.partial().parse(req.body);
    const { rows } = await query(
      `UPDATE categories SET name = COALESCE($3, name), parent_id = COALESCE($4, parent_id)
       WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL RETURNING *`,
      [req.params.id, req.user!.org_id, body.name ?? null, body.parent_id ?? null]
    );
    if (!rows[0]) throw notFound('Category not found');
    res.json(rows[0]);
  })
);

categoriesRouter.delete(
  '/:id',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `UPDATE categories SET deleted_at = now() WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL RETURNING id`,
      [req.params.id, req.user!.org_id]
    );
    if (!rows[0]) throw notFound('Category not found');
    res.status(204).end();
  })
);

// ── Suppliers ─────────────────────────────────────────────────────────
const supplierBody = z.object({
  name: z.string().min(1),
  contact_name: z.string().nullish(),
  email: z.string().email().nullish(),
  phone: z.string().nullish(),
  lead_time_days: z.number().int().nonnegative().nullish(),
  currency: z.string().length(3).nullish(),
});

suppliersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT * FROM suppliers WHERE org_id = $1 AND deleted_at IS NULL ORDER BY name`,
      [req.user!.org_id]
    );
    res.json({ data: rows });
  })
);

suppliersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT * FROM suppliers WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
      [req.params.id, req.user!.org_id]
    );
    if (!rows[0]) throw notFound('Supplier not found');
    res.json(rows[0]);
  })
);

suppliersRouter.post(
  '/',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const body = supplierBody.parse(req.body);
    const { rows } = await query(
      `INSERT INTO suppliers (org_id, name, contact_name, email, phone, lead_time_days, currency)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user!.org_id, body.name, body.contact_name ?? null, body.email ?? null,
       body.phone ?? null, body.lead_time_days ?? null, body.currency ?? null]
    );
    audit(req, 'supplier.create', 'supplier', rows[0].id, null, rows[0]);
    res.status(201).json(rows[0]);
  })
);

suppliersRouter.patch(
  '/:id',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const body = supplierBody.partial().parse(req.body);
    const cols = Object.keys(body) as (keyof typeof body)[];
    if (!cols.length) {
      const { rows } = await query(`SELECT * FROM suppliers WHERE id = $1 AND org_id = $2`, [
        req.params.id, req.user!.org_id,
      ]);
      return res.json(rows[0]);
    }
    const sets = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
    const { rows } = await query(
      `UPDATE suppliers SET ${sets}, updated_at = now()
       WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL RETURNING *`,
      [req.params.id, req.user!.org_id, ...cols.map((c) => body[c] ?? null)]
    );
    if (!rows[0]) throw notFound('Supplier not found');
    res.json(rows[0]);
  })
);

suppliersRouter.delete(
  '/:id',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `UPDATE suppliers SET deleted_at = now() WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL RETURNING id`,
      [req.params.id, req.user!.org_id]
    );
    if (!rows[0]) throw notFound('Supplier not found');
    res.status(204).end();
  })
);

// ── Currencies & exchange rates ───────────────────────────────────────
currenciesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(`SELECT code, name, symbol FROM currencies ORDER BY code`);
    res.json({ data: rows });
  })
);

currenciesRouter.post(
  '/',
  requireOrgAdmin,
  asyncHandler(async (req, res) => {
    const body = z
      .object({ code: z.string().length(3), name: z.string().min(1), symbol: z.string().nullish() })
      .parse(req.body);
    const { rows } = await query(
      `INSERT INTO currencies (code, name, symbol) VALUES (upper($1), $2, $3)
       ON CONFLICT (code) DO UPDATE SET name = $2, symbol = $3 RETURNING *`,
      [body.code, body.name, body.symbol ?? null]
    );
    res.status(201).json(rows[0]);
  })
);

exchangeRatesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const params: any[] = [req.user!.org_id];
    let where = `WHERE org_id = $1`;
    if (req.query.from) { params.push(String(req.query.from).toUpperCase()); where += ` AND from_currency = $${params.length}`; }
    if (req.query.to) { params.push(String(req.query.to).toUpperCase()); where += ` AND to_currency = $${params.length}`; }
    if (req.query.on) { params.push(req.query.on); where += ` AND effective_date <= $${params.length}`; }
    const { rows } = await query(
      `SELECT * FROM exchange_rates ${where} ORDER BY from_currency, to_currency, effective_date DESC LIMIT 500`,
      params
    );
    res.json({ data: rows.map((r) => ({ ...r, rate: Number(r.rate) })) });
  })
);

exchangeRatesRouter.post(
  '/',
  requireOrgAdmin,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        from_currency: z.string().length(3),
        to_currency: z.string().length(3),
        rate: z.number().positive(),
        effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(req.body);
    const { rows } = await query(
      `INSERT INTO exchange_rates (org_id, from_currency, to_currency, rate, effective_date)
       VALUES ($1, upper($2), upper($3), $4, $5)
       ON CONFLICT (org_id, from_currency, to_currency, effective_date)
       DO UPDATE SET rate = $4 RETURNING *`,
      [req.user!.org_id, body.from_currency, body.to_currency, body.rate, body.effective_date]
    );
    audit(req, 'exchange_rate.set', 'exchange_rate', rows[0].id, null, rows[0]);
    res.status(201).json({ ...rows[0], rate: Number(rows[0].rate) });
  })
);
