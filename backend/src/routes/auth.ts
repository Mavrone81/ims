import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { unauthorized, badRequest, forbidden, notFound, conflict } from '../errors.js';
import { asyncHandler } from '../utils/http.js';
import { authenticate } from '../middleware/auth.js';
import { loginRateLimit } from '../middleware/loginRateLimit.js';

export const authRouter = Router();

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function signAccess(userId: string) {
  return jwt.sign({ sub: userId }, config.jwtAccessSecret, {
    expiresIn: config.jwtAccessTtl,
  } as jwt.SignOptions);
}

async function issueRefresh(userId: string): Promise<string> {
  const jti = randomUUID();
  const token = jwt.sign({ sub: userId, jti }, config.jwtRefreshSecret, {
    expiresIn: config.jwtRefreshTtl,
  } as jwt.SignOptions);
  const { exp } = jwt.decode(token) as { exp: number };
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, to_timestamp($3))`,
    [userId, sha256(token), exp]
  );
  return token;
}

async function userProjects(userId: string) {
  const { rows } = await query(
    `SELECT pm.project_id, pm.role, p.name AS project_name, p.code AS project_code
     FROM project_members pm JOIN projects p ON p.id = pm.project_id
     WHERE pm.user_id = $1 AND p.deleted_at IS NULL ORDER BY p.name`,
    [userId]
  );
  return rows;
}

authRouter.post(
  '/login',
  loginRateLimit,
  asyncHandler(async (req, res) => {
    const { username, password } = z
      .object({ username: z.string().min(1), password: z.string().min(1) })
      .parse(req.body);

    const { rows } = await query(
      `SELECT u.id, u.org_id, u.username, u.email, u.full_name, u.password_hash, u.is_org_admin,
              u.approval_status
       FROM users u
       JOIN organizations o ON o.id = u.org_id AND o.is_active
       WHERE u.username = $1 AND u.is_active AND u.deleted_at IS NULL`,
      [username]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw unauthorized('Invalid username or password');
    }
    // Password is correct — now gate on self-registration approval state.
    if (user.approval_status === 'pending') {
      throw forbidden('Your account is awaiting administrator approval.');
    }
    if (user.approval_status === 'rejected') {
      throw forbidden('Your registration was not approved. Contact your administrator.');
    }
    await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);

    res.json({
      access_token: signAccess(user.id),
      refresh_token: await issueRefresh(user.id),
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        is_org_admin: user.is_org_admin,
        projects: await userProjects(user.id),
      },
    });
  })
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const { refresh_token } = z.object({ refresh_token: z.string() }).parse(req.body);
    let payload: any;
    try {
      payload = jwt.verify(refresh_token, config.jwtRefreshSecret);
    } catch {
      throw unauthorized('Invalid refresh token');
    }
    const { rows } = await query(
      `SELECT id FROM refresh_tokens
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [sha256(refresh_token)]
    );
    if (!rows[0]) throw unauthorized('Refresh token revoked or expired');

    // Rotate: revoke old, issue new pair
    await query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [rows[0].id]);
    res.json({
      access_token: signAccess(payload.sub),
      refresh_token: await issueRefresh(payload.sub),
    });
  })
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const refresh = req.body?.refresh_token;
    if (typeof refresh === 'string') {
      await query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [
        sha256(refresh),
      ]);
    }
    res.status(204).end();
  })
);

// Public list of companies a prospective user can register against.
authRouter.get(
  '/companies',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `SELECT id, name FROM organizations WHERE is_active ORDER BY name`
    );
    res.json({ data: rows });
  })
);

// Public self-registration. Creates a non-admin user in the chosen company.
// If that company requires approval, the account is 'pending' and cannot log
// in until an org admin approves it; otherwise it is usable immediately.
authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        org_id: z.string().uuid(),
        username: z.string().min(2).regex(/^[a-zA-Z0-9._-]+$/, 'letters, digits, . _ - only'),
        full_name: z.string().min(1),
        email: z.string().email().nullish(),
        password: z.string().min(8),
      })
      .parse(req.body);

    const org = (
      await query(`SELECT id, require_user_approval FROM organizations WHERE id = $1 AND is_active`, [
        body.org_id,
      ])
    ).rows[0];
    if (!org) throw notFound('Selected company not found');

    const status = org.require_user_approval ? 'pending' : 'approved';
    const hash = await bcrypt.hash(body.password, config.saltRounds);
    try {
      await query(
        `INSERT INTO users (org_id, username, email, full_name, password_hash,
                            is_org_admin, self_registered, approval_status)
         VALUES ($1, $2, $3, $4, $5, FALSE, TRUE, $6)`,
        [body.org_id, body.username, body.email ?? null, body.full_name, hash, status]
      );
    } catch (err: any) {
      if (err?.code === '23505') throw conflict('That username is already taken');
      throw err;
    }
    res.status(201).json({
      status,
      message:
        status === 'pending'
          ? 'Registration submitted. An administrator must approve your account before you can sign in.'
          : 'Registration complete. You can now sign in.',
    });
  })
);

// Self-service password change for any authenticated user (enables C1 remediation).
authRouter.post(
  '/change-password',
  authenticate,
  asyncHandler(async (req, res) => {
    const { current_password, new_password } = z
      .object({ current_password: z.string().min(1), new_password: z.string().min(8) })
      .parse(req.body);
    if (current_password === new_password) {
      throw badRequest('New password must differ from the current one');
    }
    const { rows } = await query(`SELECT password_hash FROM users WHERE id = $1`, [req.user!.id]);
    if (!rows[0] || !(await bcrypt.compare(current_password, rows[0].password_hash))) {
      throw unauthorized('Current password is incorrect');
    }
    const hash = await bcrypt.hash(new_password, config.saltRounds);
    await query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, [
      req.user!.id,
      hash,
    ]);
    // Revoke other sessions so a changed password takes effect everywhere (M4 hardening).
    await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [
      req.user!.id,
    ]);
    res.status(204).end();
  })
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({
      id: req.user!.id,
      username: req.user!.username,
      email: req.user!.email,
      full_name: req.user!.full_name,
      is_org_admin: req.user!.is_org_admin,
      projects: await userProjects(req.user!.id),
    });
  })
);
