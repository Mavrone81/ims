import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { pool } from './db.js';
import { createApp } from './app.js';

const app = createApp();

/** Bootstrap the platform admin from env (PLATFORM_ADMIN_USERNAME/PASSWORD) —
 *  keeps the credential out of the repo. No-op if it already exists. */
async function ensurePlatformAdmin() {
  const username = process.env.PLATFORM_ADMIN_USERNAME;
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  if (!username || !password) return;
  const { rowCount } = await pool.query(`SELECT 1 FROM platform_admins WHERE username = $1`, [username]);
  if (rowCount) return;
  const hash = await bcrypt.hash(password, config.saltRounds);
  await pool.query(`INSERT INTO platform_admins (username, password_hash) VALUES ($1, $2)`, [username, hash]);
  console.log(`platform admin '${username}' bootstrapped`);
}

ensurePlatformAdmin()
  .catch((err) => console.error('platform admin bootstrap failed:', err.message))
  .finally(() => {
    app.listen(config.port, () => {
      console.log(`IMS API listening on :${config.port}${config.apiBasePath}`);
    });
  });
