import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { notFound } from '../errors.js';
import { asyncHandler } from '../utils/http.js';
import { requireOrgAdmin } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';

// Sites, projects (+members), locations — docs/04_API.md §8.
// Reads are open to any authenticated org user; writes are org-admin only.
export const sitesRouter = Router();
export const projectsRouter = Router();
export const locationsRouter = Router();

// ── Sites ─────────────────────────────────────────────────────────────
const siteBody = z.object({ code: z.string().min(1), name: z.string().min(1), address: z.string().nullish() });

sitesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT id, code, name, address FROM sites WHERE org_id = $1 AND deleted_at IS NULL ORDER BY code`,
      [req.user!.org_id]
    );
    res.json({ data: rows });
  })
);

sitesRouter.post(
  '/',
  requireOrgAdmin,
  asyncHandler(async (req, res) => {
    const body = siteBody.parse(req.body);
    const { rows } = await query(
      `INSERT INTO sites (org_id, code, name, address) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.user!.org_id, body.code, body.name, body.address ?? null]
    );
    audit(req, 'site.create', 'site', rows[0].id, null, rows[0]);
    res.status(201).json(rows[0]);
  })
);

sitesRouter.patch(
  '/:id',
  requireOrgAdmin,
  asyncHandler(async (req, res) => {
    const body = siteBody.partial().parse(req.body);
    const { rows } = await query(
      `UPDATE sites SET code = COALESCE($3, code), name = COALESCE($4, name),
              address = COALESCE($5, address), updated_at = now()
       WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL RETURNING *`,
      [req.params.id, req.user!.org_id, body.code ?? null, body.name ?? null, body.address ?? null]
    );
    if (!rows[0]) throw notFound('Site not found');
    res.json(rows[0]);
  })
);

sitesRouter.delete(
  '/:id',
  requireOrgAdmin,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `UPDATE sites SET deleted_at = now() WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL RETURNING id`,
      [req.params.id, req.user!.org_id]
    );
    if (!rows[0]) throw notFound('Site not found');
    res.status(204).end();
  })
);

// ── Projects ──────────────────────────────────────────────────────────
const projectBody = z.object({
  site_id: z.string().uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullish(),
  settings: z.record(z.any()).optional(),
});

projectsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    // Org admins see all projects; others see only their memberships
    const { rows } = await query(
      `SELECT p.id, p.code, p.name, p.description, p.settings, p.is_active,
              p.site_id, s.code AS site_code, s.name AS site_name, pm.role
       FROM projects p
       JOIN sites s ON s.id = p.site_id
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $2
       WHERE s.org_id = $1 AND p.deleted_at IS NULL
         AND ($3 OR pm.user_id IS NOT NULL)
       ORDER BY p.name`,
      [req.user!.org_id, req.user!.id, req.user!.is_org_admin]
    );
    res.json({ data: rows });
  })
);

projectsRouter.post(
  '/',
  requireOrgAdmin,
  asyncHandler(async (req, res) => {
    const body = projectBody.parse(req.body);
    const site = await query(`SELECT id FROM sites WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`, [
      body.site_id, req.user!.org_id,
    ]);
    if (!site.rows[0]) throw notFound('Site not found');
    const { rows } = await query(
      `INSERT INTO projects (site_id, code, name, description, settings)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [body.site_id, body.code, body.name, body.description ?? null, JSON.stringify(body.settings ?? {})]
    );
    audit(req, 'project.create', 'project', rows[0].id, null, rows[0]);
    res.status(201).json(rows[0]);
  })
);

projectsRouter.patch(
  '/:id',
  requireOrgAdmin,
  asyncHandler(async (req, res) => {
    const body = projectBody.partial().extend({ is_active: z.boolean().optional() }).parse(req.body);
    const { rows } = await query(
      `UPDATE projects p SET
         code = COALESCE($3, code), name = COALESCE($4, name),
         description = COALESCE($5, description),
         settings = COALESCE($6, settings),
         is_active = COALESCE($7, is_active), updated_at = now()
       FROM sites s
       WHERE p.id = $1 AND p.site_id = s.id AND s.org_id = $2 AND p.deleted_at IS NULL
       RETURNING p.*`,
      [req.params.id, req.user!.org_id, body.code ?? null, body.name ?? null,
       body.description ?? null, body.settings ? JSON.stringify(body.settings) : null,
       body.is_active ?? null]
    );
    if (!rows[0]) throw notFound('Project not found');
    res.json(rows[0]);
  })
);

projectsRouter.delete(
  '/:id',
  requireOrgAdmin,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `UPDATE projects p SET deleted_at = now() FROM sites s
       WHERE p.id = $1 AND p.site_id = s.id AND s.org_id = $2 AND p.deleted_at IS NULL RETURNING p.id`,
      [req.params.id, req.user!.org_id]
    );
    if (!rows[0]) throw notFound('Project not found');
    res.status(204).end();
  })
);

// ── Project members ───────────────────────────────────────────────────
projectsRouter.get(
  '/:id/members',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT pm.id, pm.user_id, pm.role, u.full_name, u.email
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
       JOIN projects p ON p.id = pm.project_id
       JOIN sites s ON s.id = p.site_id
       WHERE pm.project_id = $1 AND s.org_id = $2 ORDER BY u.full_name`,
      [req.params.id, req.user!.org_id]
    );
    res.json({ data: rows });
  })
);

