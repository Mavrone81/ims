import { Router } from 'express';
import { z } from 'zod';
import { pool, query, withTransaction } from '../db.js';
import { notFound, conflict } from '../errors.js';
import { asyncHandler, getPagination, getSort, paginated, toCsv } from '../utils/http.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { fieldDefsForCategory, saveCustomValues } from '../utils/customFields.js';

export const itemsRouter = Router();

const ITEM_SORTS: Record<string, string> = {
  item_no: 'i.item_no',
  description: 'i.description',
  model: 'i.model',
  unit_price: 'i.unit_price',
  stock_on_hand: 'stock_on_hand',
  created_at: 'i.created_at',
};

const itemBody = z.object({
  item_no: z.string().min(1),
  description: z.string().min(1),
  specification: z.string().nullish(),
  model: z.string().nullish(),
  supplier_id: z.string().uuid().nullish(),
  category_id: z.string().uuid().nullish(),
  department: z.string().nullish(),
  default_location_id: z.string().uuid().nullish(),
  unit_price: z.number().nonnegative().nullish(),
  currency: z.string().length(3).nullish(),
  reorder_level: z.number().nonnegative().nullish(),
  max_level: z.number().nonnegative().nullish(),
  abc_class: z.enum(['A', 'B', 'C']).nullish(),
  barcode: z.string().nullish(),
  comments: z.string().nullish(),
  custom: z.record(z.any()).optional(),
});

const LIST_SELECT = `
  SELECT i.id, i.item_no, i.description, i.specification, i.model, i.department,
         i.unit_price, i.currency, i.reorder_level, i.max_level, i.abc_class,
         i.barcode, i.comments, i.custom, i.is_active, i.category_id, i.created_at,
         s.id AS supplier_id, s.name AS supplier_name,
         l.id AS location_id, l.code AS location_code,
         c.name AS category_name,
         COALESCE(st.qty, 0) AS stock_on_hand
  FROM items i
  LEFT JOIN suppliers s ON s.id = i.supplier_id
  LEFT JOIN locations l ON l.id = i.default_location_id
  LEFT JOIN categories c ON c.id = i.category_id
  LEFT JOIN LATERAL (
    SELECT SUM(quantity) AS qty FROM stock_levels sl WHERE sl.item_id = i.id
  ) st ON TRUE`;

function shapeItem(row: any) {
  const { supplier_id, supplier_name, location_id, location_code, category_name, ...rest } = row;
  return {
    ...rest,
    stock_on_hand: Number(row.stock_on_hand),
    unit_price: row.unit_price === null ? null : Number(row.unit_price),
    value_native:
      row.unit_price === null ? null : Number(row.unit_price) * Number(row.stock_on_hand),
    supplier: supplier_id ? { id: supplier_id, name: supplier_name } : null,
    default_location: location_id ? { id: location_id, code: location_code } : null,
    category: row.category_id ? { id: row.category_id, name: category_name } : null,
  };
}

function buildFilters(req: any, params: any[]): string {
  let where = ` WHERE i.project_id = $1 AND i.deleted_at IS NULL`;
  const add = (clause: string, value: any) => {
    params.push(value);
    where += ` AND ${clause.replace('?', `$${params.length}`)}`;
  };
  if (req.query.q) {
    const q = `%${req.query.q}%`;
    params.push(q);
    const p = `$${params.length}`;
    where += ` AND (i.item_no ILIKE ${p} OR i.description ILIKE ${p} OR i.model ILIKE ${p} OR i.specification ILIKE ${p})`;
  }
  if (req.query.category_id) add('i.category_id = ?', req.query.category_id);
  if (req.query.supplier_id) add('i.supplier_id = ?', req.query.supplier_id);
  if (req.query.location_id) add('i.default_location_id = ?', req.query.location_id);
  if (req.query.abc_class) add('i.abc_class = ?', req.query.abc_class);
  const status = req.query.stock_status;
  if (status === 'out') where += ` AND COALESCE(st.qty, 0) <= 0`;
  else if (status === 'low')
    where += ` AND COALESCE(st.qty, 0) > 0 AND COALESCE(st.qty, 0) <= i.reorder_level`;
  else if (status === 'in') where += ` AND COALESCE(st.qty, 0) > i.reorder_level`;
  return where;
}

itemsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const params: any[] = [req.projectId];
    const where = buildFilters(req, params);
    const orderBy = getSort(req, ITEM_SORTS, 'i.item_no ASC');
    const pg = getPagination(req);

    const countResult = await query(
      `SELECT COUNT(*) AS total FROM items i
       LEFT JOIN LATERAL (SELECT SUM(quantity) AS qty FROM stock_levels sl WHERE sl.item_id = i.id) st ON TRUE
       ${where}`,
      params
    );
    const { rows } = await query(
      `${LIST_SELECT} ${where} ORDER BY ${orderBy} LIMIT ${pg.pageSize} OFFSET ${pg.offset}`,
      params
    );
    res.json(paginated(rows.map(shapeItem), Number(countResult.rows[0].total), pg));
  })
);

itemsRouter.get(
  '/lookup',
  asyncHandler(async (req, res) => {
    const barcode = String(req.query.barcode ?? '');
    const { rows } = await query(
      `${LIST_SELECT} WHERE i.project_id = $1 AND i.deleted_at IS NULL
       AND (i.barcode = $2 OR i.item_no = $2) LIMIT 1`,
      [req.projectId, barcode]
    );
    if (!rows[0]) throw notFound(`No item with barcode '${barcode}'`);
    res.json(shapeItem(rows[0]));
  })
);

