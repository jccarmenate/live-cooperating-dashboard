import type { Identity } from '@relay/core';
import { describe, expect, it } from 'vitest';
import { onlineUsersSignature } from '../src/ui/onlineUsersSignature';

const user = (id: string, name: string, color: string): Identity => ({ id, name, color });

describe('onlineUsersSignature', () => {
  it('is identical for two equal but distinct arrays (cursor-only presence update)', () => {
    // Simulates onlineUsers() re-deriving a fresh Identity[] after peer.cursor changed,
    // while every user's id/name/color stayed the same — the case that must NOT re-render.
    const before = [user('self', 'Calm Lynx', '#3B3BF5'), user('u2', 'Bold Fox', '#0E9F6E')];
    const after = [
      { ...user('self', 'Calm Lynx', '#3B3BF5') },
      { ...user('u2', 'Bold Fox', '#0E9F6E') },
    ];
    expect(before).not.toBe(after);
    expect(before[0]).not.toBe(after[0]);
    expect(onlineUsersSignature(before)).toBe(onlineUsersSignature(after));
  });

  it('differs when a user joins or leaves', () => {
    const before = [user('self', 'Calm Lynx', '#3B3BF5')];
    const joined = [user('self', 'Calm Lynx', '#3B3BF5'), user('u2', 'Bold Fox', '#0E9F6E')];
    expect(onlineUsersSignature(before)).not.toBe(onlineUsersSignature(joined));
  });

  it('differs when a name or color changes', () => {
    const before = [user('self', 'Calm Lynx', '#3B3BF5')];
    expect(onlineUsersSignature(before)).not.toBe(
      onlineUsersSignature([user('self', 'Calm Lynx', '#0E9F6E')]),
    );
    expect(onlineUsersSignature(before)).not.toBe(
      onlineUsersSignature([user('self', 'Sunny Panda', '#3B3BF5')]),
    );
  });

  it('is order-sensitive, matching onlineUsers self-first ordering', () => {
    const a = [user('self', 'Calm Lynx', '#3B3BF5'), user('u2', 'Bold Fox', '#0E9F6E')];
    const b = [user('u2', 'Bold Fox', '#0E9F6E'), user('self', 'Calm Lynx', '#3B3BF5')];
    expect(onlineUsersSignature(a)).not.toBe(onlineUsersSignature(b));
  });

  it('does not collide when a field contains the old "|" join separator', () => {
    // A name containing '|' used to be indistinguishable from the same
    // characters split across the id/name boundary once joined with '|'.
    const nameHasPipe = [user('a', 'b|c', '#111111')];
    const idHasPipe = [user('a|b', 'c', '#111111')];
    expect(onlineUsersSignature(nameHasPipe)).not.toBe(onlineUsersSignature(idHasPipe));
  });
});
