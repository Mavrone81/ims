import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { unauthorized, forbidden, badRequest } from '../errors.js';

export type ProjectRole = 'viewer' | 'technician' | 'manager';
const ROLE_RANK: Record<ProjectRole, number> = { viewer: 1, technician: 2, manager: 3 };

export interface AuthUser {
  id: string;
  org_id: string;
  username: string;
  email: string | null;
  full_name: string;
  is_org_admin: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      projectId?: string;
      projectRole?: ProjectRole | 'admin';
      projectSettings?: Record<string, any>;
    }
  }
}

/** Verify Bearer access token and attach req.user. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    let payload: any;
    try {
      payload = jwt.verify(header.slice(7), config.jwtAccessSecret);
    } catch {
      throw unauthorized('Invalid or expired access token');
    }
    if (payload.platform) throw unauthorized('Platform tokens cannot access org APIs');
    const { rows } = await query(
      `SELECT u.id, u.org_id, u.username, u.email, u.full_name, u.is_org_admin FROM users u
       JOIN organizations o ON o.id = u.org_id AND o.is_active
       WHERE u.id = $1 AND u.is_active AND u.deleted_at IS NULL`,
      [payload.sub]
    );
    if (!rows[0]) throw unauthorized('User no longer active');
    req.user = rows[0];
    next();
  } catch (err) {
    next(err);
  }
}

/** Resolve X-Project-Id, verify membership (org admins bypass), attach role + settings. */
export async function projectScope(req: Request, _res: Response, next: NextFunction) {
  try {
    const projectId = req.headers['x-project-id'];
    if (!projectId || typeof projectId !== 'string') {
      throw badRequest('X-Project-Id header is required');
    }
    const { rows } = await query(
      `SELECT p.id, p.settings, pm.role
       FROM projects p
       JOIN sites s ON s.id = p.site_id
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $2
       WHERE p.id = $1 AND p.deleted_at IS NULL AND s.org_id = $3`,
      [projectId, req.user!.id, req.user!.org_id]
    );
    const project = rows[0];
    if (!project) throw forbidden('Project not found or not accessible');
    if (!project.role && !req.user!.is_org_admin) {
      throw forbidden('You are not a member of this project');
    }
    req.projectId = project.id;
    req.projectRole = req.user!.is_org_admin ? 'admin' : project.role;
    req.projectSettings = project.settings ?? {};
    next();
  } catch (err) {
    next(err);
  }
}

/** Require at least `minRole` on the active project (org admin always passes). */
export function requireRole(minRole: ProjectRole) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.projectRole === 'admin') return next();
    if (!req.projectRole || ROLE_RANK[req.projectRole as ProjectRole] < ROLE_RANK[minRole]) {
      return next(forbidden(`Requires ${minRole} role on this project`));
    }
    next();
  };
}

export function requireOrgAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user?.is_org_admin) return next(forbidden('Requires organization admin'));
  next();
}
