import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { notFound, conflict, badRequest, businessRule } from '../errors.js';
import { asyncHandler, getPagination, paginated } from '../utils/http.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';

// Lightweight purchase orders (PRD FR-5.3, docs/04_API.md §10).
// A PO is a draft → ordered → partial → received workflow; receiving a line
// posts a `receipt` stock_transaction so on-hand stays derived from the ledger.
export const purchaseOrdersRouter = Router();

const lineBody = z.object({
  item_id: z.string().uuid(),
  qty_ordered: z.number().positive(),
  unit_price: z.number().nonnegative().nullish(),
});

const poBody = z.object({
  supplier_id: z.string().uuid(),
  po_number: z.string().min(1),
  status: z.enum(['draft', 'ordered', 'cancelled']).optional(),
  currency: z.string().length(3).nullish(),
  ordered_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  expected_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  lines: z.array(lineBody).min(1),
});

const shapePo = (r: any) => ({
  ...r,
  line_count: r.line_count === undefined ? undefined : Number(r.line_count),
  total_value: r.total_value === undefined ? undefined : Number(r.total_value),
});

async function loadPo(projectId: string, id: string) {
  const { rows } = await query(
    `SELECT po.*, s.name AS supplier_name FROM purchase_orders po
     JOIN suppliers s ON s.id = po.supplier_id
     WHERE po.id = $1 AND po.project_id = $2`,
    [id, projectId]
  );
  if (!rows[0]) return null;
  const lines = await query(
    `SELECT l.id, l.item_id, l.qty_ordered, l.qty_received, l.unit_price,
            i.item_no, i.description, i.default_location_id
     FROM purchase_order_lines l JOIN items i ON i.id = l.item_id
     WHERE l.po_id = $1 ORDER BY i.item_no`,
    [id]
  );
  return {
    ...shapePo(rows[0]),
    lines: lines.rows.map((l) => ({
      ...l,
      qty_ordered: Number(l.qty_ordered),
      qty_received: Number(l.qty_received),
      unit_price: l.unit_price === null ? null : Number(l.unit_price),
    })),
  };
}

purchaseOrdersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const params: any[] = [req.projectId];
    let where = `WHERE po.project_id = $1`;
    if (req.query.status) { params.push(req.query.status); where += ` AND po.status = $${params.length}`; }
    if (req.query.supplier_id) { params.push(req.query.supplier_id); where += ` AND po.supplier_id = $${params.length}`; }

    const pg = getPagination(req);
    const count = await query(`SELECT COUNT(*) AS total FROM purchase_orders po ${where}`, params);
    const { rows } = await query(
      `SELECT po.id, po.po_number, po.status, po.currency, po.ordered_at, po.expected_at,
              po.created_at, po.supplier_id, s.name AS supplier_name,
              (SELECT count(*) FROM purchase_order_lines l WHERE l.po_id = po.id) AS line_count,
              (SELECT COALESCE(SUM(l.qty_ordered * COALESCE(l.unit_price, 0)), 0)
                 FROM purchase_order_lines l WHERE l.po_id = po.id) AS total_value
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       ${where} ORDER BY po.created_at DESC LIMIT ${pg.pageSize} OFFSET ${pg.offset}`,
      params
    );
    res.json(paginated(rows.map(shapePo), Number(count.rows[0].total), pg));
  })
);

purchaseOrdersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const po = await loadPo(req.projectId!, req.params.id);
    if (!po) throw notFound('Purchase order not found');
    res.json(po);
  })
);

