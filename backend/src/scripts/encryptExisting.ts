/**
 * One-off: encrypt existing plaintext PII rows after enabling column encryption.
 * Run AFTER FIELD_ENCRYPTION_KEY is configured:  node dist/scripts/encryptExisting.js
 *
 * Idempotent — values already in enc:v1: format are skipped, so it is safe to
 * re-run. Without a key set it refuses to run (would be a no-op anyway).
 */
import { pool } from '../db.js';
import { encryptField, fieldEncryptionEnabled } from '../utils/crypto.js';

const ENC = 'enc:v1:';

async function main() {
  if (!fieldEncryptionEnabled) {
    console.error('FIELD_ENCRYPTION_KEY is not set — nothing to do.');
    process.exit(1);
  }

  let users = 0;
  const uRows = (await pool.query(`SELECT id, email FROM users WHERE email IS NOT NULL`)).rows;
  for (const u of uRows) {
    if (typeof u.email === 'string' && u.email.startsWith(ENC)) continue;
    await pool.query(`UPDATE users SET email = $2 WHERE id = $1`, [u.id, encryptField(u.email)]);
    users++;
  }

  let suppliers = 0;
  const sRows = (await pool.query(
    `SELECT id, contact_name, email, phone FROM suppliers`
  )).rows;
  for (const s of sRows) {
    const needs = [s.contact_name, s.email, s.phone].some(
      (v) => typeof v === 'string' && v.length > 0 && !v.startsWith(ENC)
    );
    if (!needs) continue;
    await pool.query(
      `UPDATE suppliers SET contact_name = $2, email = $3, phone = $4 WHERE id = $1`,
      [
        s.id,
        typeof s.contact_name === 'string' && s.contact_name.startsWith(ENC) ? s.contact_name : encryptField(s.contact_name),
        typeof s.email === 'string' && s.email.startsWith(ENC) ? s.email : encryptField(s.email),
        typeof s.phone === 'string' && s.phone.startsWith(ENC) ? s.phone : encryptField(s.phone),
      ]
    );
    suppliers++;
  }

  console.log(`Encrypted PII for ${users} user(s) and ${suppliers} supplier(s).`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
