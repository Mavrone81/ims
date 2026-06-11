import { Router } from 'express';
import { query } from '../db.js';
import { asyncHandler, getPagination, paginated } from '../utils/http.js';
import { requireRole } from '../middleware/auth.js';

export const auditRouter = Router();

auditRouter.get(
  '/',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const params: any[] = [req.user!.org_id];
    let where = `WHERE a.org_id = $1`;
    const add = (clause: string, value: any) => {
      params.push(value);
      where += ` AND ${clause.replace('?', `$${params.length}`)}`;
    };
    if (req.query.entity_type) add('a.entity_type = ?', req.query.entity_type);
    if (req.query.entity_id) add('a.entity_id = ?', req.query.entity_id);
    if (req.query.user_id) add('a.user_id = ?', req.query.user_id);
    if (req.query.date_from) add('a.created_at >= ?', req.query.date_from);
    if (req.query.date_to) add('a.created_at < (?::date + 1)', req.query.date_to);

    const pg = getPagination(req);
    const count = await query(`SELECT COUNT(*) AS total FROM audit_logs a ${where}`, params);
    const { rows } = await query(
      `SELECT a.*, u.full_name AS user_name FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       ${where} ORDER BY a.created_at DESC LIMIT ${pg.pageSize} OFFSET ${pg.offset}`,
      params
    );
    res.json(paginated(rows, Number(count.rows[0].total), pg));
  })
);
