/** Reads the capability key from a URL fragment like `#k=<key>`. */
export function keyFromHash(hash: string): string | null {
  const match = /(?:^#|&)k=([^&]+)/.exec(hash);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/** Reads the active page from a URL fragment like `#k=<key>&p=<page>`. */
export function pageFromHash(hash: string): string | null {
  const match = /(?:^#|&)p=([^&]+)/.exec(hash);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/** The fragment for a key and a page. */
export function hashFor(key: string | null, page: string): string {
  const parts = key ? [`k=${encodeURIComponent(key)}`] : [];
  parts.push(`p=${encodeURIComponent(page)}`);
  return `#${parts.join('&')}`;
}