projectsRouter.post(
  '/:id/members',
  requireOrgAdmin,
  asyncHandler(async (req, res) => {
    const body = z
      .object({ user_id: z.string().uuid(), role: z.enum(['manager', 'technician', 'viewer']) })
      .parse(req.body);
    const { rows } = await query(
      `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (project_id, user_id) DO UPDATE SET role = $3 RETURNING *`,
      [req.params.id, body.user_id, body.role]
    );
    audit(req, 'project.member_set', 'project', req.params.id, null, rows[0]);
    res.status(201).json(rows[0]);
  })
);

projectsRouter.delete(
  '/:id/members/:userId',
  requireOrgAdmin,
  asyncHandler(async (req, res) => {
    await query(`DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, [
      req.params.id, req.params.userId,
    ]);
    audit(req, 'project.member_remove', 'project', req.params.id, null, { user_id: req.params.userId });
    res.status(204).end();
  })
);

// ── Locations ─────────────────────────────────────────────────────────
const locationBody = z.object({
  site_id: z.string().uuid(),
  code: z.string().min(1),
  name: z.string().nullish(),
  parent_id: z.string().uuid().nullish(),
});

locationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const params: any[] = [req.user!.org_id];
    let where = `WHERE s.org_id = $1 AND l.deleted_at IS NULL`;
    if (req.query.site_id) {
      params.push(req.query.site_id);
      where += ` AND l.site_id = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT l.id, l.site_id, l.code, l.name, l.parent_id, s.code AS site_code
       FROM locations l JOIN sites s ON s.id = l.site_id ${where} ORDER BY l.code`,
      params
    );
    res.json({ data: rows });
  })
);

locationsRouter.post(
  '/',
  requireOrgAdmin,
  asyncHandler(async (req, res) => {
    const body = locationBody.parse(req.body);
    const { rows } = await query(
      `INSERT INTO locations (site_id, code, name, parent_id) VALUES ($1,$2,$3,$4) RETURNING *`,
      [body.site_id, body.code, body.name ?? null, body.parent_id ?? null]
    );
    audit(req, 'location.create', 'location', rows[0].id, null, rows[0]);
    res.status(201).json(rows[0]);
  })
);

locationsRouter.patch(
  '/:id',
  requireOrgAdmin,
  asyncHandler(async (req, res) => {
    const body = locationBody.partial().parse(req.body);
    const { rows } = await query(
      `UPDATE locations l SET code = COALESCE($3, l.code), name = COALESCE($4, l.name)
       FROM sites s WHERE l.id = $1 AND l.site_id = s.id AND s.org_id = $2 AND l.deleted_at IS NULL
       RETURNING l.*`,
      [req.params.id, req.user!.org_id, body.code ?? null, body.name ?? null]
    );
    if (!rows[0]) throw notFound('Location not found');
    res.json(rows[0]);
  })
);

locationsRouter.delete(
  '/:id',
  requireOrgAdmin,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `UPDATE locations l SET deleted_at = now() FROM sites s
       WHERE l.id = $1 AND l.site_id = s.id AND s.org_id = $2 AND l.deleted_at IS NULL RETURNING l.id`,
      [req.params.id, req.user!.org_id]
    );
    if (!rows[0]) throw notFound('Location not found');
    res.status(204).end();
  })
);
