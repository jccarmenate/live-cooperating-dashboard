export type Role = 'edit' | 'view';

export const DEMO_ROOM = 'demo';
/** Set by the Worker router after verifying the key; never trusted from clients. */
export const ROLE_HEADER = 'x-relay-role';

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
const encoder = new TextEncoder();

export function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 128-bit random room id. */
export function newRoomId(): string {
  return base32(crypto.getRandomValues(new Uint8Array(16)));
}

export async function deriveKey(secret: string, roomId: string, role: Role): Promise<string> {
  if (!secret) throw new Error('ROOM_SECRET is not configured');
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(`${roomId}:${role}`)),
  );
  return base64url(sig.slice(0, 16));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function roleForKey(
  secret: string,
  roomId: string,
  key: string | null,
): Promise<Role | null> {
  if (roomId === DEMO_ROOM) return 'edit';
  if (!key) return null;
  if (constantTimeEqual(key, await deriveKey(secret, roomId, 'edit'))) return 'edit';
  if (constantTimeEqual(key, await deriveKey(secret, roomId, 'view'))) return 'view';
  return null;
}
