import { Router } from 'express';
import { query } from '../db.js';
import { config } from '../config.js';
import { asyncHandler, toCsv } from '../utils/http.js';

export const reportsRouter = Router();

function sendReport(res: any, format: any, rows: any[], columns: { header: string; key: string }[], name: string) {
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
    return res.send(toCsv(rows, columns));
  }
  res.json({ data: rows });
}

// Latest rate from each currency to `base` effective on/before `asOf` (rate 1 for base itself).
async function rateMap(orgId: string, base: string, asOf: string): Promise<Map<string, number>> {
  const { rows } = await query(
    `SELECT DISTINCT ON (from_currency) from_currency, rate
     FROM exchange_rates
     WHERE org_id = $1 AND to_currency = $2 AND effective_date <= $3
     ORDER BY from_currency, effective_date DESC`,
    [orgId, base, asOf]
  );
  const map = new Map<string, number>(rows.map((r) => [r.from_currency, Number(r.rate)]));
  map.set(base, 1);
  return map;
}

// FR-7.3 / FR-7.5: stock valuation converted to base currency
reportsRouter.get(
  '/valuation',
  asyncHandler(async (req, res) => {
    const base = String(req.query.base_currency ?? config.defaultBaseCurrency).toUpperCase();
    const asOf = String(req.query.as_of ?? new Date().toISOString().slice(0, 10));
    const rates = await rateMap(req.user!.org_id, base, asOf);

    const { rows } = await query(
      `SELECT v.item_id, v.item_no, v.description, v.stock_on_hand, v.unit_price, v.currency,
              v.value_native, c.name AS category
       FROM v_item_valuation v
       LEFT JOIN categories c ON c.id = v.category_id
       WHERE v.project_id = $1 ORDER BY v.item_no`,
      [req.projectId]
    );

    const data = rows.map((r) => {
      const rate = r.currency ? rates.get(r.currency.trim()) ?? null : null;
      const valueNative = Number(r.value_native);
      return {
        ...r,
        stock_on_hand: Number(r.stock_on_hand),
        unit_price: r.unit_price === null ? null : Number(r.unit_price),
        value_native: valueNative,
        rate_to_base: rate,
        value_base: rate === null ? null : Math.round(valueNative * rate * 100) / 100,
        base_currency: base,
      };
    });
    const total = data.reduce((sum, r) => sum + (r.value_base ?? 0), 0);

    if (req.query.format === 'csv') {
      return sendReport(res, 'csv', data, [
        { header: 'Item No', key: 'item_no' }, { header: 'Description', key: 'description' },
        { header: 'Category', key: 'category' }, { header: 'On Hand', key: 'stock_on_hand' },
        { header: 'Unit Price', key: 'unit_price' }, { header: 'Currency', key: 'currency' },
        { header: 'Value (native)', key: 'value_native' }, { header: `Value (${base})`, key: 'value_base' },
      ], 'valuation');
    }
    res.json({ data, summary: { base_currency: base, as_of: asOf, total_value_base: Math.round(total * 100) / 100 } });
  })
);

reportsRouter.get(
  '/movements',
  asyncHandler(async (req, res) => {
    const params: any[] = [req.projectId];
    let where = `WHERE t.project_id = $1`;
    if (req.query.type) { params.push(req.query.type); where += ` AND t.type = $${params.length}`; }
    if (req.query.date_from) { params.push(req.query.date_from); where += ` AND t.performed_at >= $${params.length}`; }
    if (req.query.date_to) { params.push(req.query.date_to); where += ` AND t.performed_at < ($${params.length}::date + 1)`; }

    const { rows } = await query(
      `SELECT t.type, COUNT(*) AS txn_count,
              SUM(CASE WHEN t.quantity_delta > 0 THEN t.quantity_delta ELSE 0 END) AS qty_in,
              SUM(CASE WHEN t.quantity_delta < 0 THEN -t.quantity_delta ELSE 0 END) AS qty_out
       FROM stock_transactions t ${where} GROUP BY t.type ORDER BY t.type`,
      params
    );
    const data = rows.map((r) => ({
      type: r.type, txn_count: Number(r.txn_count), qty_in: Number(r.qty_in), qty_out: Number(r.qty_out),
    }));
    sendReport(res, req.query.format, data, [
      { header: 'Type', key: 'type' }, { header: 'Transactions', key: 'txn_count' },
      { header: 'Qty In', key: 'qty_in' }, { header: 'Qty Out', key: 'qty_out' },
    ], 'movements');
  })
);