itemsRouter.get(
  '/export',
  asyncHandler(async (req, res) => {
    const params: any[] = [req.projectId];
    const where = buildFilters(req, params);
    const { rows } = await query(`${LIST_SELECT} ${where} ORDER BY i.item_no`, params);
    const data = rows.map(shapeItem);
    const csv = toCsv(
      data.map((d: any) => ({
        ...d,
        supplier: d.supplier?.name ?? '',
        location: d.default_location?.code ?? '',
        category: d.category?.name ?? '',
      })),
      [
        { header: 'Item No', key: 'item_no' },
        { header: 'Description', key: 'description' },
        { header: 'Specification', key: 'specification' },
        { header: 'Model', key: 'model' },
        { header: 'Supplier', key: 'supplier' },
        { header: 'Department', key: 'department' },
        { header: 'Stock Location', key: 'location' },
        { header: 'Stock Balance', key: 'stock_on_hand' },
        { header: 'Unit Price', key: 'unit_price' },
        { header: 'Currency', key: 'currency' },
        { header: 'Value', key: 'value_native' },
        { header: 'Category', key: 'category' },
        { header: 'ABC', key: 'abc_class' },
        { header: 'Comments', key: 'comments' },
      ]
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="items.csv"');
    res.send(csv);
  })
);

// Bulk import. Body: { rows: [...itemBody], dry_run?: boolean }
// The frontend wizard parses Excel/CSV client-side and posts JSON rows.
itemsRouter.post(
  '/import',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const schema = z.object({
      dry_run: z.boolean().optional().default(true),
      rows: z
        .array(itemBody.extend({ opening_qty: z.number().nonnegative().optional() }))
        .max(20000),
    });
    const { dry_run, rows } = schema.parse(req.body);

    const errors: { row: number; field: string; issue: string }[] = [];
    const seen = new Set<string>();
    const existing = await query(`SELECT item_no FROM items WHERE project_id = $1 AND deleted_at IS NULL`, [
      req.projectId,
    ]);
    const existingNos = new Set(existing.rows.map((r) => r.item_no));

    rows.forEach((row, idx) => {
      if (existingNos.has(row.item_no))
        errors.push({ row: idx + 1, field: 'item_no', issue: `'${row.item_no}' already exists` });
      if (seen.has(row.item_no))
        errors.push({ row: idx + 1, field: 'item_no', issue: `duplicate '${row.item_no}' in file` });
      seen.add(row.item_no);
      if (row.opening_qty && !row.default_location_id)
        errors.push({ row: idx + 1, field: 'default_location_id', issue: 'required when opening_qty is set' });
    });

    const summary = { rows: rows.length, valid: rows.length - new Set(errors.map((e) => e.row)).size, errors: errors.length };
    if (dry_run || errors.length) {
      return res.json({ dry_run: true, committed: false, summary, errors });
    }

    let created = 0;
    await withTransaction(async (client) => {
      for (const row of rows) {
        const { custom = {}, opening_qty, ...fields } = row;
        const defs = await fieldDefsForCategory(client, req.user!.org_id, fields.category_id ?? null);
        const inserted = await client.query(
          `INSERT INTO items (project_id, category_id, item_no, description, specification, model,
                              supplier_id, department, default_location_id, unit_price, currency,
                              reorder_level, max_level, abc_class, barcode, comments, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
          [
            req.projectId, fields.category_id ?? null, fields.item_no, fields.description,
            fields.specification ?? null, fields.model ?? null, fields.supplier_id ?? null,
            fields.department ?? null, fields.default_location_id ?? null, fields.unit_price ?? null,
            fields.currency ?? null, fields.reorder_level ?? 0, fields.max_level ?? null,
            fields.abc_class ?? null, fields.barcode ?? fields.item_no, fields.comments ?? null,
            req.user!.id,
          ]
        );
        const itemId = inserted.rows[0].id;
        const mirror = await saveCustomValues(client, itemId, defs, custom, false);
        if (Object.keys(mirror).length) {
          await client.query('UPDATE items SET custom = $2 WHERE id = $1', [itemId, JSON.stringify(mirror)]);
        }
        if (opening_qty && opening_qty > 0) {
          await client.query(
            `INSERT INTO stock_transactions (project_id, item_id, type, quantity_delta, to_location_id,
                                             unit_price, currency, purpose, performed_by)
             VALUES ($1, $2, 'opening', $3, $4, $5, $6, 'Opening balance (import)', $7)`,
            [req.projectId, itemId, opening_qty, fields.default_location_id, fields.unit_price ?? null,
             fields.currency ?? null, req.user!.id]
          );
        }
        created += 1;
      }
    });
    audit(req, 'items.import', 'item', null, null, { created });
    res.json({ dry_run: false, committed: true, summary: { ...summary, created } });
  })
);

itemsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `${LIST_SELECT} WHERE i.id = $2 AND i.project_id = $1 AND i.deleted_at IS NULL`,
      [req.projectId, req.params.id]
    );
    if (!rows[0]) throw notFound('Item not found');
    const item = shapeItem(rows[0]);

    const [stock, fieldDefs] = await Promise.all([
      query(
        `SELECT sl.location_id, l.code AS location_code, sl.quantity
         FROM stock_levels sl JOIN locations l ON l.id = sl.location_id
         WHERE sl.item_id = $1 AND sl.quantity <> 0 ORDER BY l.code`,
        [item.id]
      ),
      fieldDefsForCategory(pool, req.user!.org_id, item.category_id),
    ]);
    res.json({
      ...item,
      stock_by_location: stock.rows.map((r) => ({ ...r, quantity: Number(r.quantity) })),
      custom_field_defs: fieldDefs,
    });
  })
);

itemsRouter.get(
  '/:id/transactions',
  asyncHandler(async (req, res) => {
    const pg = getPagination(req);
    const count = await query(
      `SELECT COUNT(*) AS total FROM stock_transactions WHERE item_id = $1 AND project_id = $2`,
      [req.params.id, req.projectId]
    );
    const { rows } = await query(
      `SELECT t.*, u.full_name AS performed_by_name,
              fl.code AS from_location_code, tl.code AS to_location_code
       FROM stock_transactions t
       LEFT JOIN users u ON u.id = t.performed_by
       LEFT JOIN locations fl ON fl.id = t.from_location_id
       LEFT JOIN locations tl ON tl.id = t.to_location_id
       WHERE t.item_id = $1 AND t.project_id = $2
       ORDER BY t.performed_at DESC, t.created_at DESC
       LIMIT ${pg.pageSize} OFFSET ${pg.offset}`,
      [req.params.id, req.projectId]
    );
    res.json(
      paginated(rows.map((r) => ({ ...r, quantity_delta: Number(r.quantity_delta) })), Number(count.rows[0].total), pg)
    );
  })
);

itemsRouter.post(
  '/',
  requireRole('technician'),
  asyncHandler(async (req, res) => {
    const body = itemBody.parse(req.body);

    // FR-1.7 duplicate detection: hard-block same item_no (DB unique), warn header on model+supplier
    const dup = await query(
      `SELECT item_no FROM items
       WHERE project_id = $1 AND model = $2 AND supplier_id = $3 AND deleted_at IS NULL LIMIT 1`,
      [req.projectId, body.model ?? null, body.supplier_id ?? null]
    );

    const item = await withTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO items (project_id, category_id, item_no, description, specification, model,
                            supplier_id, department, default_location_id, unit_price, currency,
                            reorder_level, max_level, abc_class, barcode, comments, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
        [
          req.projectId, body.category_id ?? null, body.item_no, body.description,
          body.specification ?? null, body.model ?? null, body.supplier_id ?? null,
          body.department ?? null, body.default_location_id ?? null, body.unit_price ?? null,
          body.currency ?? null, body.reorder_level ?? 0, body.max_level ?? null,
          body.abc_class ?? null, body.barcode ?? body.item_no, body.comments ?? null, req.user!.id,
        ]
      );
      const row = inserted.rows[0];
      const defs = await fieldDefsForCategory(client, req.user!.org_id, body.category_id ?? null);
      const mirror = await saveCustomValues(client, row.id, defs, body.custom ?? {}, true);
      const updated = await client.query('UPDATE items SET custom = $2 WHERE id = $1 RETURNING *', [
        row.id,
        JSON.stringify(mirror),
      ]);
      return updated.rows[0];
    }).catch((err) => {
      if (err?.code === '23505') throw conflict(`Item number '${body.item_no}' already exists in this project`);
      throw err;
    });

    audit(req, 'item.create', 'item', item.id, null, item);
    if (dup.rows[0]) res.setHeader('X-Duplicate-Warning', `Similar item exists: ${dup.rows[0].item_no}`);
    res.status(201).json(item);
  })
);

itemsRouter.patch(
  '/:id',
  requireRole('technician'),
  asyncHandler(async (req, res) => {
    const body = itemBody.partial().parse(req.body);
    const before = await query(`SELECT * FROM items WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`, [
      req.params.id,
      req.projectId,
    ]);
    if (!before.rows[0]) throw notFound('Item not found');

    const item = await withTransaction(async (client) => {
      const { custom, ...fields } = body;
      const cols = Object.keys(fields) as (keyof typeof fields)[];
      if (cols.length) {
        const sets = cols.map((c, idx) => `${c} = $${idx + 3}`).join(', ');
        await client.query(
          `UPDATE items SET ${sets}, updated_at = now() WHERE id = $1 AND project_id = $2`,
          [req.params.id, req.projectId, ...cols.map((c) => fields[c] ?? null)]
        );
      }
      if (custom) {
        const categoryId = (body.category_id ?? before.rows[0].category_id) || null;
        const defs = await fieldDefsForCategory(client, req.user!.org_id, categoryId);
        const merged = { ...before.rows[0].custom, ...custom };
        const mirror = await saveCustomValues(client, req.params.id, defs, merged, false);
        await client.query('UPDATE items SET custom = $2, updated_at = now() WHERE id = $1', [
          req.params.id,
          JSON.stringify(mirror),
        ]);
      }
      const { rows } = await client.query('SELECT * FROM items WHERE id = $1', [req.params.id]);
      return rows[0];
    });

    audit(req, 'item.update', 'item', item.id, before.rows[0], item);
    res.json(item);
  })
);

itemsRouter.delete(
  '/:id',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `UPDATE items SET deleted_at = now(), is_active = FALSE, updated_at = now()
       WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL RETURNING id`,
      [req.params.id, req.projectId]
    );
    if (!rows[0]) throw notFound('Item not found');
    audit(req, 'item.archive', 'item', req.params.id);
    res.status(204).end();
  })
);
