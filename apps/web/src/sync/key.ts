/** Reads the capability key from a URL fragment like `#k=<key>`. */
export function keyFromHash(hash: string): string | null {
  const match = /(?:^#|&)k=([^&]+)/.exec(hash);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}
