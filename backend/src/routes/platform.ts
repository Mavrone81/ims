import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { unauthorized, notFound } from '../errors.js';
import { asyncHandler } from '../utils/http.js';
import { loginRateLimit } from '../middleware/loginRateLimit.js';
import { seedTxnLabels } from './txnLabels.js';

// Platform admin console: a layer above organizations. Tokens carry
// { platform: true } and are NOT interchangeable with org-user tokens.
export const platformRouter = Router();

async function authenticatePlatform(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    let payload: any;
    try {
      payload = jwt.verify(header.slice(7), config.jwtAccessSecret);
    } catch {
      throw unauthorized('Invalid or expired token');
    }
    if (!payload.platform) throw unauthorized('Not a platform token');
    const { rows } = await query(
      `SELECT id, username, full_name FROM platform_admins WHERE id = $1 AND is_active`,
      [payload.sub]
    );
    if (!rows[0]) throw unauthorized('Platform admin no longer active');
    (req as any).platformAdmin = rows[0];
    next();
  } catch (err) {
    next(err);
  }
}

platformRouter.post(
  '/auth/login',
  loginRateLimit,
  asyncHandler(async (req, res) => {
    const { username, password } = z
      .object({ username: z.string().min(1), password: z.string().min(1) })
      .parse(req.body);
    const { rows } = await query(
      `SELECT id, username, full_name, password_hash FROM platform_admins
       WHERE username = $1 AND is_active`,
      [username]
    );
    const admin = rows[0];
    if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
      throw unauthorized('Invalid username or password');
    }
    await query('UPDATE platform_admins SET last_login_at = now() WHERE id = $1', [admin.id]);
    res.json({
      access_token: jwt.sign({ sub: admin.id, platform: true }, config.jwtAccessSecret, {
        expiresIn: '12h',
      }),
      admin: { id: admin.id, username: admin.username, full_name: admin.full_name },
    });
  })
);

platformRouter.use(authenticatePlatform);

platformRouter.get(
  '/orgs',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `SELECT o.id, o.name, o.base_currency, o.is_active, o.require_user_approval, o.created_at,
              (SELECT count(*) FROM users u WHERE u.org_id = o.id AND u.deleted_at IS NULL) AS user_count,
              (SELECT count(*) FROM sites s WHERE s.org_id = o.id AND s.deleted_at IS NULL) AS site_count,
              (SELECT count(*) FROM items i JOIN projects p ON p.id = i.project_id
               JOIN sites s ON s.id = p.site_id
               WHERE s.org_id = o.id AND i.deleted_at IS NULL) AS item_count
       FROM organizations o ORDER BY o.created_at`
    );
    res.json({
      data: rows.map((r) => ({
        ...r,
        user_count: Number(r.user_count),
        site_count: Number(r.site_count),
        item_count: Number(r.item_count),
      })),
    });
  })
);

// Provision a company: org + default site/project + its org-admin login.
platformRouter.post(
  '/orgs',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().min(2),
        base_currency: z.string().length(3).default('USD'),
        admin_username: z.string().min(2).regex(/^[a-zA-Z0-9._-]+$/, 'letters, digits, . _ - only'),
        admin_password: z.string().min(8),
        admin_full_name: z.string().min(1),
        admin_email: z.string().email().nullish(),
        site_code: z.string().min(1).default('MAIN'),
        site_name: z.string().min(1).optional(),
        project_code: z.string().min(1).default('DEFAULT'),
        project_name: z.string().min(1).optional(),
      })
      .parse(req.body);

    const result = await withTransaction(async (c) => {
      const cur = body.base_currency.toUpperCase();
      await c.query(`INSERT INTO currencies (code, name) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING`, [cur, cur]);
      const org = (
        await c.query(`INSERT INTO organizations (name, base_currency) VALUES ($1, $2) RETURNING id, name`, [
          body.name, cur,
        ])
      ).rows[0];
      const site = (
        await c.query(`INSERT INTO sites (org_id, code, name) VALUES ($1, $2, $3) RETURNING id`, [
          org.id, body.site_code, body.site_name ?? `${body.name} main site`,
        ])
      ).rows[0];
      const project = (
        await c.query(`INSERT INTO projects (site_id, code, name) VALUES ($1, $2, $3) RETURNING id, name`, [
          site.id, body.project_code, body.project_name ?? 'Main inventory',
        ])
      ).rows[0];
      const hash = await bcrypt.hash(body.admin_password, config.saltRounds);
      const admin = (
        await c.query(
          `INSERT INTO users (org_id, username, email, full_name, password_hash, is_org_admin)
           VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING id, username`,
          [org.id, body.admin_username, body.admin_email ?? null, body.admin_full_name, hash]
        )
      ).rows[0];
      await seedTxnLabels(c, org.id);
      await c.query(
        `INSERT INTO audit_logs (org_id, action, entity_type, entity_id, after)
         VALUES ($1, 'platform.org_create', 'organization', $1, $2)`,
        [org.id, JSON.stringify({ name: org.name, by: (req as any).platformAdmin.username })]
      );
      return { org_id: org.id, name: org.name, project: project.name, admin_username: admin.username };
    });

    res.status(201).json(result);
  })
);

platformRouter.patch(
  '/orgs/:id',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().min(2).optional(),
        is_active: z.boolean().optional(),
        require_user_approval: z.boolean().optional(),
      })
      .parse(req.body);
    const { rows } = await query(
      `UPDATE organizations SET name = COALESCE($2, name), is_active = COALESCE($3, is_active),
              require_user_approval = COALESCE($4, require_user_approval), updated_at = now()
       WHERE id = $1 RETURNING id, name, is_active, require_user_approval`,
      [req.params.id, body.name ?? null, body.is_active ?? null, body.require_user_approval ?? null]
    );
    if (!rows[0]) throw notFound('Organization not found');
    await query(
      `INSERT INTO audit_logs (org_id, action, entity_type, entity_id, after)
       VALUES ($1, 'platform.org_update', 'organization', $1, $2)`,
      [req.params.id, JSON.stringify({ ...body, by: (req as any).platformAdmin.username })]
    );
    res.json(rows[0]);
  })
);

// Add another org-admin login to an existing company.
platformRouter.post(
  '/orgs/:id/admins',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        username: z.string().min(2).regex(/^[a-zA-Z0-9._-]+$/),
        password: z.string().min(8),
        full_name: z.string().min(1),
        email: z.string().email().nullish(),
      })
      .parse(req.body);
    const org = await query(`SELECT id FROM organizations WHERE id = $1`, [req.params.id]);
    if (!org.rows[0]) throw notFound('Organization not found');
    const hash = await bcrypt.hash(body.password, config.saltRounds);
    const { rows } = await query(
      `INSERT INTO users (org_id, username, email, full_name, password_hash, is_org_admin)
       VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING id, username, full_name`,
      [req.params.id, body.username, body.email ?? null, body.full_name, hash]
    );
    res.status(201).json(rows[0]);
  })
);
