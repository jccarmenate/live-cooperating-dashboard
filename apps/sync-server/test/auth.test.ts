import { describe, expect, it } from 'vitest';
import { base32, DEMO_ROOM, deriveKey, newRoomId, roleForKey } from '../src/auth';

describe('auth', () => {
  it('newRoomId is 26 lowercase base32 chars and unique', () => {
    const a = newRoomId();
    const b = newRoomId();
    expect(a).toMatch(/^[a-z2-7]{26}$/);
    expect(a).not.toBe(b);
  });

  it('base32 encodes known vectors (RFC 4648, lowercase, no padding)', () => {
    const enc = (s: string) => base32(new TextEncoder().encode(s));
    expect(enc('f')).toBe('my');
    expect(enc('foobar')).toBe('mzxw6ytboi');
  });

  it('derives distinct, deterministic edit and view keys', async () => {
    const edit = await deriveKey('s3cret', 'room1', 'edit');
    const view = await deriveKey('s3cret', 'room1', 'view');
    expect(edit).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(edit).not.toBe(view);
    expect(await deriveKey('s3cret', 'room1', 'edit')).toBe(edit);
    expect(await deriveKey('other', 'room1', 'edit')).not.toBe(edit);
  });

  it('roleForKey maps keys to roles', async () => {
    const edit = await deriveKey('s3cret', 'room1', 'edit');
    const view = await deriveKey('s3cret', 'room1', 'view');
    expect(await roleForKey('s3cret', 'room1', edit)).toBe('edit');
    expect(await roleForKey('s3cret', 'room1', view)).toBe('view');
    expect(await roleForKey('s3cret', 'room2', edit)).toBeNull();
    expect(await roleForKey('s3cret', 'room1', 'bogus')).toBeNull();
    expect(await roleForKey('s3cret', 'room1', null)).toBeNull();
  });

  it('the demo room is open for editing', async () => {
    expect(await roleForKey('s3cret', DEMO_ROOM, null)).toBe('edit');
  });

  it('refuses to derive keys without a secret', async () => {
    await expect(deriveKey('', 'room1', 'edit')).rejects.toThrow('ROOM_SECRET');
  });
});
