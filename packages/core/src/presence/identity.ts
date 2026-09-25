// Web Crypto exists in browsers, Workers and Node; declared locally so core needs no DOM/Node typings.
declare const crypto: { randomUUID(): string };

export interface Identity {
  id: string;
  name: string;
  color: string;
}

export const ADJECTIVES = [
  'Brisk',
  'Calm',
  'Bold',
  'Swift',
  'Quiet',
  'Lucky',
  'Keen',
  'Sunny',
  'Witty',
  'Nimble',
] as const;

export const ANIMALS = [
  'Otter',
  'Heron',
  'Lynx',
  'Falcon',
  'Badger',
  'Fox',
  'Panda',
  'Koala',
  'Raven',
  'Tiger',
] as const;

export const PRESENCE_COLORS = [
  '#E85A1B',
  '#3B3BF5',
  '#0E9F6E',
  '#C026D3',
  '#0891B2',
  '#B45309',
] as const;

const pick = <T>(xs: readonly T[], r: number): T =>
  xs[Math.min(xs.length - 1, Math.floor(r * xs.length))] as T;

export function makeIdentity(
  rand: () => number = Math.random,
  uuid: () => string = () => crypto.randomUUID(),
): Identity {
  return {
    id: uuid(),
    name: `${pick(ADJECTIVES, rand())} ${pick(ANIMALS, rand())}`,
    color: pick(PRESENCE_COLORS, rand()),
  };
}

export function isIdentity(v: unknown): v is Identity {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.name === 'string' && typeof o.color === 'string';
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const IDENTITY_KEY = 'relay:identity';

/** Returns the persisted identity, creating and persisting one if missing or corrupt. */
export function loadIdentity(
  storage: KeyValueStorage | null,
  make: () => Identity = () => makeIdentity(),
): Identity {
  try {
    const raw = storage?.getItem(IDENTITY_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isIdentity(parsed)) return parsed;
    }
  } catch {
    // corrupt or inaccessible storage: fall through and regenerate
  }
  const identity = make();
  try {
    storage?.setItem(IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    // storage may be blocked (private mode); identity is then per-session
  }
  return identity;
}

export function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return letters || '?';
}
