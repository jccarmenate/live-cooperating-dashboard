import { describe, expect, it } from 'vitest';
import {
  IDENTITY_KEY,
  type Identity,
  initials,
  isIdentity,
  loadIdentity,
  makeIdentity,
  onlineUsers,
  type Peer,
  PRESENCE_COLORS,
  parsePresence,
  peersFrom,
} from '../src';

const alice: Identity = { id: 'a', name: 'Brisk Otter', color: '#E85A1B' };
const bob: Identity = { id: 'b', name: 'Calm Heron', color: '#3B3BF5' };

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

describe('identity', () => {
  it('makeIdentity is deterministic given rand and uuid', () => {
    const id = makeIdentity(
      () => 0,
      () => 'uuid-1',
    );
    expect(id).toEqual({ id: 'uuid-1', name: 'Brisk Otter', color: PRESENCE_COLORS[0] });
    expect(isIdentity(id)).toBe(true);
  });

  it('loadIdentity persists and reuses the identity', () => {
    const storage = new MemoryStorage();
    const first = loadIdentity(storage, () => alice);
    const second = loadIdentity(storage, () => bob);
    expect(first).toEqual(alice);
    expect(second).toEqual(alice);
  });

  it('loadIdentity replaces corrupt data and tolerates missing storage', () => {
    const storage = new MemoryStorage();
    storage.setItem(IDENTITY_KEY, '{not json');
    expect(loadIdentity(storage, () => bob)).toEqual(bob);
    expect(loadIdentity(null, () => alice)).toEqual(alice);
  });

  it('initials', () => {
    expect(initials('Brisk Otter')).toBe('BO');
    expect(initials('mara')).toBe('M');
    expect(initials('  ')).toBe('?');
  });
});

describe('presence parsing', () => {
  it('parsePresence validates and defaults fields', () => {
    expect(parsePresence(null)).toBeNull();
    expect(parsePresence({ user: { id: 1 } })).toBeNull();
    expect(parsePresence({ user: alice })).toEqual({
      user: alice,
      cursor: null,
      selection: [],
      editing: null,
    });
    expect(
      parsePresence({ user: alice, cursor: { x: 1, y: 2 }, selection: ['s1', 7], editing: 's1' }),
    ).toEqual({ user: alice, cursor: { x: 1, y: 2 }, selection: ['s1'], editing: 's1' });
  });

  it('rejects a user.color that is not a plain #rrggbb hex value', () => {
    // user.color is used verbatim in inline `style.background`; anything
    // other than a strict 6-hex-digit color (e.g. `url(https://evil)`) could
    // leak a viewer's IP to a peer-controlled URL.
    expect(parsePresence({ user: { ...alice, color: 'url(https://evil.example)' } })).toBeNull();
    expect(parsePresence({ user: { ...alice, color: 'red' } })).toBeNull();
    expect(parsePresence({ user: { ...alice, color: '#E85A1' } })).toBeNull();
    expect(parsePresence({ user: { ...alice, color: '#E85A1BFF' } })).toBeNull();
    expect(parsePresence({ user: { ...alice, color: '#e85a1b' } })).toEqual({
      user: { ...alice, color: '#e85a1b' },
      cursor: null,
      selection: [],
      editing: null,
    });
  });

  it('rejects a user.id longer than 64 characters', () => {
    expect(parsePresence({ user: { ...alice, id: 'x'.repeat(65) } })).toBeNull();
    expect(parsePresence({ user: { ...alice, id: 'x'.repeat(64) } })).toEqual({
      user: { ...alice, id: 'x'.repeat(64) },
      cursor: null,
      selection: [],
      editing: null,
    });
  });

  it('peersFrom excludes self and invalid states, sorted by clientId', () => {
    const states = new Map<number, unknown>([
      [3, { user: bob }],
      [1, { user: alice }],
      [2, { garbage: true }],
    ]);
    const peers = peersFrom(states, 1);
    expect(peers.map((p) => p.clientId)).toEqual([3]);
  });

  it('onlineUsers dedupes by user id and lists self first', () => {
    const peers: Peer[] = [
      { clientId: 2, user: bob, cursor: null, selection: [], editing: null },
      { clientId: 3, user: bob, cursor: null, selection: [], editing: null },
      { clientId: 4, user: alice, cursor: null, selection: [], editing: null },
    ];
    expect(onlineUsers(peers, alice)).toEqual([alice, bob]);
  });
});
