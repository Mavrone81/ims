import crypto from 'node:crypto';

/**
 * Application-level field encryption for sensitive PII columns (AES-256-GCM).
 *
 * Values are encrypted in the app before they reach PostgreSQL, so the database
 * files, disk, and backups only ever hold ciphertext for these fields. The key
 * lives only in the app environment (FIELD_ENCRYPTION_KEY) — a separate trust
 * domain from the database.
 *
 * Stored format:  enc:v1:<base64(iv[12] | tag[16] | ciphertext)>
 *
 * Backward/forward compatible: decryptField() passes through any value that
 * isn't in the enc: format (legacy plaintext), and without a key configured the
 * helpers are no-ops — so the feature can be rolled out, then existing rows
 * migrated with scripts/encryptExisting.ts.
 */
const PREFIX = 'enc:v1:';

const keyHex = process.env.FIELD_ENCRYPTION_KEY?.trim();
let key: Buffer | null = null;
if (keyHex) {
  key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('FIELD_ENCRYPTION_KEY must be 32 bytes as 64 hex characters');
  }
}

export const fieldEncryptionEnabled = key !== null;

export function encryptField<T extends string | null | undefined>(plain: T): T {
  if (plain === null || plain === undefined || plain === '') return plain;
  if (!key) return plain; // no key configured -> passthrough
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (PREFIX + Buffer.concat([iv, tag, ct]).toString('base64')) as T;
}

export function decryptField<T extends string | null | undefined>(stored: T): T {
  if (typeof stored !== 'string' || !stored.startsWith(PREFIX)) return stored; // legacy plaintext / null
  if (!key) return stored; // cannot decrypt without the key — return as-is
  const buf = Buffer.from(stored.slice(PREFIX.length), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8') as T;
}

/** Decrypt the PII fields on a user row in place (id/username/etc. untouched). */
export function decryptUser<T extends { email?: string | null }>(row: T): T {
  if (row && row.email !== undefined) row.email = decryptField(row.email);
  return row;
}

/** Decrypt the PII fields on a supplier row in place. */
export function decryptSupplier<T extends { contact_name?: string | null; email?: string | null; phone?: string | null }>(row: T): T {
  if (!row) return row;
  if (row.contact_name !== undefined) row.contact_name = decryptField(row.contact_name);
  if (row.email !== undefined) row.email = decryptField(row.email);
  if (row.phone !== undefined) row.phone = decryptField(row.phone);
  return row;
}