reportsRouter.get(
  '/reorder',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT r.item_no, r.description, r.stock_on_hand, r.reorder_level,
              s.name AS supplier, s.lead_time_days
       FROM v_reorder r
       JOIN items i ON i.id = r.item_id
       LEFT JOIN suppliers s ON s.id = i.supplier_id
       WHERE r.project_id = $1 ORDER BY (r.stock_on_hand - r.reorder_level)`,
      [req.projectId]
    );
    const data = rows.map((r) => ({
      ...r, stock_on_hand: Number(r.stock_on_hand), reorder_level: Number(r.reorder_level),
    }));
    sendReport(res, req.query.format, data, [
      { header: 'Item No', key: 'item_no' }, { header: 'Description', key: 'description' },
      { header: 'On Hand', key: 'stock_on_hand' }, { header: 'Reorder Level', key: 'reorder_level' },
      { header: 'Supplier', key: 'supplier' }, { header: 'Lead Time (days)', key: 'lead_time_days' },
    ], 'reorder');
  })
);

// FR-6.3: ABC classification by value share (A: top 80%, B: next 15%, C: rest)
reportsRouter.get(
  '/abc',
  asyncHandler(async (req, res) => {
    const base = String(req.query.base_currency ?? config.defaultBaseCurrency).toUpperCase();
    const asOf = new Date().toISOString().slice(0, 10);
    const rates = await rateMap(req.user!.org_id, base, asOf);

    const { rows } = await query(
      `SELECT v.item_id, v.item_no, v.description, v.stock_on_hand, v.value_native, v.currency
       FROM v_item_valuation v WHERE v.project_id = $1`,
      [req.projectId]
    );
    const valued = rows
      .map((r) => ({
        ...r,
        stock_on_hand: Number(r.stock_on_hand),
        value_base: Number(r.value_native) * (r.currency ? rates.get(r.currency.trim()) ?? 0 : 0),
      }))
      .sort((a, b) => b.value_base - a.value_base);

    const total = valued.reduce((s, r) => s + r.value_base, 0) || 1;
    let cumulative = 0;
    const data = valued.map((r) => {
      cumulative += r.value_base;
      const share = cumulative / total;
      return {
        ...r,
        value_base: Math.round(r.value_base * 100) / 100,
        abc_class: share <= 0.8 ? 'A' : share <= 0.95 ? 'B' : 'C',
      };
    });
    sendReport(res, req.query.format, data, [
      { header: 'Item No', key: 'item_no' }, { header: 'Description', key: 'description' },
      { header: 'On Hand', key: 'stock_on_hand' }, { header: `Value (${base})`, key: 'value_base' },
      { header: 'ABC', key: 'abc_class' },
    ], 'abc');
  })
);

reportsRouter.get(
  '/write-offs',
  asyncHandler(async (req, res) => {
    const params: any[] = [req.projectId];
    let where = `WHERE t.project_id = $1 AND t.type = 'write_off'`;
    if (req.query.date_from) { params.push(req.query.date_from); where += ` AND t.performed_at >= $${params.length}`; }
    if (req.query.date_to) { params.push(req.query.date_to); where += ` AND t.performed_at < ($${params.length}::date + 1)`; }
    const { rows } = await query(
      `SELECT t.performed_at, i.item_no, i.description, -t.quantity_delta AS quantity,
              t.unit_price, t.currency, t.purpose, u.full_name AS performed_by
       FROM stock_transactions t
       JOIN items i ON i.id = t.item_id
       LEFT JOIN users u ON u.id = t.performed_by
       ${where} ORDER BY t.performed_at DESC`,
      params
    );
    const data = rows.map((r) => ({ ...r, quantity: Number(r.quantity) }));
    sendReport(res, req.query.format, data, [
      { header: 'Date', key: 'performed_at' }, { header: 'Item No', key: 'item_no' },
      { header: 'Description', key: 'description' }, { header: 'Qty', key: 'quantity' },
      { header: 'Unit Price', key: 'unit_price' }, { header: 'Currency', key: 'currency' },
      { header: 'Purpose', key: 'purpose' }, { header: 'By', key: 'performed_by' },
    ], 'write-offs');
  })
);
