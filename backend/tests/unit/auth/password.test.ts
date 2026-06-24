import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../../src/modules/auth/password.js';

describe('password hashing', () => {
  it('verifies a correct password', () => {
    const stored = hashPassword('s3cret-pass');
    expect(verifyPassword('s3cret-pass', stored)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const stored = hashPassword('s3cret-pass');
    expect(verifyPassword('wrong', stored)).toBe(false);
  });

  it('produces a distinct hash per call (salted)', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });

  it('rejects malformed stored values', () => {
    expect(verifyPassword('x', '')).toBe(false);
    expect(verifyPassword('x', 'notscrypt$aa$bb')).toBe(false);
    expect(verifyPassword('x', 'scrypt$only-two')).toBe(false);
  });
});
