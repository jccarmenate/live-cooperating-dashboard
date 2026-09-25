/** host:port of the sync Worker; the provider picks ws:// for localhost and private IPs. */
export const SYNC_HOST = process.env.NEXT_PUBLIC_SYNC_HOST ?? 'localhost:8787';
export const SYNC_HTTP = process.env.NEXT_PUBLIC_SYNC_HTTP ?? `http://${SYNC_HOST}`;
