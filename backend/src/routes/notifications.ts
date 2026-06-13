import { Router } from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../utils/http.js';

export const notificationsRouter = Router();

interface Notification {
  type: 'low_stock' | 'pending_approval';
  severity: 'info' | 'warning';
  count: number;
  message: string;
  link: string;
}

/**
 * GET /me/notifications -> in-app alerts for the active project (docs/04_API §Notifications).
 * Surfaces low-stock items in the current project and, for org admins, users awaiting
 * approval. Only non-zero alerts are returned so the UI can badge the count directly.
 */
notificationsRouter.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const notifications: Notification[] = [];

    const lowStock = await query(
      `SELECT count(*)::int AS count FROM v_reorder WHERE project_id = $1`,
      [req.projectId]
    );
    const lowCount = lowStock.rows[0].count;
    if (lowCount > 0) {
      notifications.push({
        type: 'low_stock',
        severity: 'warning',
        count: lowCount,
        message: `${lowCount} item${lowCount === 1 ? '' : 's'} at or below reorder level`,
        link: '/reports/reorder',
      });
    }

    if (req.user!.is_org_admin) {
      const pending = await query(
        `SELECT count(*)::int AS count FROM users
         WHERE org_id = $1 AND approval_status = 'pending' AND deleted_at IS NULL`,
        [req.user!.org_id]
      );
      const pendingCount = pending.rows[0].count;
      if (pendingCount > 0) {
        notifications.push({
          type: 'pending_approval',
          severity: 'info',
          count: pendingCount,
          message: `${pendingCount} user${pendingCount === 1 ? '' : 's'} awaiting approval`,
          link: '/admin/users',
        });
      }
    }

    const total = notifications.reduce((sum, n) => sum + n.count, 0);
    res.json({ data: notifications, total });
  })
);
