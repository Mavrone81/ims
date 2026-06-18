import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { notFound, conflict } from '../errors.js';
import { asyncHandler } from '../utils/http.js';
import { requireOrgAdmin } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { encryptField, decryptUser } from '../utils/crypto.js';

export const usersRouter = Router();
usersRouter.use(requireOrgAdmin);

usersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT u.id, u.username, u.email, u.full_name, u.is_org_admin, u.is_active, u.last_login_at,
              u.approval_status, u.self_registered,
              COALESCE(json_agg(json_build_object('project_id', pm.project_id, 'role', pm.role, 'project_name', p.name))
                       FILTER (WHERE pm.id IS NOT NULL), '[]') AS memberships
       FROM users u
       LEFT JOIN project_members pm ON pm.user_id = u.id
       LEFT JOIN projects p ON p.id = pm.project_id
       WHERE u.org_id = $1 AND u.deleted_at IS NULL
       GROUP BY u.id ORDER BY u.full_name`,
      [req.user!.org_id]
    );
    res.json({ data: rows.map(decryptUser) });
  })
);

usersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        username: z.string().min(2).regex(/^[a-zA-Z0-9._-]+$/, 'letters, digits, . _ - only'),
        email: z.string().email().nullish(),
        full_name: z.string().min(1),
        password: z.string().min(8),
        is_org_admin: z.boolean().optional().default(false),
        memberships: z
          .array(z.object({ project_id: z.string().uuid(), role: z.enum(['manager', 'technician', 'viewer']) }))
          .optional()
          .default([]),
      })
      .parse(req.body);

    const user = await withTransaction(async (client) => {
      const hash = await bcrypt.hash(body.password, config.saltRounds);
      const inserted = await client.query(
        `INSERT INTO users (org_id, username, email, full_name, password_hash, is_org_admin)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, username, email, full_name, is_org_admin, is_active`,
        [req.user!.org_id, body.username, encryptField(body.email ?? null), body.full_name, hash, body.is_org_admin]
      );
      for (const m of body.memberships) {
        await client.query(
          `INSERT INTO project_members (project_id, user_id, role) VALUES ($1,$2,$3)`,
          [m.project_id, inserted.rows[0].id, m.role]
        );
      }
      return inserted.rows[0];
    });
    audit(req, 'user.create', 'user', user.id, null, user); // stores ciphertext (synchronous stringify)
    res.status(201).json(decryptUser(user));
  })
);

usersRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        username: z.string().min(2).regex(/^[a-zA-Z0-9._-]+$/, 'letters, digits, . _ - only').optional(),
        email: z.string().email().nullish(),
        full_name: z.string().min(1).optional(),
        password: z.string().min(8).optional(),
        is_org_admin: z.boolean().optional(),
        is_active: z.boolean().optional(),
      })
      .parse(req.body);
    const hash = body.password ? await bcrypt.hash(body.password, config.saltRounds) : null;
    // Email: a present key (even null) sets the value; an absent key leaves it unchanged.
    const emailProvided = body.email !== undefined;
    const emailEnc = emailProvided ? encryptField(body.email ?? null) : null;
    const rows = await query(
      `UPDATE users SET
         username = COALESCE($3, username),
         email = CASE WHEN $4::boolean THEN $5 ELSE email END,
         full_name = COALESCE($6, full_name),
         password_hash = COALESCE($7, password_hash),
         is_org_admin = COALESCE($8, is_org_admin),
         is_active = COALESCE($9, is_active),
         updated_at = now()
       WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL
       RETURNING id, username, email, full_name, is_org_admin, is_active`,
      [req.params.id, req.user!.org_id, body.username ?? null, emailProvided, emailEnc,
       body.full_name ?? null, hash, body.is_org_admin ?? null, body.is_active ?? null]
    ).then((r) => r.rows).catch((e: any) => {
      if (e?.code === '23505') throw conflict('That username is already taken');
      throw e;
    });
    if (!rows[0]) throw notFound('User not found');
    // If the password was reset, revoke the target user's sessions (M4).
    if (hash) {
      await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [
        req.params.id,
      ]);
    }
    audit(req, 'user.update', 'user', req.params.id, null, rows[0]);
    res.json(decryptUser(rows[0]));
  })
);

// Approve / reject a self-registered (pending) user.
usersRouter.post(
  '/:id/approve',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `UPDATE users SET approval_status = 'approved', updated_at = now()
       WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL
       RETURNING id, username, approval_status`,
      [req.params.id, req.user!.org_id]
    );
    if (!rows[0]) throw notFound('User not found');
    audit(req, 'user.approve', 'user', req.params.id, null, rows[0]);
    res.json(rows[0]);
  })
);

usersRouter.post(
  '/:id/reject',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `UPDATE users SET approval_status = 'rejected', is_active = FALSE, updated_at = now()
       WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL
       RETURNING id, username, approval_status`,
      [req.params.id, req.user!.org_id]
    );
    if (!rows[0]) throw notFound('User not found');
    audit(req, 'user.reject', 'user', req.params.id, null, rows[0]);
    res.json(rows[0]);
  })
);

// Deactivate (docs: DELETE = deactivate, not hard delete)
usersRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `UPDATE users SET is_active = FALSE, updated_at = now()
       WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL RETURNING id`,
      [req.params.id, req.user!.org_id]
    );
    if (!rows[0]) throw notFound('User not found');
    await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [
      req.params.id,
    ]);
    audit(req, 'user.deactivate', 'user', req.params.id);
    res.status(204).end();
  })
);
