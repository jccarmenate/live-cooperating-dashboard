/** The decoded value of `name` in a URL fragment; null when absent or malformed. */
function fromHash(hash: string, name: 'k' | 'p'): string | null {
  const match = new RegExp(`(?:^#|&)${name}=([^&]+)`).exec(hash);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    // A malformed escape (e.g. `%E0`) in a shared link must never crash the board load.
    return null;
  }
}

/** Reads the capability key from a URL fragment like `#k=<key>`. */
export function keyFromHash(hash: string): string | null {
  return fromHash(hash, 'k');
}

/** Reads the active page from a URL fragment like `#k=<key>&p=<page>`. */
export function pageFromHash(hash: string): string | null {
  return fromHash(hash, 'p');
}

/** The fragment for a key and a page. */
export function hashFor(key: string | null, page: string): string {
  const parts = key ? [`k=${encodeURIComponent(key)}`] : [];
  parts.push(`p=${encodeURIComponent(page)}`);
  return `#${parts.join('&')}`;
}

/**
 * What a changed URL fragment asks for: another page of this room, a reload (the key changed,
 * so the capability did), or nothing.
 */
export function hashTarget(
  hash: string,
  key: string | null,
  activePage: string,
): { page: string } | 'reload' | null {
  if (keyFromHash(hash) !== key) return 'reload';
  const page = pageFromHash(hash);
  return page && page !== activePage ? { page } : null;
}