purchaseOrdersRouter.post(
  '/',
  requireRole('technician'),
  asyncHandler(async (req, res) => {
    const body = poBody.parse(req.body);

    const supplier = await query(
      `SELECT id FROM suppliers WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
      [body.supplier_id, req.user!.org_id]
    );
    if (!supplier.rows[0]) throw notFound('Supplier not found');

    // Every line item must belong to the active project.
    const itemIds = body.lines.map((l) => l.item_id);
    const owned = await query(
      `SELECT id FROM items WHERE id = ANY($1) AND project_id = $2 AND deleted_at IS NULL`,
      [itemIds, req.projectId]
    );
    if (owned.rows.length !== new Set(itemIds).size) {
      throw badRequest('Every line item must be an active item in this project');
    }

    const po = await withTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO purchase_orders (project_id, supplier_id, po_number, status, currency,
                                      ordered_at, expected_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [req.projectId, body.supplier_id, body.po_number, body.status ?? 'draft',
         body.currency ?? null, body.ordered_at ?? null, body.expected_at ?? null, req.user!.id]
      );
      const poId = inserted.rows[0].id;
      for (const line of body.lines) {
        await client.query(
          `INSERT INTO purchase_order_lines (po_id, item_id, qty_ordered, unit_price)
           VALUES ($1,$2,$3,$4)`,
          [poId, line.item_id, line.qty_ordered, line.unit_price ?? null]
        );
      }
      return poId;
    }).catch((err: any) => {
      if (err?.code === '23505') throw conflict(`PO number '${body.po_number}' already exists in this project`);
      throw err;
    });

    const created = await loadPo(req.projectId!, po);
    audit(req, 'po.create', 'purchase_order', po, null, created);
    res.status(201).json(created);
  })
);

purchaseOrdersRouter.patch(
  '/:id',
  requireRole('technician'),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        po_number: z.string().min(1).optional(),
        status: z.enum(['draft', 'ordered', 'partial', 'received', 'cancelled']).optional(),
        currency: z.string().length(3).nullish(),
        ordered_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
        expected_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
      })
      .parse(req.body);
    const cols = Object.keys(body) as (keyof typeof body)[];
    if (!cols.length) throw badRequest('Nothing to update');
    const sets = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
    const { rows } = await query(
      `UPDATE purchase_orders SET ${sets}, updated_at = now()
       WHERE id = $1 AND project_id = $2 RETURNING id`,
      [req.params.id, req.projectId, ...cols.map((c) => body[c] ?? null)]
    ).catch((err: any) => {
      if (err?.code === '23505') throw conflict(`PO number '${body.po_number}' already exists in this project`);
      throw err;
    });
    if (!rows[0]) throw notFound('Purchase order not found');
    const updated = await loadPo(req.projectId!, req.params.id);
    audit(req, 'po.update', 'purchase_order', req.params.id, null, updated);
    res.json(updated);
  })
);

// Receive against a PO: posts a `receipt` transaction per line and advances the
// PO status (partial → received). Over-receipt beyond what is outstanding is blocked.
purchaseOrdersRouter.post(
  '/:id/receive',
  requireRole('technician'),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        reference: z.string().nullish(),
        lines: z
          .array(z.object({
            line_id: z.string().uuid(),
            qty: z.number().positive(),
            to_location_id: z.string().uuid().nullish(),
          }))
          .min(1),
      })
      .parse(req.body);

    const result = await withTransaction(async (client) => {
      const poResult = await client.query(
        `SELECT * FROM purchase_orders WHERE id = $1 AND project_id = $2 FOR UPDATE`,
        [req.params.id, req.projectId]
      );
      const po = poResult.rows[0];
      if (!po) throw notFound('Purchase order not found');
      if (po.status === 'cancelled') throw businessRule('Cannot receive against a cancelled purchase order');

      for (const recv of body.lines) {
        const lineResult = await client.query(
          `SELECT l.*, i.default_location_id, i.currency AS item_currency
           FROM purchase_order_lines l JOIN items i ON i.id = l.item_id
           WHERE l.id = $1 AND l.po_id = $2 FOR UPDATE`,
          [recv.line_id, po.id]
        );
        const line = lineResult.rows[0];
        if (!line) throw badRequest(`Line ${recv.line_id} is not on this purchase order`);

        const outstanding = Number(line.qty_ordered) - Number(line.qty_received);
        if (recv.qty > outstanding) {
          throw businessRule(
            `Cannot receive ${recv.qty}; only ${outstanding} outstanding on that line`
          );
        }
        const toLocation = recv.to_location_id ?? line.default_location_id;
        if (!toLocation) {
          throw badRequest('to_location_id is required (line item has no default location)');
        }

        await client.query(
          `INSERT INTO stock_transactions (project_id, item_id, type, label, quantity_delta,
                                           to_location_id, unit_price, currency, purpose, reference, performed_by)
           VALUES ($1,$2,'receipt','Receipt',$3,$4,$5,$6,$7,$8,$9)`,
          [req.projectId, line.item_id, recv.qty, toLocation,
           line.unit_price ?? null, po.currency ?? line.item_currency ?? null,
           `PO ${po.po_number} received`, body.reference ?? po.po_number, req.user!.id]
        );
        await client.query(
          `UPDATE purchase_order_lines SET qty_received = qty_received + $2 WHERE id = $1`,
          [line.id, recv.qty]
        );
      }

      // Recompute status from line fulfilment.
      const totals = await client.query(
        `SELECT COALESCE(SUM(qty_ordered), 0) AS ordered, COALESCE(SUM(qty_received), 0) AS received
         FROM purchase_order_lines WHERE po_id = $1`,
        [po.id]
      );
      const ordered = Number(totals.rows[0].ordered);
      const received = Number(totals.rows[0].received);
      const status = received >= ordered ? 'received' : received > 0 ? 'partial' : po.status;
      await client.query(`UPDATE purchase_orders SET status = $2, updated_at = now() WHERE id = $1`, [po.id, status]);
      return po.id;
    });

    const updated = await loadPo(req.projectId!, result);
    audit(req, 'po.receive', 'purchase_order', result, null, updated);
    res.json(updated);
  })
);
