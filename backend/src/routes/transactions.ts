import { Router } from 'express';
import { z } from 'zod';
import type pg from 'pg';
import { query, withTransaction } from '../db.js';
import { config } from '../config.js';
import { notFound, badRequest, businessRule, forbidden } from '../errors.js';
import { asyncHandler, getPagination, paginated } from '../utils/http.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';

export const transactionsRouter = Router();

const txnBody = z.object({
  type: z.enum(['receipt', 'issue', 'adjustment', 'transfer', 'write_off']),
  item_id: z.string().uuid(),
  quantity: z.number().refine((n) => n !== 0, 'quantity must not be zero'),
  from_location_id: z.string().uuid().nullish(),
  to_location_id: z.string().uuid().nullish(),
  unit_price: z.number().nonnegative().nullish(),
  currency: z.string().length(3).nullish(),
  purpose: z.string().nullish(),
  reference: z.string().nullish(),
  performed_at: z.string().datetime({ offset: true }).nullish(),
});

async function locationStock(client: pg.PoolClient, itemId: string, locationId: string): Promise<number> {
  const { rows } = await client.query(
    `SELECT quantity FROM stock_levels WHERE item_id = $1 AND location_id = $2 FOR UPDATE`,
    [itemId, locationId]
  );
  return rows[0] ? Number(rows[0].quantity) : 0;
}

async function totalStock(client: pg.PoolClient | typeof import('../db.js').pool, itemId: string): Promise<number> {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(quantity), 0) AS qty FROM stock_levels WHERE item_id = $1`,
    [itemId]
  );
  return Number(rows[0].qty);
}

const TXN_SELECT = `
  SELECT t.*, u.full_name AS performed_by_name, i.item_no, i.description AS item_description,
         fl.code AS from_location_code, tl.code AS to_location_code
  FROM stock_transactions t
  LEFT JOIN users u ON u.id = t.performed_by
  LEFT JOIN items i ON i.id = t.item_id
  LEFT JOIN locations fl ON fl.id = t.from_location_id
  LEFT JOIN locations tl ON tl.id = t.to_location_id`;

const shapeTxn = (r: any) => ({ ...r, quantity_delta: Number(r.quantity_delta) });

transactionsRouter.post(
  '/',
  requireRole('technician'),
  asyncHandler(async (req, res) => {
    const body = txnBody.parse(req.body);
    const qty = Math.abs(body.quantity);

    const itemResult = await query(
      `SELECT id, unit_price, currency FROM items WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
      [body.item_id, req.projectId]
    );
    const item = itemResult.rows[0];
    if (!item) throw notFound('Item not found in this project');

    // FR-2.6: write-offs above threshold need manager approval (role-gated here)
    if (body.type === 'write_off') {
      const threshold =
        Number(req.projectSettings?.write_off_approval_threshold ?? config.writeOffApprovalThreshold);
      const value = qty * Number(body.unit_price ?? item.unit_price ?? 0);
      const isManager = req.projectRole === 'manager' || req.projectRole === 'admin';
      if (value > threshold && !isManager) {
        throw forbidden(
          `Write-off value (${value.toFixed(2)}) exceeds the approval threshold (${threshold}); a manager must record it`
        );
      }
    }

    // Location requirements + sign conventions (see migration trigger comment)
    let delta: number;
    let fromLoc = body.from_location_id ?? null;
    let toLoc = body.to_location_id ?? null;
    switch (body.type) {
      case 'receipt':
        if (!toLoc) throw badRequest('to_location_id is required for a receipt');
        fromLoc = null;
        delta = qty;
        break;
      case 'issue':
      case 'write_off':
        if (!fromLoc) throw badRequest(`from_location_id is required for ${body.type}`);
        toLoc = null;
        delta = -qty;
        break;
      case 'transfer':
        if (!fromLoc || !toLoc) throw badRequest('transfer requires from_location_id and to_location_id');
        if (fromLoc === toLoc) throw badRequest('transfer locations must differ');
        delta = qty;
        break;
      case 'adjustment':
        if (!toLoc) throw badRequest('to_location_id (the adjusted location) is required for an adjustment');
        fromLoc = null;
        delta = body.quantity; // signed as given
        break;
    }

    const allowNegative =
      req.projectSettings?.allow_negative_stock ?? config.allowNegativeStock;

    const txn = await withTransaction(async (client) => {
      // FR-2.5: block over-issue unless negative stock allowed
      const outgoing = body.type === 'issue' || body.type === 'write_off' || body.type === 'transfer';
      if (outgoing && !allowNegative) {
        const available = await locationStock(client, body.item_id, fromLoc!);
        if (available < qty) {
          throw businessRule(
            `Insufficient stock: ${available} available at the source location, ${qty} requested`
          );
        }
      }
      if (body.type === 'adjustment' && delta < 0 && !allowNegative) {
        const available = await locationStock(client, body.item_id, toLoc!);
        if (available + delta < 0) {
          throw businessRule(`Adjustment would make stock negative (${available} on hand)`);
        }
      }

      const inserted = await client.query(
        `INSERT INTO stock_transactions (project_id, item_id, type, quantity_delta, from_location_id,
                                         to_location_id, unit_price, currency, purpose, reference,
                                         performed_by, performed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, COALESCE($12, now())) RETURNING *`,
        [
          req.projectId, body.item_id, body.type, delta, fromLoc, toLoc,
          body.unit_price ?? item.unit_price ?? null, body.currency ?? item.currency ?? null,
          body.purpose ?? null, body.reference ?? null, req.user!.id, body.performed_at ?? null,
        ]
      );
      const row = inserted.rows[0];
      return { ...shapeTxn(row), stock_on_hand: await totalStock(client, body.item_id) };
    });

    audit(req, 'txn.create', 'stock_transaction', txn.id, null, txn);
    res.status(201).json(txn);
  })
);

transactionsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const params: any[] = [req.projectId];
    let where = ` WHERE t.project_id = $1`;
    const add = (clause: string, value: any) => {
      params.push(value);
      where += ` AND ${clause.replace('?', `$${params.length}`)}`;
    };
    if (req.query.item_id) add('t.item_id = ?', req.query.item_id);
    if (req.query.type) add('t.type = ?', req.query.type);
    if (req.query.user_id) add('t.performed_by = ?', req.query.user_id);
    if (req.query.reference) add('t.reference ILIKE ?', `%${req.query.reference}%`);
    if (req.query.location_id) {
      params.push(req.query.location_id);
      where += ` AND (t.from_location_id = $${params.length} OR t.to_location_id = $${params.length})`;
    }
    if (req.query.date_from) add('t.performed_at >= ?', req.query.date_from);
    if (req.query.date_to) add('t.performed_at < (?::date + 1)', req.query.date_to);

    const pg = getPagination(req);
    const count = await query(`SELECT COUNT(*) AS total FROM stock_transactions t ${where}`, params);
    const { rows } = await query(
      `${TXN_SELECT} ${where} ORDER BY t.performed_at DESC, t.created_at DESC
       LIMIT ${pg.pageSize} OFFSET ${pg.offset}`,
      params
    );
    res.json(paginated(rows.map(shapeTxn), Number(count.rows[0].total), pg));
  })
);

transactionsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await query(`${TXN_SELECT} WHERE t.id = $1 AND t.project_id = $2`, [
      req.params.id,
      req.projectId,
    ]);
    if (!rows[0]) throw notFound('Transaction not found');
    res.json(shapeTxn(rows[0]));
  })
);

// FR-2.4: ledger is immutable — corrections are reversing entries.
transactionsRouter.post(
  '/:id/reverse',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().min(1) }).parse(req.body);
    const original = await query(
      `SELECT * FROM stock_transactions WHERE id = $1 AND project_id = $2`,
      [req.params.id, req.projectId]
    );
    const txn = original.rows[0];
    if (!txn) throw notFound('Transaction not found');

    const already = await query(`SELECT id FROM stock_transactions WHERE reverses_txn_id = $1`, [txn.id]);
    if (already.rows[0]) throw businessRule('This transaction has already been reversed');

    const reversal = await withTransaction(async (client) => {
      // Transfers reverse by swapping locations; others negate the delta.
      const isTransfer = txn.type === 'transfer';
      const inserted = await client.query(
        `INSERT INTO stock_transactions (project_id, item_id, type, quantity_delta, from_location_id,
                                         to_location_id, unit_price, currency, purpose, reference,
                                         reverses_txn_id, performed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [
          txn.project_id, txn.item_id, txn.type,
          isTransfer ? Number(txn.quantity_delta) : -Number(txn.quantity_delta),
          isTransfer ? txn.to_location_id : txn.from_location_id,
          isTransfer ? txn.from_location_id : txn.to_location_id,
          txn.unit_price, txn.currency,
          `REVERSAL: ${reason}`, txn.reference, txn.id, req.user!.id,
        ]
      );
      return inserted.rows[0];
    });

    audit(req, 'txn.reverse', 'stock_transaction', txn.id, txn, reversal);
    res.status(201).json(shapeTxn(reversal));
  })
);
