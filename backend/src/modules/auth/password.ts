/**
 * Password hashing for user accounts. Uses Node's built-in ``scrypt`` so we
 * don't pull in bcryptjs — the rest of the auth stack already relies on
 * ``node:crypto`` (see auth.token.ts) and scrypt is a memory-hard KDF that's
 * more than adequate for an internal admin console's credential store.
 *
 * Stored format:  ``scrypt$<saltHex>$<hashHex>``
 *   - salt: 16 random bytes
 *   - hash: 64-byte scrypt derivation
 *
 * Verification is constant-time via ``timingSafeEqual``. The salt is embedded
 * so the same plaintext yields different hashes across users.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const PREFIX = 'scrypt';
const SALT_BYTES = 16;
const KEY_LEN = 64;

export function hashPassword(plain: string): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(plain, salt, KEY_LEN);
  return `${PREFIX}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== PREFIX) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[1], 'hex');
    expected = Buffer.from(parts[2], 'hex');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length !== KEY_LEN) return false;

  let actual: Buffer;
  try {
    actual = scryptSync(plain, salt, KEY_LEN);
  } catch {
    return false;
  }
  return timingSafeEqual(expected, actual);
}
