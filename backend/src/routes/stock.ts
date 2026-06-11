import { Router } from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../utils/http.js';

export const stockRouter = Router();

stockRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const params: any[] = [req.projectId];
    let where = `WHERE i.project_id = $1 AND i.deleted_at IS NULL AND sl.quantity <> 0`;
    if (req.query.item_id) {
      params.push(req.query.item_id);
      where += ` AND sl.item_id = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT sl.item_id, i.item_no, i.description, sl.location_id, l.code AS location_code,
              sl.quantity, sl.updated_at
       FROM stock_levels sl
       JOIN items i ON i.id = sl.item_id
       JOIN locations l ON l.id = sl.location_id
       ${where} ORDER BY i.item_no, l.code`,
      params
    );
    res.json({ data: rows.map((r) => ({ ...r, quantity: Number(r.quantity) })) });
  })
);

stockRouter.get(
  '/low',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT r.item_id, r.item_no, r.description, r.stock_on_hand, r.reorder_level,
              s.name AS supplier, i.unit_price, i.currency
       FROM v_reorder r
       JOIN items i ON i.id = r.item_id
       LEFT JOIN suppliers s ON s.id = i.supplier_id
       WHERE r.project_id = $1
       ORDER BY (r.stock_on_hand - r.reorder_level), r.item_no`,
      [req.projectId]
    );
    res.json({
      data: rows.map((r) => ({
        ...r,
        stock_on_hand: Number(r.stock_on_hand),
        reorder_level: Number(r.reorder_level),
      })),
    });
  })
);
